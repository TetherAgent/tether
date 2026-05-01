# Stack Research

**Domain:** Tether v0.3 — finishing Phase 2 hardening for remote access
**Researched:** 2026-05-01
**Confidence:** HIGH (existing stack verified; new additions verified via official docs and multiple sources)

> This file covers only what is NEW or NOT YET DECIDED for v0.3.
> The existing validated stack (Hono, better-sqlite3, node-pty, xterm.js, React 19,
> Vite, tsx, pnpm, Node 20+) is intentionally not re-researched here.

---

## Topic 1: Detach Key / Command Mode

**Decision: `Ctrl-]` as the single-chord detach key, implemented CLI-side only.**

### Landscape

| Tool | Escape mechanism | Chord | Notes |
|------|-----------------|-------|-------|
| tmux | prefix + `d` | `Ctrl-b d` | Two-key; tmux brand; collides with many apps |
| screen | Ctrl-a d | `Ctrl-a d` | Two-key; Ctrl-a is heavily used by readline/shells |
| mosh | escape char + `.` | `Ctrl-^ .` (or `~.`) | Ctrl-^ is ASCII RS (0x1E); two keys after escape |
| abduco | `Ctrl-\` (configurable via `-e`) | Single key | ASCII FS (0x1C); rarely used by apps; somewhat discoverable |
| zellij | Unlock-First preset: `Ctrl-g` then mode commands | Two-key prefix → mode | Most discoverable (statusbar helps); heavier design |
| wezterm | Leader key timeout (`Ctrl-a` for 1 s) | Single press activates leader | Great for multiplexer; overkill for single detach |

### Recommendation

Use `Ctrl-]` (ASCII GS, 0x1D) as the single detach chord.

**Why `Ctrl-]`:**
- Does not collide with readline (Ctrl-a, Ctrl-e, Ctrl-c, Ctrl-d all used).
- Does not collide with common agent TUI shortcuts (Codex, Claude use Ctrl-c, Ctrl-d).
- Rarely emitted by shells or TUI apps (historically the "group separator" control code).
- Single keypress — no timeout, no two-stroke sequence, no mode state.
- Same character used by `telnet` for its escape, so it has established mental model for "exit this session without killing the remote side".
- abduco's `Ctrl-\` (0x1C) is close but can conflict on some keyboards that map it to the Quit signal (SIGQUIT).

**Do NOT use:**
- `Ctrl-b d` — tmux association; users will expect tmux prefix behavior.
- `Ctrl-a d` — screen association; `Ctrl-a` is readline "go to beginning of line", collides constantly.
- `Ctrl-^` (mosh style) — requires modifier key combination many keyboards make awkward.
- Zellij's modal unlock design — Tether has one session per attach, not a window manager; the modal overhead is not justified.

**Implementation:** CLI-side only, inside `attachPtySession`'s `stdin.on('data')` handler. The byte `\x1d` is consumed before forwarding to the WebSocket. Gateway sees a normal socket close and fires the existing `client.detached` path. No Gateway changes needed. See ARCHITECTURE.md §5 for the code pattern.

**Confidence:** MEDIUM — no authoritative "right answer" for new tools; reasoning based on collision analysis and established precedents.

---

## Topic 2: Bracketed Paste Handling

**Decision: Pass all paste bytes through unmodified to the PTY; set `ignoreBracketedPasteMode: false` in xterm.js (default); add chunked-write throttle for large pastes.**

### How it works

Bracketed paste mode is controlled by the child process (the agent), not the terminal emulator or the PTY layer. When Claude/Codex enables bracketed paste (by sending `\x1b[?2004h`), the terminal emulator (xterm.js on the browser, the user's own terminal on the CLI) wraps pasted text in `\x1b[200~` … `\x1b[201~`. These wrapper sequences arrive as ordinary input bytes to the PTY. The Gateway's only job is to relay them faithfully.

### Gateway-side (node-pty)

No special parsing or stripping is needed. The PTY writes whatever bytes arrive from the WS `input` frame. The `\x1b[200~` / `\x1b[201~` markers are transparent to node-pty.

**Backpressure concern:** Large pastes (>1 KB) can cause a node-pty buffer overflow and dropped bytes if written in one synchronous call. Mitigation: chunk large writes.

```typescript
// Chunked PTY write for paste safety
const CHUNK = 512;
function safeWrite(ptyProcess: IPty, data: string) {
  if (data.length <= CHUNK) {
    ptyProcess.write(data);
    return;
  }
  let offset = 0;
  const flush = () => {
    if (offset >= data.length) return;
    ptyProcess.write(data.slice(offset, offset + CHUNK));
    offset += CHUNK;
    setImmediate(flush); // yield event loop between chunks
  };
  flush();
}
```

This is NOT a new dependency — it is a pattern applied to the existing `ptyProcess.write` call in `pty.ts`.

### xterm.js side (browser)

xterm.js ^6.0.0 (already in stack) handles bracketed paste correctly by default. The `ITerminalOptions.ignoreBracketedPasteMode` option (type `boolean`) controls whether to strip the `\x1b[200~` / `\x1b[201~` markers. Default is `false` — markers are preserved and forwarded. Leave this at the default.

**Do NOT set `ignoreBracketedPasteMode: true`** — that would strip the brackets and break agent apps (like Claude Code) that rely on them to detect paste vs typed input.

### Confirmed xterm.js behavior (HIGH confidence)

`@xterm/xterm` ^6.0.0 supports bracketed paste. No addon is needed. The option `ignoreBracketedPasteMode` exists in `ITerminalOptions` and defaults to `false`. Source: official xterm.js API docs at xtermjs.org.

**Confidence:** HIGH for xterm.js behavior (verified via official docs); MEDIUM for the chunked-write pattern (community consensus, no single authoritative source).

---

## Topic 3: ANSI / Alternate Screen / Cursor / Clear Screen Handling for TUIs

**Decision: Do not strip or parse ANSI escape sequences in the Gateway event store. Pass through raw. For @xterm/headless to track alternate-screen state server-side if needed in the future, use `@xterm/headless` + `@xterm/addon-serialize`.**

### What Codex, Claude Code, and OpenCode actually emit

Claude Code uses React + a custom Ink-like renderer. It sends frequent full-screen repaint sequences. Key behaviors confirmed via issue tracker and official docs:

- It uses the alternate screen buffer (`\x1b[?1049h` / `\x1b[?1049l`) when in fullscreen mode (`CLAUDE_CODE_NO_FLICKER=1` or `/tui fullscreen`). Default mode does NOT use alternate screen — it appends to scrollback.
- It emits `xterm-256color` compatible sequences. It reads `TERM` from the environment; setting `TERM=xterm-256color` is required (node-pty already sets `name: 'xterm-256color'`).
- Known tmux issue: duplicate/ghost frames in tmux because tmux intercepts alternate screen sequences differently. This is not a Tether problem — Tether passes the bytes through; xterm.js renders them correctly.
- OpenCode uses opentui (TypeScript + Zig renderer, SolidJS/React), also emits standard xterm sequences.
- Codex (older) uses Ink, which renders with space-padding and ANSI colors; no alternate screen.

### Gateway event store

The event store records `terminal.output` events with `data: string` (UTF-8). **Do not strip escape sequences** before storing. Stripping would break replay — clients need the full byte stream to render correctly in xterm.js. The secret mask in `mask.ts` is applied before storage but only to token-pattern matches, not ANSI sequences.

### Alternate screen detection

The Gateway does not currently need to know when an alternate screen is active. If a future "transcript" feature needs to strip ANSI for text-only display, use `@xterm/headless` server-side to render the byte stream and call `@xterm/addon-serialize` to get a snapshot. Do not write a custom ANSI parser.

### Server-side terminal state (future, not v0.3)

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@xterm/headless` | ^6.0.0 | Server-side terminal emulation for state tracking | Same API as `@xterm/xterm`, no DOM APIs; runs in Node |
| `@xterm/addon-serialize` | ^0.13.0 | Serialize xterm buffer to string/HTML | Used with headless to get current screen state for reconnect |

**Do NOT add these for v0.3.** They are documented here as the correct path if server-side screen state is ever needed. Do not add `node-ansiparser` or `node-ansiterminal` — these are older, lower-maintenance alternatives that `@xterm/headless` supersedes.

**Confidence:** HIGH for "pass through raw" (verified against xterm.js behavior and Claude Code docs); MEDIUM for alternate screen handling (based on observed behavior in issue trackers).

---

## Topic 4: macOS launchd for Single-User Supervisor

**Decision: Traditional `LaunchAgent` plist in `~/Library/LaunchAgents/`. No SMAppService (requires app bundle). Use `KeepAlive: true`, `RunAtLoad: true`, explicit `EnvironmentVariables` with snapshotted `PATH`.**

### Key plist structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.tether.gateway</string>

  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/node</string>
    <string>--import</string>
    <string>tsx</string>
    <string>/absolute/path/to/apps/cli/src/main.ts</string>
    <string>gateway</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>4789</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string><!-- snapshotted from process.env.PATH at install time --></string>
    <key>HOME</key>
    <string><!-- snapshotted from process.env.HOME at install time --></string>
    <key>TERM</key>
    <string>xterm-256color</string>
  </dict>

  <key>WorkingDirectory</key>
  <string><!-- absolute path to monorepo root --></string>

  <key>StandardOutPath</key>
  <string><!-- absolute path: process.env.HOME + '/.tether/gateway.log' --></string>

  <key>StandardErrorPath</key>
  <string><!-- absolute path: process.env.HOME + '/.tether/gateway.err' --></string>
</dict>
</plist>
```

### Critical constraints

**$HOME is NOT expanded in plists.** launchd does not perform variable substitution in plist XML. All paths — `StandardOutPath`, `StandardErrorPath`, `WorkingDirectory`, `ProgramArguments` — must be absolute strings. The `launchd.ts` helper must resolve these at install time using `process.env.HOME` and write literal absolute paths into the XML.

**EnvironmentVariables is essential.** launchd user agents start with a minimal environment stripped of user shell configuration. `PATH` will not include Homebrew (`/opt/homebrew/bin`), nvm, mise, or any custom binary locations. The `launchd.ts` installer must snapshot `process.env.PATH` at the moment `tether gateway --install` is run (when the user's shell env is active) and embed it literally.

**KeepAlive: true** is the simplest crash-recovery strategy for v0.3. It restarts the Gateway unconditionally on any exit. If the Gateway is intentionally stopped (`launchctl unload` or `tether gateway --uninstall`), launchd stops respecting KeepAlive. This is the correct behavior.

**Do NOT use `KeepAlive.SuccessfulExit: false`** for v0.3. The semantics (restart only on non-zero exit) are subtly different from what we want: a Gateway that exits cleanly due to a bug would not be restarted. Use unconditional `KeepAlive: true` during the v0.3 stability phase.

**Do NOT use SMAppService.** SMAppService requires the helper to be packaged inside an app bundle (macOS 13+). Tether is a developer CLI tool distributed by cloning a repo — it does not have an app bundle. The traditional `~/Library/LaunchAgents/` plist mechanism is the correct approach for this distribution model.

### launchctl commands for `launchd.ts`

```typescript
// Install
spawn('launchctl', ['load', plistPath]);

// Uninstall
spawn('launchctl', ['unload', plistPath]);

// Status
spawn('launchctl', ['list', 'sh.tether.gateway']);
```

All use `child_process.spawn(cmd, args, { stdio: 'pipe' })` — never `shell: true`.

### No new npm dependencies needed

The entire `launchd.ts` module is pure Node.js: `fs.writeFileSync` for the plist, `child_process.spawn` for launchctl. Zero new packages.

**Confidence:** HIGH for plist mechanics (verified via official Apple docs and launchd.info); HIGH for $HOME limitation (verified via Apple Developer Forums); MEDIUM for `KeepAlive: true` vs `SuccessfulExit` tradeoff (documented, but recommended behavior for v0.3 based on stability goals).

---

## Topic 5: Device-Token Pairing Scheme

**Decision: `crypto.randomUUID()` for token generation; `crypto.createHash('sha256')` for storage; 6-digit `crypto.randomInt(100000, 999999)` for one-time pairing code; 60-second TTL for the code, held in memory only.**

### Token format

A device token is a UUID v4 generated by `crypto.randomUUID()`. This gives 122 bits of entropy — sufficient for a local-first single-user system with no rate-limiting concerns.

**Why UUID v4 via `crypto.randomUUID()`:**
- Built into Node.js 20+ (`node:crypto`). No external dependency.
- 122 bits of entropy. Far exceeds any reasonable attack surface for a local LAN-only service.
- URL-safe (hex + hyphens). Works in `Authorization: Bearer` headers without encoding.

**Do NOT use `crypto.randomBytes(32).toString('hex')` directly for tokens** — while the entropy is equivalent, UUID is self-documenting in format, and `crypto.randomUUID()` is the idiomatic Node 20+ choice.

**Do NOT use JWT** — adds a dependency, a shared secret management problem, and unnecessary structure for a local-only opaque bearer token.

### Token storage

Store only `SHA-256(token)` in the `device_tokens` table. The raw token is returned once at pairing time and never written to disk.

```typescript
import { createHash } from 'node:crypto';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
```

**Why SHA-256 (not bcrypt/argon2) for device tokens:**
- Bcrypt/argon2 are designed for password hashing where the attacker can enumerate passwords from a dictionary. A UUID v4 token has 2^122 entropy — brute-force enumeration is computationally infeasible regardless of hash speed.
- bcrypt and argon2 would add external npm dependencies (`bcrypt` requires native bindings; `argon2` also requires native bindings or WASM). Node's built-in `createHash('sha256')` is sufficient.
- SHA-256 lookup is O(1) and non-blocking. Bcrypt comparison takes 100ms+ intentionally — wasteful for a high-frequency auth check on every WS ticket request.

### One-time pairing code

```typescript
import { randomInt } from 'node:crypto';

// Generates a 6-digit code: 100000–999999
const code = randomInt(100000, 999999).toString();
```

**Why `crypto.randomInt` not `Math.random()`:** `Math.random()` is not cryptographically secure. `crypto.randomInt` uses OS randomness and avoids the modulo bias that affects `crypto.randomBytes` used with `%`.

**Why 6 digits:** Short enough for a human to transcribe from the Mac screen to a mobile browser. Long enough that brute-force within the 60-second TTL window is infeasible (max 60 attempts at 1/s rate = 0.06% success against 900,000 code space).

**TTL:** Hold in a `Map<string, { code: string; expiresAt: number }>` in process memory, keyed by `pairingId` (UUID). Expire after 60 seconds. Scan on each confirm request — no cron needed given the small expected volume.

### Token revocation

The `device_tokens` table supports revocation by DELETE. A future `tether revoke <deviceName>` command performs `DELETE FROM device_tokens WHERE device_name = ?`. No token rotation is needed in v0.3 (local-first, single-user, no refresh token infrastructure).

### No new npm dependencies

All primitives (`randomUUID`, `randomInt`, `createHash`) are in `node:crypto`. Zero new packages.

**Confidence:** HIGH for token generation and hashing (verified via Node.js 20 crypto docs); HIGH for SHA-256 sufficiency for high-entropy tokens (standard practice, OWASP aligned); MEDIUM for 6-digit code format (convention, not formally standardized).

---

## Topic 6: WebSocket Auth for Browsers (2025 Best Practice)

**Decision: Keep the existing one-time HTTP ticket approach. It is the correct pattern. Do NOT switch to `Sec-WebSocket-Protocol` header auth or cookies.**

### The browser constraint

The browser `WebSocket` API cannot set custom headers (including `Authorization: Bearer`). This is a hard platform constraint, not a Tether design choice. The three available patterns are:

| Method | How | Pros | Cons | Verdict |
|--------|-----|------|------|---------|
| **Query-param one-time ticket** | `GET /ws?ticket=<uuid>` | Industry standard; ticket is short-lived + single-use so log exposure window is tiny; already implemented | Ticket appears in server access logs briefly | **Use this — already correct** |
| `Sec-WebSocket-Protocol` header | Put JWT in the protocol field | Browser can set this header | Misuse of the protocol field; logged in WS handshake negotiation logs; Kubernetes/AWS AppSync do this but it's a hack | Avoid |
| `SameSite` cookie | Set a session cookie on the HTTP domain | No header hack needed | Requires WebSocket on same domain; vulnerable to CSRF if `Origin` not validated; adds cookie infrastructure | Avoid for LAN-remote scenario |

### Why the existing ticket approach is correct

- The ticket is a `randomUUID()` returned by `POST /api/ws-ticket` (requires `Authorization: Bearer <device-token>`).
- Ticket TTL is 60 seconds, single-use. By the time a server log ingests the URL, the ticket is already consumed.
- The OWASP WebSocket Security Cheat Sheet explicitly endorses this pattern.
- It gates WS access on device token possession without requiring any browser capability that does not exist.

### What to verify / harden in v0.3

1. The `POST /api/ws-ticket` endpoint must require `Authorization: Bearer <device-token>` (AUTH-01). Currently it has no auth check — this is the gap to close.
2. Ticket expiry and single-use enforcement already exist (`consumeTicket()` in `daemon.ts`). Verify the in-process `Map` is not shared across potential future multi-process scenarios.
3. Log masking: ensure the `?ticket=` query param is masked in any access log output before v0.3 ships.

### Alternative considered: token-in-first-message

Some systems (GitHub's streaming APIs) pass the auth token as the first WebSocket message rather than in the handshake. This avoids URL logging but means the connection is accepted unauthenticated momentarily. Not recommended for Tether — the ticket model is cleaner and already implemented.

**Confidence:** HIGH — browser WebSocket header constraint is a platform fact; ticket pattern endorsed by OWASP; existing implementation verified in source.

---

## Topic 7: Event Retention for SQLite-Backed Event Store

**Decision: Time-based deletion with `DELETE WHERE ts < cutoff` on a 15-minute interval; size-based per-session deletion via row count estimate when needed; manual `VACUUM` + `wal_checkpoint(TRUNCATE)` monthly or when DB exceeds 500 MB.**

### Retention query strategy

The event store is `session_events` with columns `(id, session_id, type, ts, payload_json)`.

**Time-based (primary):**

```sql
DELETE FROM session_events WHERE ts < :cutoff;
```

Where `cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000`. Run every 15 minutes via `setInterval`. Add `timer.unref()` so it does not block shutdown.

**Size-based (secondary, per session):**

SQLite has no native byte-counting on rows. Use `SUM(length(payload_json))` as an approximation:

```sql
SELECT session_id, SUM(length(payload_json)) as approx_bytes
FROM session_events
GROUP BY session_id
HAVING approx_bytes > 104857600  -- 100 MB
```

For sessions over the limit, delete oldest rows (lowest `id` values) until under the limit. This is a two-query operation: count then delete.

**Do NOT run both checks in the same transaction** — the size-based check involves a potentially expensive aggregation and should be done infrequently (e.g., once per hour) while the time-based delete runs more frequently.

### VACUUM and WAL management

**Critical:** In WAL mode, `VACUUM` alone does not reclaim disk space. The correct sequence is:

```sql
VACUUM;
PRAGMA wal_checkpoint(TRUNCATE);
PRAGMA optimize;
```

`VACUUM` moves the rebuilt database into the WAL file. `wal_checkpoint(TRUNCATE)` writes the WAL back to the main file and truncates the WAL. Without the checkpoint, disk space is not recovered.

**When to run VACUUM:**
- Do NOT run on every retention cycle. VACUUM locks the database exclusively (blocking WS reads/writes).
- Run only when meaningful space can be recovered: when `>25%` of pages are free pages (check with `PRAGMA freelist_count` vs `PRAGMA page_count`).
- Trigger on demand via `tether gateway --vacuum` command, or programmatically when the DB file exceeds a threshold (e.g., 500 MB).
- Schedule monthly via a separate, opt-in mechanism — not automatically.

**Auto-vacuum:** Do NOT use `PRAGMA auto_vacuum = FULL`. It reorganizes pages after every delete transaction, creating per-transaction overhead and fragmentation in WAL mode. Use `PRAGMA auto_vacuum = NONE` (the better-sqlite3 default with WAL) and manage manually.

**Incremental vacuum:** Not useful here — requires `auto_vacuum = INCREMENTAL` mode, which is not compatible with the current WAL-only setup without a migration.

### No new npm dependencies

All operations use the existing `better-sqlite3` synchronous API. No new packages.

### What NOT to use

| Avoid | Why | Instead |
|-------|-----|---------|
| `PRAGMA auto_vacuum = FULL` | Per-transaction overhead, fragmentation in WAL | Manual VACUUM when space threshold exceeded |
| Running VACUUM on every retention cycle | Exclusive lock blocks WS for all clients | VACUUM only when freelist > 25% |
| External compaction tools | Better-sqlite3 is synchronous in-process; separate process requires WAL coordination | In-process `db.exec('VACUUM; PRAGMA wal_checkpoint(TRUNCATE)')` |
| `VACUUM INTO` for backups | Produces a separate file, not useful for space reclamation in the primary DB | `VACUUM` + checkpoint on the primary file |

**Confidence:** HIGH for `DELETE` query patterns (straightforward SQL); HIGH for VACUUM + checkpoint sequence (verified via PhotoStructure research and SQLite official docs); MEDIUM for the 15-minute interval and size thresholds (reasonable defaults, not formally benchmarked for this schema).

---

## Supporting Libraries — New Additions Summary

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@xterm/headless` | ^6.0.0 | Server-side terminal emulation for future transcript/state | Defer to post-v0.3; document here as the correct path |
| `@xterm/addon-serialize` | ^0.13.0 | Serialize headless terminal state | Defer with headless; do not add in v0.3 |
| All others | — | Detach key, bracketed paste, launchd, device tokens, WS auth, retention | Zero new dependencies; all use Node built-ins |

**v0.3 adds zero new npm packages.** All seven topics are addressed using Node.js 20+ builtins (`node:crypto`, `fs`, `child_process`) and patterns applied to existing code.

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `bcrypt` / `argon2` for device tokens | Native bindings, slow by design (wrong tool for high-entropy tokens), external dep | `node:crypto` `createHash('sha256')` |
| JWT for device auth | External dep (`jsonwebtoken`), key management overhead, unnecessary structure for local opaque token | `crypto.randomUUID()` + SHA-256 store |
| `Math.random()` for pairing codes | Not cryptographically secure | `crypto.randomInt(100000, 999999)` |
| `Sec-WebSocket-Protocol` header for auth | Misuse of protocol field; logged by proxies; fragile | Existing one-time ticket via query param |
| Cookie-based WS auth | CSRF exposure, domain constraint, wrong for LAN-remote scenario | Existing one-time ticket |
| SMAppService for launchd | Requires app bundle; not applicable to CLI-installed tool | Traditional `~/Library/LaunchAgents/` plist |
| `auto_vacuum = FULL` in SQLite | Per-transaction overhead in WAL mode | Manual VACUUM on demand |
| Stripping ANSI escape sequences in the Gateway | Breaks replay (clients need raw bytes for xterm.js rendering) | Pass through raw; strip only in text-only transcript paths using `@xterm/headless` |
| Intercepting detach key in the Gateway | Gateway cannot distinguish user intent from agent input | Intercept in CLI `stdin.on('data')` before forwarding to WS |
| `Ctrl-b` as detach prefix | tmux association; Ctrl-b is sent as input by many terminals | `Ctrl-]` (0x1D, GS) |
| `node-ansiparser` / `node-ansiterminal` | Lower maintenance, superseded | `@xterm/headless` + `@xterm/addon-serialize` for future use |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@xterm/xterm` ^6.0.0 | `@xterm/addon-fit` ^0.11.0 | Already in stack; no changes for v0.3 |
| `@xterm/headless` ^6.0.0 | `@xterm/addon-serialize` ^0.13.0 | Same major version; install together if needed post-v0.3 |
| `node:crypto` (Node 20+) | `randomUUID`, `randomInt`, `createHash` all stable | `randomUUID` added in Node 15; `randomInt` in Node 14.10 — both well within Node 20+ target |

---

## Sources

- xterm.js `ITerminalOptions` API docs (xtermjs.org) — `ignoreBracketedPasteMode` option confirmed, v6.0.0
- Claude Code terminal configuration docs (code.claude.com) — alternate screen behavior, TERM requirements, tmux passthrough
- OWASP WebSocket Security Cheat Sheet — one-time ticket pattern endorsed
- Ably WebSocket authentication blog — three-way comparison of query param vs `Sec-WebSocket-Protocol` vs cookies
- launchd.info — KeepAlive/RunAtLoad patterns, user agent paths
- Apple Developer Forums thread on `$HOME` in launchd plists — confirmed $HOME not expanded; must use literal absolute paths
- PhotoStructure SQLite VACUUM + WAL research — VACUUM + `wal_checkpoint(TRUNCATE)` sequence
- Node.js 20 `node:crypto` docs — `randomUUID`, `randomInt`, `createHash` APIs
- mosh man page (man.archlinux.org) — `Ctrl-^` escape key design
- abduco man page / GitHub (martanne/abduco) — `Ctrl-\` default, `-e` customization
- zellij Unlock-First preset docs — prefix design philosophy
- `@xterm/headless` npm and xtermjs GitHub — headless + serialize use case for server-side state

---

*Stack research for: Tether v0.3 — finishing Phase 2 for remote access*
*Researched: 2026-05-01*
