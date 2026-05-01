# Codebase Concerns

**Analysis Date:** 2026-05-01

## Tech Debt

**Phase 1 → Phase 2 architecture transition (incomplete migration):**
- Issue: tmux transport is being replaced by PTY event stream but both code paths are still live; every session-touching endpoint branches on `session.transport === 'pty-event-stream'` vs `'tmux'`. Status reconciliation, snapshot, send, stop, attach, list all duplicate logic.
- Files: `apps/gateway/src/daemon.ts:60-103`, `apps/gateway/src/daemon.ts:120-199`, `apps/cli/src/main.ts:96-180`, `apps/cli/src/main.ts:195-216`, `apps/cli/src/main.ts:265-301`, `apps/gateway/src/store.ts:233-235`, `AI_CONTEXT.md` (states "Phase 2 是架构换血")
- Impact: Two control paths to maintain, increased surface area for bugs (e.g., `daemon.ts:65-72` only auto-reconciles `running` ↔ `stopped` for tmux but not for pty-event-stream).
- Fix approach: Define a single `SessionTransportAdapter` interface with `exists / capture / send / stop / attach`; collapse the branches into a single dispatch.

**`stripAnsi` documented as temporary fallback:**
- Issue: ANSI-stripping regex in `daemon.ts` is explicitly marked as "a temporary fallback for the pre-based snapshot UI; the event-stream UI should render with xterm.js."
- Files: `apps/gateway/src/daemon.ts:436-443`
- Impact: Two snapshot paths (event-stream returns stripped transcript; tmux returns masked raw). Once tmux transport is fully removed, this whole helper can go.
- Fix approach: When the tmux transport is dropped, delete `stripAnsi` and the `transcript`-based snapshot branch.

**`tether stop` for tmux returns 501:**
- Issue: HTTP `POST /api/sessions/:id/stop` returns `'tmux stop is not implemented in this endpoint'` (501) for tmux sessions, but the CLI silently sends `C-c` over `tmux send-keys` instead.
- Files: `apps/gateway/src/daemon.ts:198`, `apps/cli/src/main.ts:300`
- Impact: Web UI's Stop button silently fails for tmux sessions (`apps/web/src/main.tsx:566-570` shows `Stop failed: HTTP 501`).
- Fix approach: Either implement tmux `kill-session` server-side or remove the tmux path entirely with the rest of Phase 1.

**Hard-coded `127.0.0.1:4789` in CLI `send`:**
- Issue: `tether send <id> "text"` for pty-event-stream sessions hard-codes `http://127.0.0.1:4789/...` even though every other CLI subcommand accepts `--host` / `--port`.
- Files: `apps/cli/src/main.ts:266`
- Impact: `tether send` against a session running on a different port silently hits a non-existent gateway.
- Fix approach: Add `--host` / `--port` options matching the rest of the CLI surface.

**`PROJECT.md` lists `tether_<id> -c $PATH "claude"` semantics that already drift:**
- Issue: Docs say a session is `tmux new-session -d -s tether_<id> -c "$PROJECT_PATH" "codex"`. The actual default is now `pty-event-stream`; tmux is opt-in via `--transport tmux`.
- Files: `AI_CONTEXT.md:164-178`, `PROJECT.md:91-98`, `apps/cli/src/main.ts:55,86`
- Impact: Out-of-date docs may mislead contributors.
- Fix approach: Update docs to make event-stream primary and tmux clearly optional.

**TmuxError still says "Phase 1 demo":**
- Issue: Error message still references "Phase 1 demo" even though we are mid-Phase 2.
- Files: `apps/gateway/src/tmux.ts:47`
- Impact: User-facing wording is stale.
- Fix approach: Reword to "tmux fallback is enabled but tmux was not found in PATH".

**Per-process Gateway, multi-session story unfinished:**
- Issue: `AI_CONTEXT.md:153-162` documents that each `--no-attach` session needs a different port because the Gateway is not yet a real supervisor — sessions are owned by the spawning CLI process, not by a single long-lived Gateway.
- Files: `apps/cli/src/main.ts:64-77` (gateway command), `apps/cli/src/main.ts:96-180` (per-session daemon)
- Impact: Cannot run multiple sessions through one Gateway; `tether gateway` is currently a "host the web UI for already-running sessions" stub.
- Fix approach: Add an `/api/sessions` POST endpoint on the Gateway and push session creation server-side.

## Known Bugs

**`localLanAddress` returns the first non-internal IPv4 — undefined on multi-NIC hosts with the wrong order:**
- Symptoms: When binding `--host 0.0.0.0`, the URL printed/registered may be a VPN / Docker bridge / virtual interface rather than the real LAN IP.
- Files: `apps/gateway/src/daemon.ts:32-41`, also re-exported and used by CLI `apps/cli/src/main.ts:250`
- Trigger: Hosts with multiple network interfaces (Docker, Tailscale, VirtualBox).
- Workaround: Pass `--host <ip>` explicitly.

**Web `SessionView` derives transport asynchronously, then conditionally swaps to `PtySessionView` — duplicate first fetch:**
- Symptoms: For a pty-event-stream session, `SessionView` first calls `/api/sessions/:id/snapshot` once, then re-renders into `PtySessionView`, which then `replayEvents` from event id 0. The pre-`PtySessionView` snapshot fetch is wasted and momentarily shows an empty `<pre>`.
- Files: `apps/web/src/main.tsx:186-228`
- Trigger: Any pty-event-stream session opened from a fresh page load.
- Workaround: None user-visible beyond a flash; functional but wasteful.
- Fix approach: Fetch the session metadata once, then mount `PtySessionView` or the legacy view directly.

**Race when control client disconnects mid-input:**
- Symptoms: When the controller socket closes, the next observe-mode controller is promoted, but any input frame already in flight from the leaving controller may have produced a `user.input` event that lacks attribution to the new controller.
- Files: `apps/gateway/src/daemon.ts:308-358`
- Trigger: Controller closes browser tab while typing.
- Workaround: None.

**SessionList "history" filter mutates server-supplied list without bounds check on `slice(0, 8)`:**
- Symptoms: When `historyData.sessions` excludes active ids, `slice(0, 8)` may show stopped sessions that the user expects under "History" — fine. But there is no pagination beyond 8.
- Files: `apps/web/src/main.tsx:104-107`
- Trigger: > 8 historical sessions.
- Workaround: None — older history is hidden.

**`tether attach` against a tmux session sends raw `--observe` / `--control` flags that have no effect:**
- Symptoms: `tether attach <id> --observe` for a tmux session silently calls `tmux attach -t <name>` and ignores the mode flag.
- Files: `apps/cli/src/main.ts:188-200`
- Trigger: Mixing CLI flags between transports.
- Workaround: Document that mode flags only apply to pty sessions.

**WebSocket `close()` reasons leak internal error codes:**
- Symptoms: `socket.close(1008, 'invalid ticket')` returns the textual reason to clients, including `'unsupported path'` and `'session not found'`. This is a low-impact information disclosure but contradicts the "no auth, no info" stance for unauthenticated paths.
- Files: `apps/gateway/src/daemon.ts:244,250,255`
- Trigger: Probing `/api/sessions/:id/stream` from the LAN.
- Workaround: None.

## Security Considerations

### CRITICAL — No authentication on the LAN-bound HTTP API

**Files:** `apps/gateway/src/daemon.ts:50-199`, `apps/cli/src/main.ts:131-134`, `apps/cli/src/main.ts:166-170`

**Risk:** When the gateway is bound with `--host 0.0.0.0` (required for phone access), every endpoint — including `POST /api/sessions/:id/input`, `POST /api/sessions/:id/send`, `POST /api/sessions/:id/stop`, and the `POST /api/ws-ticket` issuer — accepts unauthenticated requests from anyone on the LAN. The CLI prints "Demo mode: this LAN bind has no auth. Use only on a trusted network." but nothing enforces it.

**Mitigation in place:** The CLI prints a warning. WS upgrades do require a one-time ticket, but the ticket-issuing endpoint itself is unauthenticated, so any LAN attacker can mint a ticket and connect.

**Impact:** Anyone on the same Wi-Fi / LAN can:
1. Stream the live terminal output of an in-progress agent session (read API keys, source code, model output).
2. Inject input bytes into the running PTY (`POST /api/sessions/:id/input`) — that is, arbitrary keystrokes into a Codex / Claude / opencode CLI which may have shell-out tools enabled.
3. Stop sessions.

**Recommendations:**
- Implement device-token auth (already on the Phase 2.5 roadmap per `AI_CONTEXT.md:46-65`) before any further public-feeling release.
- In the meantime, refuse to bind non-loopback hosts unless `TETHER_ALLOW_INSECURE=1` or a similar opt-in env is set.
- Require an `Authorization: Bearer <token>` header on the ticket issuer once per launch (token written to `~/.tether/...`, readable by the local user only).

### HIGH — WebSocket lacks Origin / CSRF protection

**Files:** `apps/gateway/src/daemon.ts:50-54` (ticket), `apps/gateway/src/daemon.ts:239-363` (WS upgrade)

**Risk:** `POST /api/ws-ticket` has no Origin / Sec-Fetch-Site / CSRF check. With the daemon on `127.0.0.1`, any web page the user visits in any browser can:
1. `fetch('http://127.0.0.1:4789/api/ws-ticket', { method: 'POST' })` — succeeds (simple POST, no preflight).
2. Open `ws://127.0.0.1:4789/api/sessions/<guessable-or-leaked-id>/stream?ticket=...` — WS bypasses CORS entirely.
3. Stream / inject input.

**Mitigation in place:** None.

**Recommendations:**
- Reject `POST /api/ws-ticket` if the request lacks `Sec-Fetch-Site: same-origin` (or has a foreign `Origin`).
- Bind a CSRF token per-page-load and require it on the ticket request.
- Require a `Sec-WebSocket-Protocol` value chosen by the issued ticket so cross-origin opener cannot guess it.

### HIGH — IPC trust boundary: CLI `attach`/`send`/`stop` trusts `~/.tether/tether.db` and the Gateway port unconditionally

**Files:** `apps/cli/src/main.ts:188-301`, `apps/gateway/src/store.ts:73-106`

**Risk:** The CLI reads the SQLite DB directly via `Store` constructor — a per-user file in the home directory — and uses whatever `tmuxSessionName` / `command` it finds. If an attacker can write to `~/.tether/tether.db`, they can fake a session with arbitrary `tmuxSessionName` and the user running `tether attach <id>` will be `tmux attach -t <attacker-controlled-string>`. tmux does parse session targets in a constrained way, but this is still a confused-deputy concern.

**Mitigation in place:** None. File permissions inherit from `mkdirSync` defaults (umask-dependent, typically `0o777` then `0o755`).

**Recommendations:**
- `mkdirSync(dbPath, { recursive: true, mode: 0o700 })` for `~/.tether/`.
- Validate `tmuxSessionName` matches `/^tether_[a-z0-9_]+$/` before passing to `spawn('tmux', [..., name])`.

### MEDIUM — PTY child inherits the full parent environment

**Files:** `apps/gateway/src/pty.ts:40-46`

**Risk:** `pty.spawn(options.command, [], { ..., env: process.env })` passes every environment variable from the Gateway process to the spawned `codex` / `claude` / `opencode` agent. If the gateway is started by an automation context (e.g., systemd service, cron) with extra secrets in env, those leak into the agent.

**Mitigation in place:** Output masking (`maskSensitiveOutput` in `apps/gateway/src/mask.ts`) hides recognized secret formats *after* the PTY echoes them, but does not prevent the agent from reading them.

**Recommendations:** Explicit allowlist (`PATH`, `HOME`, `USER`, `TERM`, `LANG`, plus provider-specific keys) and pass through user-configured env via a config file rather than blanket inheritance.

### MEDIUM — Output masking is regex-only and therefore best-effort

**Files:** `apps/gateway/src/mask.ts:1-12`

**Risk:** Patterns cover OpenAI `sk-`, GitHub `ghp_` / `github_pat_`, and key/secret/password assignment forms. Misses:
- Anthropic keys (`sk-ant-...` matches the `sk-` prefix only by length coincidence; verify).
- Bearer tokens not preceded by an assignment.
- AWS access keys (`AKIA...`), GCP keys, Stripe keys (`sk_live_...`, `pk_live_...`), JWTs.
- Multi-line PEM blocks.
- Anything chunked across two `term.onData` callbacks (the buffer is joined per flush, so the same PEM split across flushes won't match).

**Mitigation in place:** A small set of known patterns; CLI prints a warning that this is best-effort.

**Recommendations:**
- Add patterns for AWS, Stripe, JWT, PEM blocks.
- Document the limitation in user-facing surfaces ("masking is best-effort, do not rely on it for adversarial scenarios").
- Consider a pluggable redaction list users can extend.

### MEDIUM — `~/.tether/gateways.json` is plaintext and PID-trusted

**Files:** `apps/gateway/src/registry.ts:1-108`

**Risk:** `isRecordLive` does `process.kill(record.pid, 0)` to check liveness — but on macOS / Linux, PID re-use means another user-owned process with the same PID can pass the liveness check. A local process can also write attacker-controlled `host`, `port`, `url` into the registry; the Web UI's session list (`apps/web/src/main.tsx:138-144`) then renders this URL verbatim without sanitization (React escapes text but the URL is still trust-displayed).

**Mitigation in place:** Liveness check + 30s staleness window. JSON validation in `isGatewayRecord` ensures shape but not values.

**Recommendations:**
- Set `~/.tether/gateways.json` perms to `0600`.
- Validate `host` is `127.0.0.1` or matches a sane IPv4/hostname regex.
- Validate `port` is a positive integer in 1..65535.

### LOW — `/assets/*` path traversal check is correct but fragile

**Files:** `apps/gateway/src/daemon.ts:201-211`

**Risk:** `path.resolve(webDistDir, c.req.path.replace(/^\//, ''))` followed by `assetPath.startsWith(webDistDir)` is the right pattern. Edge case: on case-insensitive filesystems (macOS default, Windows), an attacker who can trick the routing into a different-case prefix could in theory bypass `startsWith`. Hono's path normalization should already prevent this, but it's worth a comment.

**Mitigation in place:** `startsWith(webDistDir)` after `path.resolve`.

**Recommendations:** Use `path.relative(webDistDir, assetPath).startsWith('..')` as the check, which is case-insensitive-safe.

## Performance Bottlenecks

**HTTP fallback transport polls every 500 ms:**
- Problem: When `webTransportMode === 'http'`, the browser polls `/api/sessions/:id/events?after=...` at 500 ms intervals indefinitely. Every poll hits SQLite + JSON serialization.
- Files: `apps/web/src/main.tsx:478`
- Cause: Designed as a "best-effort browser fallback" per the comment at `apps/web/src/main.tsx:471`.
- Improvement path: Long-poll with `If-None-Match` / event-id ETag, or push the user toward WS by default.

**Session list polling every 3 s, snapshot every 1.5 s:**
- Problem: `SessionList` and the legacy `SessionView` poll regardless of whether anything changed.
- Files: `apps/web/src/main.tsx:116, 222, 550`
- Cause: Simplest possible refresh strategy.
- Improvement path: SSE/WS for the session-list page; reuse the per-session WS for live updates.

**`listSessions` reloaded on every tmux liveness check:**
- Problem: `markRunningPtySessionsLost` calls `this.listSessions()` and then filters in JS. Same in `daemon.ts:56-77`.
- Files: `apps/gateway/src/daemon.ts:60-77`, `apps/gateway/src/store.ts:152-162`
- Cause: Convenience.
- Improvement path: SQL `WHERE status='running' AND transport='pty-event-stream' AND id NOT IN (...)`.

**`transcript()` SELECTs every `terminal.output` event up to 5000 rows then reverses:**
- Problem: For long sessions, the legacy snapshot pulls 5000 rows per fetch and reverses in memory.
- Files: `apps/gateway/src/store.ts:205-221`
- Cause: Used to build a textual snapshot for the legacy `<pre>` UI.
- Improvement path: Once `pty-event-stream` is the only transport, drop `transcript()` entirely; xterm.js consumes events directly.

**Output flush window of 16 ms:**
- Problem: `setTimeout(..., 16)` per session means every PTY producing chatty output triggers ~60 SQLite inserts / sec.
- Files: `apps/gateway/src/pty.ts:182-185`
- Cause: Targeting one frame's worth of latency.
- Improvement path: Adaptive batching (longer interval if bytes accumulate slowly), or write-ahead WAL with periodic checkpoint already in `journal_mode = WAL`.

## Fragile Areas

**`PtySessionManager` lifecycle vs. `Store.markRunningPtySessionsLost`:**
- Files: `apps/gateway/src/pty.ts:32-92`, `apps/gateway/src/daemon.ts:231-237`, `apps/gateway/src/store.ts:152-162`
- Why fragile: At gateway startup, the daemon marks any `running` pty session not in the live id set as `lost`. But sessions can only ever be "live" within the very Gateway process that spawned them, because `PtySessionManager` is in-memory. So *every* prior pty session is always marked lost on gateway restart. Subtly correct but easy to break if multi-process Gateway is introduced.
- Safe modification: Document this invariant. When migrating to multi-process, replace with a heartbeat-based scheme.
- Test coverage: `apps/gateway/src/daemon.test.ts:20-47` covers the basic "lost" path; no test covers the "live handle survives restart" case (because by design it can't).

**WebSocket `controllers` map keyed by session, no GC on session deletion:**
- Files: `apps/gateway/src/daemon.ts:48-49`, `apps/gateway/src/daemon.ts:267-269`, `apps/gateway/src/daemon.ts:355`
- Why fragile: When a session ends (`session.exited`), the daemon never explicitly clears `clients.get(sessionId)` or `controllers.delete(sessionId)`. They drain only when individual sockets close. If sockets stay open after the PTY exits, the maps retain entries.
- Safe modification: Hook into `pty.onExit` (already in `apps/gateway/src/pty.ts:81-92`) to broadcast and close all sockets for that session.
- Test coverage: None.

**Two `Store` instances per CLI invocation:**
- Files: `apps/cli/src/main.ts:191, 206, 246, 261, 287` each call `new Store()`.
- Why fragile: Each call opens a SQLite connection without explicit close. Works because the process is short-lived, but combined with `mode: WAL`, leftover `-wal` / `-shm` files accumulate in `~/.tether/`.
- Safe modification: Inject a single `Store` from a top-level `program.hook('preAction', ...)`.
- Test coverage: None.

**`as unknown as HttpServer` cast:**
- Files: `apps/gateway/src/daemon.ts:239`
- Why fragile: `@hono/node-server` returns a `ServerType` that is structurally compatible with `node:http.Server`. The cast bypasses TypeScript's check; if `@hono/node-server` ever returns a non-HTTP server (HTTP/2, Bun adapter), `WebSocketServer` will throw at runtime.
- Safe modification: Pin `@hono/node-server` and add a runtime `instanceof` assertion.

**Ticket map has no upper bound:**
- Files: `apps/gateway/src/daemon.ts:47, 50-54, 427-434`
- Why fragile: `tickets` grows on every `POST /api/ws-ticket`. Expired entries are only deleted on consumption (or on use of the same ticket again). An attacker can flood ticket creation to grow the map indefinitely.
- Safe modification: Sweep expired entries on a timer, or cap to N most recent and reject on overflow.

**Process-wide `setInterval` heartbeat keeps the gateway alive when callers `await close()`:**
- Files: `apps/gateway/src/daemon.ts:376-379, 384`
- Why fragile: `heartbeat.unref()` and `clearInterval(heartbeat)` are both used; if a future refactor removes one, the gateway will leak the interval or fail to exit cleanly.
- Safe modification: Keep both; add a comment explaining why both `unref()` *and* explicit `clearInterval` are needed.

## Scaling Limits

**Single SQLite DB at `~/.tether/tether.db`:**
- Current capacity: Tested with one user, a handful of sessions, kilobytes of events.
- Limit: Append-only event log grows without rotation; no compaction. A multi-day Codex session producing chatty output will write GBs to a single SQLite file.
- Scaling path: Periodic compaction (drop `terminal.output` events older than N hours), or move event log to per-session files.

**Per-process Gateway:**
- Current capacity: One Gateway process owns the sessions it spawned.
- Limit: Cannot share sessions across `tether` invocations; multi-session-per-Gateway requires a different port per CLI as documented in `AI_CONTEXT.md:155-162`.
- Scaling path: Real Gateway supervisor (already on the Phase 2.5 roadmap).

## Dependencies at Risk

**`node-pty@1.2.0-beta.2`:**
- Risk: Pinned to a beta version. node-pty has a history of breaking on Node minor upgrades and platform-specific compile failures.
- Files: `apps/gateway/package.json:21`
- Impact: PTY transport (the new default) breaks if node-pty fails to install on a contributor's machine.
- Migration plan: Upgrade to a stable release once published; have a documented `--transport tmux` fallback (which we currently do).

**`better-sqlite3@^11.10.0`:**
- Risk: Native module — must be rebuilt for each Node major. `pnpm.onlyBuiltDependencies` already lists it (`package.json:30-34`), but a global pnpm install without the project context will skip it.
- Files: `apps/gateway/package.json:18`
- Impact: First-time setup may fail with cryptic "module did not self-register" errors.
- Migration plan: Document `pnpm rebuild better-sqlite3` in README.

## Missing Critical Features

**No device-token / pairing auth:**
- Problem: All security guarantees today rely on the LAN being trusted. There is no pairing flow, no revocation, no per-device session log.
- Blocks: Any non-localhost deployment, any release outside the developer's own network.

**No structured logger:**
- Problem: All output goes through `console.log` / `console.error`. There is no log level, no file logging, no correlation id.
- Blocks: Debugging real-world session issues; auditing.

**No graceful shutdown for the Gateway:**
- Problem: `apps/cli/src/main.ts:403-409` waits for `SIGINT`/`SIGTERM` and then calls `daemon.close()`, but `PtySessionManager` does not flush its 16ms output buffer or terminate live PTYs on exit. Live sessions become orphaned PIDs.
- Blocks: Clean restart story; orphaned `codex` / `claude` processes after `Ctrl-C`.

**No rate limiting on input/send endpoints:**
- Problem: `POST /api/sessions/:id/input` and `/send` have no per-client rate limit; the only guard is `body.text.length > 4000` for `send`.
- Blocks: Denial-of-service from a single LAN client.

## Test Coverage Gaps

The repo currently ships **three** test files totaling ~237 lines, all under `apps/gateway/src`:

| Test file | Lines | Coverage |
|-----------|-------|----------|
| `apps/gateway/src/daemon.test.ts` | 133 | Lost-session marking, observe-mode write rejection, stop endpoint |
| `apps/gateway/src/pty.test.ts` | 58 | Single PTY echo + masking |
| `apps/gateway/src/store.test.ts` | 46 | Insert + event append + transcript |

**Untested production code (high-risk first):**

**`apps/gateway/src/registry.ts` — gateway registry, 107 lines, 0 tests:**
- What's not tested: `registerGateway` deduplication, `isRecordLive` PID liveness, stale-record sweep, malformed JSON handling.
- Risk: Silent corruption of `~/.tether/gateways.json`, ghost gateways shown in Web UI.
- Priority: High (security-adjacent).

**`apps/gateway/src/mask.ts` — secret masking, 12 lines, 0 tests:**
- What's not tested: All four patterns. Indirect coverage exists in `pty.test.ts` for one OpenAI-style key only.
- Risk: A regex regression silently un-masks secrets in stored events.
- Priority: High (security).

**`apps/gateway/src/tmux.ts` — tmux subprocess wrapper, 102 lines, 0 tests:**
- What's not tested: Argument escaping, ENOENT path, stderr propagation.
- Risk: tmux fallback breaks silently.
- Priority: Medium (deprecated code path).

**`apps/cli/src/main.ts` — entire CLI, 409 lines, 0 tests:**
- What's not tested: Argument parsing, transport selection, `attachPtySession` WS handshake, `requestWsTicket` error paths, `parsePort` / `parseTransport`.
- Risk: CLI regressions caught only by manual `pnpm tether ...` runs.
- Priority: High.

**`apps/web/src/main.tsx` — entire Web client, 623 lines, 0 tests:**
- What's not tested: Routing, transport switching, terminal lifecycle, replay-then-stream sequencing, race between replay and live frames.
- Risk: UI regressions in the primary user surface.
- Priority: High.

**`apps/gateway/src/daemon.ts` — partial coverage:**
- What's not tested: `/api/sessions` GET reconciliation, `/api/sessions/:id/snapshot`, `/api/sessions/:id/send` (text length validation, tmux 410 path), `/api/sessions/:id/clients`, `/api/sessions/:id/events` query parsing, asset serving + path traversal guard, ticket expiration edge case, controller hand-off on disconnect.
- Risk: API contract drift.
- Priority: High.

**`apps/gateway/src/ids.ts`, `apps/gateway/src/index.ts`, `packages/*/src/index.ts`:**
- What's not tested: `createSessionId` collision/format guarantees; package barrel exports.
- Risk: Low.
- Priority: Low.

**No end-to-end test:**
- What's not tested: CLI → Gateway → Web round-trip. `PROJECT.md:46-49` even mandates "终端 / 子进程交互改动：在本地实际起 Gateway + PTY event stream 验证一次端到端" — but this is currently a manual checklist with no automation.
- Risk: Cross-component breakage caught only at hand-test time.
- Priority: High.

---

*Concerns audit: 2026-05-01*
