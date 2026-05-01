# Project Research Summary

**Project:** Tether v0.3 — Remote Access
**Domain:** PTY-backed agent console — finishing milestone (not greenfield)
**Researched:** 2026-05-01
**Confidence:** HIGH

## Executive Summary

Tether v0.3 is a hardening and finishing milestone, not a build-from-scratch effort. Phase 2 (PTY-backed event stream) is fully shipped. The outstanding work consists of 11 concrete requirements — 5 experience verification/fixes (P0), 6 security/stability items (P1), and 3 cleanup items (P2) — that together close the gap between "it works locally" and "it can be trusted over LAN from a phone." The research converged on a clear, low-novelty implementation path: zero new npm packages are needed, all new modules are small and self-contained, and the dominant risk is integration correctness rather than design uncertainty.

The recommended build order is: P0 experience items first (detach hotkey + EXP-02/03/04/05 verification), then tmux cleanup (CLEAN-01/02) to reduce surface area before auth work, then pairing/auth (AUTH-02 → AUTH-01), then retention and supervisor (RETAIN-01 → GW-01 → GW-02), with TEST-01 written alongside the auth and retention phases. This ordering is dictated by hard dependency chains: AUTH-01 requires the token table that AUTH-02 creates; GW-02 (launchd) requires GW-01 (supervisor) to be stable first; CLEAN-01 is safest after GW-01 proves the PTY path handles all cases the tmux fallback was covering.

The top risks are operational rather than algorithmic. The node-pty fd leak (issue #907) requires a version upgrade to beta.12 before the supervisor work begins. The macOS PTY 1024-byte write corruption requires chunked writes to land with EXP-03. Raw mode must be restored on every exit path — not just the happy path — when the detach hotkey is implemented. The SQLite WAL checkpoint starvation risk is mitigated by RETAIN-01 landing before long Gateway uptimes become the norm. None of these risks require architectural changes; they are implementation-level discipline items with known solutions.

## Key Findings

### Recommended Stack

The existing stack (Hono, better-sqlite3, node-pty, xterm.js, React 19, Vite, tsx, pnpm, Node 20+) requires no additions for v0.3. All new functionality uses Node.js 20+ builtins: `node:crypto` for token generation and hashing, `fs` and `child_process` for launchd plist management, and existing better-sqlite3 for the device_tokens table and retention queries. The only version change is a required upgrade of node-pty from `1.2.0-beta.2` to `1.2.0-beta.12` to close a macOS file descriptor leak.

The two xterm.js packages for server-side terminal state (`@xterm/headless`, `@xterm/addon-serialize`) are documented as the correct future path but explicitly deferred past v0.3. They are not needed because ANSI escape sequences must pass through raw and the store must record them unstripped.

**Core technologies:**
- `node:crypto` (Node 20 builtin): `randomUUID()` for device tokens, `randomInt()` for pairing codes, `createHash('sha256')` for token storage — no bcrypt/argon2 needed given 122-bit token entropy
- `node-pty@1.2.0-beta.12`: must upgrade from beta.2 to close macOS fd leak before GW-01
- `better-sqlite3` (existing): `device_tokens` table via additive migration; `DELETE WHERE ts < cutoff` for retention; `PRAGMA wal_checkpoint(RESTART)` on 5-minute interval
- `child_process.spawn` (Node builtin): all launchctl calls for launchd plist management, never `shell:true`
- `Ctrl-]` (0x1D, ASCII GS): selected detach key — no collision with readline, shells, or TUI apps

### Expected Features

**Must have — P0 (milestone exit blocked without these):**
- EXP-01: Detach hotkey (`Ctrl-]`) — CLI-side intercept in `stdin.on('data')` before WS forward; raw mode must be restored on all exit paths including SIGTERM
- EXP-02: Enter / Backspace / Ctrl-C / Ctrl-D passthrough verified — especially iOS Safari and Android Chrome paths
- EXP-03: Bracketed paste pass-through + chunked PTY writes (512 bytes per write, `setImmediate` between chunks) to fix macOS PTY buffer overflow
- EXP-04: ANSI / alternate screen / clear screen verified and passing
- EXP-05: Complex TUI (Codex/Claude) resize with 150ms debounce — `active controller owns size` verified for controller handoff
- AUTH-01: Device token auth middleware on all write endpoints (input, resize, stop, claim-control)
- AUTH-02: Pairing flow — 6-digit `crypto.randomInt()` code, 60s TTL in-memory, atomic `BEGIN IMMEDIATE` verify-and-write, SHA-256 token hash in `device_tokens` table

**Should have — P1:**
- RETAIN-01: 7-day / 100MB-per-session rolling cleanup, `setInterval` 15 min, `timer.unref()`, WAL checkpoint on 5-min interval
- GW-01: Single-process Gateway supervisor — CLI probes `GET /api/sessions`, falls through to in-process if no Gateway running
- GW-02: macOS launchd LaunchAgent plist with absolute node path (snapshotted via `which node` at install time), snapshotted PATH, `KeepAlive: {SuccessfulExit: false}`, port-conflict detection that exits with code 0
- TEST-01: Auth, whitelist, mask, and compatibility integration tests

**Defer — P2:**
- CLEAN-01: tmux fallback removal (safe after GW-01 is stable)
- CLEAN-02: Keep `transport` field as extension point; remove `'tmux'` from active write types only
- CLEAN-03: TypeScript exhaustive switch test for structured event types

**Permanent anti-features (not in v0.3 or later):**
- Arbitrary shell execution, tmux pane/window/prefix/copy-mode/plugins, IDE editing features, multi-machine federation in this milestone

### Architecture Approach

V0.3 adds three new files (`supervisor.ts`, `retention.ts`, `launchd.ts`) and modifies three existing files (`daemon.ts` for auth middleware and pairing routes, `store.ts` for `device_tokens` migration, `apps/cli/src/main.ts` for detach key and supervisor probe), then deletes `tmux.ts`. The key architectural constraint is that `better-sqlite3` is synchronous single-process: the retention job, WAL checkpoint, and device token verification all run inside the same Gateway process using closure-shared instances. No IPC, no second Store instance, no separate compaction process.

**Major components:**
1. `daemon.ts` — add `authMiddleware` (Bearer token check on write routes), mount `/api/pair/initiate` and `/api/pair/confirm`, mount `POST /api/sessions` route delegating to `supervisor.ts`
2. `supervisor.ts` (new) — `POST /api/sessions` handler using the shared `ptySessions` closure instance; CLI `startProviderSession` probes this via `GET /api/sessions` liveness check first
3. `store.ts` — additive migration adds `device_tokens (token_hash TEXT PK, device_name TEXT, created_at INTEGER, last_used_at INTEGER)`; adds `verifyDeviceToken(raw)` (SHA-256 lookup) and retention query helpers
4. `retention.ts` (new) — `startRetentionJob(store)` returns a stop function; age-based `DELETE WHERE ts < cutoff` every 15 min plus per-session size-based DELETE when `SUM(length(payload_json)) > 100MB`
5. `launchd.ts` (new) — `writePlist` / `loadPlist` / `unloadPlist`; snapshots `process.env.PATH` and absolute `which node` path at install time; `StandardOutPath` / `StandardErrorPath` use literal expanded HOME
6. `apps/cli/src/main.ts` — `attachPtySession` intercepts `\x1d` before WS forward; `startProviderSession` probes running Gateway before in-process bootstrap

### Critical Pitfalls

1. **Raw mode not restored on crash/SIGTERM** — Wrap the entire attach loop in `try/finally { process.stdin.setRawMode(false) }`. Register SIGINT, SIGTERM, and `process.on('exit')` handlers. Do NOT call `process.exit()` directly inside signal handlers. Verify with: kill attach process mid-session, assert `stty echo` still set.

2. **node-pty fd leak on macOS (issue #907)** — Upgrade from `1.2.0-beta.2` to `1.2.0-beta.12` before GW-01 work. Run `pnpm rebuild node-pty`. Test with 20 sequential PTY spawn/exit cycles asserting no EMFILE errors.

3. **macOS PTY 1024-byte write corruption** — Chunk all PTY writes at 512 bytes with `setImmediate` between chunks in `PtySessionManager.write()`. Test: 2KB paste arrives intact at PTY child via `/bin/cat` echo test.

4. **Alternate screen + rapid resize causes TUI flicker** — Debounce resize calls to 150ms per session in the Gateway. Test: 5 rapid resize frames produce exactly 1 `terminal.resize` event in the store.

5. **SQLite WAL checkpoint starvation** — Add `PRAGMA wal_checkpoint(RESTART)` on a 5-minute `setInterval` alongside the retention job. Set `PRAGMA wal_autocheckpoint = 1000` and `PRAGMA synchronous = NORMAL`. RETAIN-01 must land before Gateway uptimes exceed a few hours.

6. **launchd PATH does not include nvm/Homebrew node** — `ProgramArguments[0]` must be the absolute path resolved at install time (`process.execPath` or `which node`). `EnvironmentVariables.PATH` must include the full snapshotted user PATH. `$HOME` is NOT expanded in plists — all paths must be literal strings.

7. **Pairing code TOCTOU race** — The verify-and-write must be a single `BEGIN IMMEDIATE` SQLite transaction. Rate-limit to 5 attempts per code before invalidation. Two concurrent confirm requests for the same code must produce exactly one success.

## Implications for Roadmap

Three research agents converged on the same dependency graph. The build order below respects all hard blockers:

### Phase 1: Experience Hardening (P0)
**Rationale:** EXP-01 through EXP-05 are the fastest wins and share the same code path (`attachPtySession`, PTY write, xterm.js render). They are self-contained, gate nothing except the local terminal feel, and must pass before any phone user picks up the product. The detach hotkey (EXP-01) anchors the raw mode cleanup that all other attach behavior depends on.
**Delivers:** Local terminal experience at parity with tmux; Phase 2 acceptance checklist all green
**Addresses:** EXP-01, EXP-02, EXP-03, EXP-04, EXP-05
**Avoids:** Raw mode terminal corruption (Pitfall 1), macOS PTY write corruption (Pitfall 3), TUI resize flicker (Pitfall 4)
**Research flag:** None — patterns fully specified in STACK.md and ARCHITECTURE.md

### Phase 2: Cleanup (P2 early)
**Rationale:** Removing the tmux transport before writing auth middleware eliminates one branch from every modified file. Auth code written against a single-transport codebase is simpler to reason about and test. CLEAN-01 has no dependencies on v0.3 P1 items beyond confirming no active tmux users.
**Delivers:** Single-transport codebase; dead code removed; `daemon.ts` branch count reduced before auth adds new branches
**Addresses:** CLEAN-01, CLEAN-02
**Avoids:** tmux dual-path bugs re-entraining in new auth code (Pitfall 11)
**Research flag:** None — mechanical deletion with defined scope in ARCHITECTURE.md §6

### Phase 3: Authentication (AUTH-02 then AUTH-01)
**Rationale:** AUTH-02 (pairing) creates the `device_tokens` table and token issuance flow; AUTH-01 (write-endpoint middleware) reads from it. This ordering is a hard dependency. Log masking for ticket URLs must land simultaneously with AUTH-01.
**Delivers:** Safe LAN exposure to phone; device token auth on all write operations; pairing UX on web client
**Addresses:** AUTH-01, AUTH-02
**Avoids:** Pairing code TOCTOU (Pitfall 7/10), token-in-URL log leak (Pitfall 7)
**Research flag:** None — all crypto primitives verified via official Node docs; pairing flow design in ARCHITECTURE.md §3

### Phase 4: Retention and WAL Health (RETAIN-01)
**Rationale:** Retention is additive and independent of auth, but must land before long Gateway uptimes. WAL checkpoint scheduling belongs in the same phase since both are store-lifecycle concerns. Together they prevent unbounded DB growth and WAL starvation.
**Delivers:** Bounded event store; stable Gateway performance under multi-hour uptime
**Addresses:** RETAIN-01
**Avoids:** WAL checkpoint starvation (Pitfall 5)
**Research flag:** None — SQL patterns and WAL mechanics well-documented; `retention.ts` scope approximately 50 lines

### Phase 5: Supervisor and launchd (GW-01 then GW-02)
**Rationale:** GW-01 (single-process supervisor) must be stable before GW-02 (launchd) installs it as a persistent service. The node-pty upgrade to beta.12 must happen at the start of this phase. GW-01 is architecturally the most complex item in v0.3 but is well-scoped: a new `POST /api/sessions` route and CLI probe logic, not a rewrite of PTY management.
**Delivers:** True single-owner Gateway; macOS login persistence; crash-recovery via launchd KeepAlive
**Addresses:** GW-01, GW-02
**Avoids:** fd leak (Pitfall 2), launchd crash loop (Pitfall 8), launchd PATH failure (Pitfall 9)
**Research flag:** GW-01 CLI probe fallback edge cases (Gateway mid-restart when CLI runs) are underspecified — recommend a brief design pass before implementation

### Phase 6: Security Tests and Final Cleanup (TEST-01 + CLEAN-03)
**Rationale:** Integration tests can only be written after the features they cover are complete. TEST-01 is explicitly the milestone exit gate. CLEAN-03 closes the Phase 2 structured event schema.
**Delivers:** Verified auth coverage; milestone exit criteria satisfied; Phase 4 event schema frozen
**Addresses:** TEST-01, CLEAN-03
**Avoids:** Silent regressions in auth paths discovered post-release
**Research flag:** None — test scope defined in FEATURES.md; patterns are standard

### Phase Ordering Rationale

- EXP items first: no dependencies, fastest user-facing value, anchors raw mode cleanup
- CLEAN before auth: each tmux branch removed reduces the diff of every subsequent auth change
- AUTH-02 before AUTH-01: hard dependency — token table must exist before token check runs
- RETAIN-01 before GW-01: supervisor startup needs retention job wired; doing them together complicates the GW-01 PR
- GW-02 after GW-01: hard dependency — launchd must start a stable supervisor
- TEST-01 last: validates the completed feature set; early test writing wastes effort against unstable interfaces

### Research Flags

**Phases with well-documented patterns (skip `/gsd-research-phase`):**
- Phase 1 (Experience Hardening): implementation specified in STACK.md and ARCHITECTURE.md
- Phase 2 (Cleanup): mechanical deletion with defined file scope
- Phase 3 (Auth): crypto primitives verified; flow design complete
- Phase 4 (Retention): SQL patterns verified; small module
- Phase 6 (Tests): scope defined; no new design needed

**Phases that may benefit from a brief design review:**
- Phase 5 (Supervisor + launchd): GW-01 CLI probe fallback behavior under Gateway-restart race conditions is underspecified

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Existing stack unchanged; new patterns (crypto, launchd, retention SQL) all verified via official docs |
| Features | HIGH | Primary source is PROJECT.md + Phase 2 design docs; competitor analysis grounded in official docs |
| Architecture | HIGH | Derived from direct source file inspection; component boundaries are unambiguous |
| Pitfalls | HIGH | Grounded in codebase audit (CONCERNS.md) + verified external bug reports (node-pty #907, macOS PTY write bug, SQLite WAL research) |

**Overall confidence:** HIGH

### Gaps to Address

- **GW-01 probe fallback behavior:** What the CLI does when the Gateway process is present but not yet listening (launchd restart race) is underspecified. Recommendation: retry loop with 3 attempts / 500ms spacing before falling back to in-process.
- **CLEAN-02 transport field:** The exact TypeScript type migration path for `SessionTransport` union in `store.ts` should be confirmed at implementation time against actual usage in `packages/core`.
- **WS bufferedAmount threshold:** The 256KB threshold for slow-client disconnect is community-sourced, not benchmarked for this schema. Treat as starting default and validate in TEST-01 load testing.

## Sources

### Primary (HIGH confidence)
- `/Users/dream/code/tether/.planning/PROJECT.md` — v0.3 Active requirements, constraints, key decisions
- `apps/gateway/src/daemon.ts`, `pty.ts`, `store.ts` (direct inspection) — existing component boundaries
- `apps/cli/src/main.ts` (direct inspection) — attach loop, raw mode handling
- Node.js 20 `node:crypto` docs — `randomUUID`, `randomInt`, `createHash` APIs
- xterm.js `ITerminalOptions` API docs (xtermjs.org) — `ignoreBracketedPasteMode`, v6.0.0
- OWASP WebSocket Security Cheat Sheet — one-time ticket pattern
- Apple Developer documentation + launchd.info — LaunchAgent plist mechanics, $HOME non-expansion
- node-pty issue #907 (GitHub) — macOS fd leak; beta.10/beta.12 fix confirmed
- PhotoStructure SQLite WAL research — VACUUM + `wal_checkpoint(TRUNCATE)` sequence
- `.planning/codebase/CONCERNS.md` — codebase audit baseline

### Secondary (MEDIUM confidence)
- macOS PTY 1024-byte write bug: jcansdale/macos-pty-multiline-bug + VS Code issue #296955
- Paseo product docs (paseo.sh) — pairing flow comparison
- EveBox SQLite retention defaults — 7-day / size-based defaults
- xterm.js issues #1701, #1914 — resize/flicker behavior
- SQLite WAL checkpoint starvation: loke.dev research

### Tertiary (LOW confidence / convention)
- 6-digit pairing code length — convention, not formally standardized for LAN single-user scope
- 256KB bufferedAmount threshold — community default, not benchmarked for this schema
- 15-minute retention interval — reasonable default, not benchmarked for this write rate

---
*Research completed: 2026-05-01*
*Ready for roadmap: yes*
