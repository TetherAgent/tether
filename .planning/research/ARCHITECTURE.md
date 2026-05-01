# Architecture Research

**Domain:** v0.3 Remote Access — integration into existing PTY event stream Gateway
**Researched:** 2026-05-01
**Confidence:** HIGH (all analysis derived directly from existing source files)

## Standard Architecture

### System Overview (current + v0.3 additions)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           UI Surfaces (clients)                               │
├────────────────────┬───────────────────────────┬─────────────────────────────┤
│  CLI attach client │     Web client (PWA)       │     Native (placeholder)    │
│  apps/cli/main.ts  │  apps/web/src/main.tsx     │     native/flutter/         │
│  raw stdin/stdout  │  xterm.js + React 19       │     (empty, future)         │
│                    │                             │                             │
│  [v0.3] detach     │  [v0.3] pairing UI         │                             │
│  hotkey intercept  │  (one-time code display)   │                             │
└─────────┬──────────┴────────────┬───────────────┴────────────┬────────────────┘
          │ HTTP + WebSocket      │ HTTP + WebSocket            │ (future)
          │ (event-stream frames) │ (event-stream frames)       │
          │ + device-token Bearer │ + one-shot WS ticket        │
          ▼                       ▼                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Tether Gateway (Node.js)                              │
│                       apps/gateway/src/                                       │
│                                                                               │
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │  HTTP + WS server   │  │  PtySessionManager   │  │  [v0.3 new]          │ │
│  │  daemon.ts          │  │  pty.ts              │  │  supervisor.ts       │ │
│  │  + [v0.3] device    │  │  spawns node-pty     │  │  single-process      │ │
│  │  token auth on all  │  │  per session         │  │  session owner       │ │
│  │  write endpoints    │  │                      │  │                      │ │
│  └────────┬────────────┘  └──────────┬───────────┘  └──────────────────────┘ │
│           │                          │                                        │
│           ▼                          ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  Store (better-sqlite3, append-only events)      store.ts               │ │
│  │  [v0.3] device_tokens table + pairing state      store.ts (migration)   │ │
│  │  [v0.3] retention: periodic DELETE on events     retention.ts (new)     │ │
│  │  Gateway registry (file-backed)                  registry.ts            │ │
│  │  Sensitive-data masking                          mask.ts                │ │
│  │  Session ID generator                            ids.ts                 │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Local persistence — ~/.tether/                                               │
│   tether.db      sessions + session_events + [v0.3] device_tokens            │
│   gateways.json  running gateway registry                                     │
│   [v0.3]         launchd plist written by `tether gateway --install`          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

All existing components retain their responsibilities unchanged. V0.3 adds or
extends the following.

| Component | File | v0.3 Change | Scope |
|-----------|------|-------------|-------|
| HTTP/WS server | `daemon.ts` | Add device-token Bearer check to write endpoints; add `/api/pair` routes | AUTH-01, AUTH-02 |
| PTY session manager | `pty.ts` | No change to PTY logic itself | — |
| Session/event store | `store.ts` | Add `device_tokens` table via migration; add retention query helper | AUTH-02, RETAIN-01 |
| Retention job | `retention.ts` (new) | Periodic cleanup: delete `session_events` rows older than 7 days or over 100 MB per session | RETAIN-01 |
| Supervisor | `supervisor.ts` (new) | Forward `POST /api/sessions` from CLI to existing Gateway; `tether gateway` becomes the single persistent process that holds all PTY handles | GW-01 |
| CLI | `apps/cli/src/main.ts` | Route `tether run/codex/claude/opencode` → HTTP `POST /api/sessions` when a running Gateway is detected; keep in-process bootstrap as fallback | GW-01 |
| launchd helper | `launchd.ts` (new) | Write/read `~/Library/LaunchAgents/sh.tether.gateway.plist`; `tether gateway --install/--uninstall` | GW-02 |
| tmux transport | `tmux.ts` | Delete entirely (CLEAN-01) | CLEAN-01/02 |
| Web client | `apps/web/src/main.tsx` | Add pairing UI: display one-time code, confirm pairing, store device token in `localStorage` | AUTH-02 |

---

## Recommended Project Structure (v0.3 additions only)

```
apps/gateway/src/
├── daemon.ts          # existing — add auth middleware, /api/pair routes
├── pty.ts             # existing — unchanged
├── store.ts           # existing — add device_tokens migration + retention helper
├── registry.ts        # existing — unchanged
├── mask.ts            # existing — unchanged
├── ids.ts             # existing — unchanged
├── supervisor.ts      # NEW — single-Gateway session-create forwarding
├── retention.ts       # NEW — periodic event cleanup job
├── launchd.ts         # NEW — macOS launchd plist install/uninstall
└── index.ts           # existing — re-export new modules
```

No new top-level packages needed. All additions live in `apps/gateway/src/`.

---

## Architectural Patterns for Each v0.3 Item

### 1. Single-Supervisor Gateway (GW-01)

**What:** One persistent `tether gateway` process owns all PTY handles. CLI commands
`tether run / codex / claude / opencode` route session-create to that Gateway via
`POST /api/sessions` instead of booting their own in-process daemon.

**Routing logic in CLI:**

```
tether codex  (or run <provider>)
  1. Try GET http://127.0.0.1:4789/api/sessions  (liveness probe)
  2. If 200  → POST /api/sessions to running Gateway
  3. If error → fall back to current in-process startDaemon bootstrap
```

**Where it lives:**

- `apps/gateway/src/supervisor.ts` — `POST /api/sessions` handler that calls
  `ptySessions.create(...)` then returns the session id and stream URL. Mirrors the
  create logic currently in `apps/cli/src/main.ts:startPtyProviderSession`.
- `apps/cli/src/main.ts` — modify `startProviderSession` / `startPtyProviderSession`
  to probe first; no new file in cli needed.
- `apps/gateway/src/daemon.ts` — mount the `/api/sessions` POST route, delegating to
  `supervisor.ts`.

**Data flow:**

```
CLI startPtyProviderSession
  → GET /api/sessions (probe)      — if running Gateway found
  → POST /api/sessions {provider, projectPath, cols, rows}
  → daemon.ts route → supervisor.ts → ptySessions.create(...)
  → { sessionId, streamUrl }
  → CLI attachPtySession(sessionId, ...)
```

**Why not a separate IPC socket:** HTTP is already running; using the existing API
avoids a second channel and keeps auth uniform.

**Constraint:** `DaemonOptions.ptySessions` is already optional; the same `PtySessionManager`
instance already lives inside `startDaemon`. The supervisor route just adds a create-path
through the existing manager.

---

### 2. macOS launchd (GW-02)

**What:** `tether gateway --install` writes a launchd user agent plist that
auto-starts `tether gateway` on login. `--uninstall` removes it.

**Plist location:** `~/Library/LaunchAgents/sh.tether.gateway.plist`

**Data flow through `launchd.ts`:**

```
tether gateway --install
  → launchd.ts: writePlist(plistPath, { ProgramArguments: ['node', '--import', 'tsx',
      path.resolve(__dirname, '../../cli/src/main.ts'), 'gateway',
      '--host', '127.0.0.1', '--port', '4789'],
      RunAtLoad: true, KeepAlive: true })
  → spawn('launchctl', ['load', plistPath])
```

**Environment forwarding concern:** The agent process inherits the launchd session
environment, not the user's interactive shell. Required env vars (`PATH` pointing to
`node`, provider binaries) must be explicit in the plist `EnvironmentVariables` key.

**Key fields to resolve during implementation:**

- `ProgramArguments` must use the absolute path to `node` and to `main.ts`;
  relative paths fail under launchd.
- `StandardOutPath` / `StandardErrorPath` → `~/.tether/gateway.log` (not the repo;
  launchd writes here on restart).
- `KeepAlive: true` provides automatic restart on crash (replaces manual supervisor
  logic for v0.3).
- `WorkingDirectory` → `~` or the monorepo root; must be documented.

**Where it lives:** `apps/gateway/src/launchd.ts` — pure file-writer with no runtime
side-effects. CLI subcommand `gateway` gains `--install` / `--uninstall` / `--status`
flags and calls `launchd.ts` helpers.

---

### 3. Device-Token Pairing (AUTH-01, AUTH-02)

**What:** All write endpoints (`input`, `resize`, `stop`, `claim-control`) require a
device token. Pairing produces a token via a one-time code flow.

**Schema addition to `store.ts` migration:**

```sql
CREATE TABLE IF NOT EXISTS device_tokens (
  token_hash  TEXT PRIMARY KEY,     -- SHA-256(token), never store raw
  device_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER
);
```

**Pairing flow (LAN-only, no QR required in v0.3):**

```
1. Client → POST /api/pair/initiate
   Gateway: generate 6-digit code, hold in memory (60 s TTL), return { pairingId }

2. User sees code in CLI output or Web UI banner

3. Client → POST /api/pair/confirm { pairingId, code, deviceName }
   Gateway: verify code, generate token (randomUUID), hash it,
            INSERT device_tokens, return { token }
   Token is opaque to Gateway after this — only the hash is stored.

4. Client stores token in localStorage (Web) or ~/.tether/token (CLI, future).

5. All subsequent write requests:
   Authorization: Bearer <token>   (CLI/native via ws custom header)
   or include token in ws-ticket exchange (Web)
```

**Where it lives:**

- `apps/gateway/src/store.ts` — add `device_tokens` table migration; add
  `insertDeviceToken(hash, deviceName)`, `verifyDeviceToken(rawToken): boolean`.
- `apps/gateway/src/daemon.ts` — add `/api/pair/initiate` and `/api/pair/confirm`
  routes; add `authMiddleware` that checks `Authorization: Bearer` on write endpoints
  (`input`, `resize`, `stop`, `claim-control`).
- `apps/web/src/main.tsx` — add pairing UI: show code when received, store token in
  `localStorage` under `tether:deviceToken`.
- `apps/cli/src/main.ts` — `tether gateway pair` command (or inline in attach flow):
  POST initiate → prompt user to confirm code on Gateway machine.

**LAN-only constraint is preserved:** pairing requires physical presence (or LAN access
to the initiation endpoint). No relay involvement in v0.3.

**WS ticket interaction:** The existing one-shot ticket flow stays. Token is used to
_request_ a ticket (`POST /api/ws-ticket` gets the `Authorization: Bearer` check);
the ticket then authenticates the WS upgrade. This keeps the browser WS constraint
intact and centralises auth at the HTTP ticket exchange.

---

### 4. Event Retention (RETAIN-01)

**What:** Periodic deletion of `session_events` rows older than 7 days or when a
single session's rows exceed 100 MB of `payload_json`.

**Where it lives:** `apps/gateway/src/retention.ts` (new, ~50 lines).

**Integration point:** Called from `startDaemon` as a `setInterval` job:

```typescript
// daemon.ts startDaemon(), after wss setup
import { startRetentionJob } from './retention.js';
const retentionStop = startRetentionJob(options.store);
// add retentionStop() to RunningDaemon.close()
```

**Why inside Gateway, not separate process:** The store uses `better-sqlite3`
synchronous API in a single-process Gateway. A separate process would require either
file locking or WAL coordination. Running the job inside the same process is safe
and avoids the complexity.

**Retention query shape (in `retention.ts`):**

```typescript
// Age-based: delete events older than 7 days
store.db.prepare(
  `DELETE FROM session_events WHERE ts < ?`
).run(Date.now() - 7 * 24 * 60 * 60 * 1000);

// Size-based per session: rough estimate via SUM(length(payload_json))
// If > 100 MB, delete oldest rows until under limit.
```

**Data flow:**

```
setInterval (every 15 min)
  → retention.ts: deleteExpiredEvents(store)
  → store.db DELETE WHERE ts < cutoff
  → store.db check per-session size, DELETE oldest rows if over limit
```

No new events are appended on retention; it is purely destructive on old rows.
Replay cursors held by clients pointing at deleted event IDs will fall through
gracefully — `listEvents` will simply return the next available row after the gap.

---

### 5. Detach Hotkey / Command Mode (EXP-01)

**What:** A key sequence in `attachPtySession` that exits raw mode without killing the
agent. Candidates: `Ctrl-]` (single key, low collision) or `Ctrl-b d`-style two-key
prefix (more discoverable, but has tmux association risk).

**Where it lives:** `apps/cli/src/main.ts` — inside the `attachPtySession` function's
`stdin.on('data', onData)` handler.

**Implementation pattern:**

```typescript
// Terminal-side (CLI) raw mode interceptor
stdin.on('data', (chunk) => {
  const DETACH_KEY = '\x1d'; // Ctrl-]
  if (chunk.toString() === DETACH_KEY) {
    ws.close();    // triggers the existing 'close' → resolve() path
    return;        // do NOT forward to PTY
  }
  ws.send(JSON.stringify({ type: 'input', data: chunk.toString('utf8') }));
});
```

**Component boundary:** The detach key is intercepted **in the CLI raw-mode handler**,
not in the Gateway. The Gateway sees a normal socket close, appends `client.detached`,
and the existing controller-reassignment logic takes over. No Gateway change needed.

**Why CLI-side, not Gateway-side:** The Gateway does not know which bytes are
"intentional detach" vs "user typed Ctrl-] to the agent". The CLI is the only layer
that can distinguish terminal-user intent from agent input. Gateway-side interception
would require a new frame type and would add complexity without benefit.

**Impact on existing tests:** `attachPtySession` tests must be updated to confirm that
the detach key closes the WS and restores raw mode without forwarding to the PTY.

---

### 6. tmux Fallback Removal (CLEAN-01, CLEAN-02)

**What:** Delete `apps/gateway/src/tmux.ts` and remove all `transport === 'tmux'`
branch code.

**Scope of deletion:**

- `apps/gateway/src/tmux.ts` — delete entirely.
- `apps/gateway/src/daemon.ts` — remove tmux import; remove branches in `listSessions`,
  `snapshot`, `send`, `stop` that check `session.transport === 'tmux'`.
- `apps/cli/src/main.ts` — remove `assertTmuxAvailable`, `attachSession`, `createAgentSession`,
  `formatTmuxError` imports; remove `--transport tmux` option; remove tmux branch in
  `startProviderSession` and `ls`.
- `apps/gateway/src/store.ts` — `SessionTransport` type: decide whether to keep
  `'tmux'` in the union as a legacy read-only value or remove it. Recommendation:
  keep `'tmux'` only in `fromRow` for backward-compatible reads of old DB rows;
  remove it from `insertSession` types so new sessions can only be `'pty-event-stream'`.
- `packages/core/src/index.ts` — if `ProviderName` or other types reference tmux,
  clean up.

**Data flow impact:** No live data flow changes — tmux is already behind
`--transport tmux` flag. Removal is code-only.

**`transport` field (CLEAN-02):** Retain the column and the `'pty-event-stream'`
value. The `transport` field is a natural extension point (future relay or alternative
transports). Remove `'tmux'` from the active type but keep the column for historical
rows and future use. Add a comment in `store.ts` noting intent.

---

## Data Flow

### v0.3 End-to-End: CLI → Supervisor Gateway → PTY → WS → Web

```
1. launchd auto-starts `tether gateway` on login → Gateway holds store + ptySessions

2. tether codex  (in a new terminal)
     → CLI probes GET /api/sessions on :4789
     → 200 received → supervisor path
     → POST /api/sessions { provider:'codex', projectPath, cols, rows }
     → daemon.ts route → supervisor.ts → ptySessions.create(...)
     → { sessionId }
     → CLI attachPtySession(sessionId)

3. Web browser on phone
     → GET /  (served by Gateway from apps/web/dist/)
     → POST /api/pair/initiate  (if not yet paired)
     → Gateway returns { pairingId }; user sees code on Mac CLI/Web
     → POST /api/pair/confirm { pairingId, code, deviceName:'iPhone' }
     → { token }  stored in localStorage
     → POST /api/ws-ticket  Authorization: Bearer <token>
     → { ticket }
     → WebSocket /api/sessions/<id>/stream?ticket=...
```

### Device Token Auth Data Flow

```
Raw token (UUID)  →  SHA-256  →  stored in device_tokens.token_hash
                                                ↑
Authorization: Bearer <raw>  →  SHA-256  →  lookup in device_tokens
                                              ↓
                                          bool (valid/invalid)
```

Token never stored in plaintext in SQLite. Raw token returned once at pairing;
not recoverable after that (user must re-pair if lost).

### Retention Data Flow

```
setInterval (15 min)
  └─→ retention.ts:deleteExpiredEvents(store)
        ├─→ DELETE session_events WHERE ts < (now - 7d)
        └─→ for each session over 100 MB:
              DELETE session_events WHERE session_id = ? AND id IN
                (SELECT id ... ORDER BY id ASC LIMIT <excess>)
```

No fan-out to clients; purely a store mutation. Clients with stale cursors pointing
at deleted rows receive the next surviving row on next `listEvents` call.

---

## Build Order (dependency graph)

The six v0.3 items have the following dependencies:

```
EXP-01 (detach hotkey)         — no deps; self-contained CLI change
  └─ can build any time

CLEAN-01/02 (tmux removal)     — no deps on v0.3 items; depends only on
  └─ confirming no active      nothing external being tmux-only
     tmux users (safe to do
     right after EXP-01)

AUTH-02 (pairing flow)         — depends on:
  ├─ store.ts migration        store migration (device_tokens table)
  └─ daemon.ts /api/pair       daemon route extension

AUTH-01 (write-endpoint auth)  — depends on AUTH-02 (needs token table to
  └─ auth middleware            exist before auth can be checked)

RETAIN-01 (retention job)      — depends on:
  └─ store.ts helper           store.ts has device_tokens migration landed
     + daemon.ts wiring        (table migration is additive; safe to run
                               before AUTH-01 ships)

GW-02 (launchd)               — depends on GW-01 (launchd must start a
  └─ install plist             supervisor-capable gateway)

GW-01 (supervisor)            — depends on:
  ├─ daemon.ts POST /api/      existing daemon; new route only
    sessions route
  └─ CLI probe + forward       AUTH-01 ideally done first so supervisor
                               sessions are auth-protected from the start
```

**Recommended build sequence:**

1. EXP-01 — detach hotkey (unblocks EXP-02/03/04/05 validation; standalone)
2. CLEAN-01/02 — tmux removal (reduces surface area before auth work)
3. AUTH-02 — pairing flow (store migration first, then routes + Web UI)
4. AUTH-01 — write-endpoint auth middleware (depends on AUTH-02 token table)
5. RETAIN-01 — retention job (additive; can slot after AUTH-02 migration)
6. GW-01 — supervisor POST /api/sessions route + CLI probe
7. GW-02 — launchd install (depends on GW-01 being stable)

TEST-01 covers AUTH-01, AUTH-02, RETAIN-01 and should be written alongside steps 3-5.

---

## Anti-Patterns

### Duplicating PTY ownership in the supervisor

**What people do:** Create a second `PtySessionManager` inside `supervisor.ts` and
wire it to a separate store connection.

**Why it's wrong:** `PtySessionManager` holds in-memory live handles. Two instances
means two sets of handles; events from one are invisible to subscribers of the other.
`better-sqlite3` is safe for a single writer but split instances still risk state
divergence.

**Do this instead:** Pass the single `ptySessions` and `store` instances already held
by `startDaemon` into the supervisor route handler as closure variables. No new class
needed.

---

### Storing raw device tokens in SQLite

**What people do:** Insert `randomUUID()` directly into `device_tokens.token` for
easier comparison.

**Why it's wrong:** If `~/.tether/tether.db` is read by a malicious process (or
inadvertently included in a backup), raw tokens can impersonate any paired device.

**Do this instead:** Store only `SHA-256(token)`. Compare by hashing the incoming
Bearer value and doing an exact lookup. The raw token is returned once at pairing and
never written to disk.

---

### Blocking the event loop with the retention job

**What people do:** Run the retention DELETE synchronously on the main tick as part of
an HTTP request handler (e.g., on every `GET /api/sessions`).

**Why it's wrong:** `better-sqlite3` is synchronous; a DELETE across thousands of rows
will block the event loop and freeze WS output for connected clients.

**Do this instead:** Run retention inside a `setInterval` callback with a 15-minute
interval. SQLite WAL mode is already enabled; the DELETE runs without blocking reads.
Add `timer.unref()` so it does not prevent clean shutdown.

---

### Forwarding the terminal TERM env from launchd to providers

**What people do:** Omit `EnvironmentVariables` from the plist, assuming providers
inherit a sane environment.

**Why it's wrong:** launchd user agents start with a minimal environment. `PATH` will
not include Homebrew, `nvm`, or `mise`-managed runtimes. Provider binaries (`codex`,
`claude`, `opencode`) will not be found.

**Do this instead:** In `launchd.ts`, snapshot `process.env.PATH` at install time and
embed it in the plist `EnvironmentVariables`. Document that re-running `--install`
after a PATH change is required.

---

### Intercepting detach bytes at the Gateway (WS frame filter)

**What people do:** Add a special `{ type: 'detach' }` client frame and handle it in
`daemon.ts`, or filter `\x1d` out of `input` frames in the Gateway.

**Why it's wrong:** The detach key meaning is local to the CLI user's terminal
session. The Gateway cannot know whether `\x1d` is a user detach intent or a byte
the agent process legitimately expects. Putting this logic in the Gateway breaks
terminal transparency.

**Do this instead:** Intercept in `attachPtySession`'s `stdin.on('data')` handler in
`apps/cli/src/main.ts` before the byte is forwarded to the WS.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| CLI → Supervisor Gateway | `POST /api/sessions` HTTP | Probe liveness first; fall back to in-process if no gateway running |
| daemon.ts → supervisor.ts | Function call (shared closure) | ptySessions instance shared, no IPC |
| daemon.ts → retention.ts | Function call, `startRetentionJob(store)` returns stop function | Registered in daemon startup/close lifecycle |
| daemon.ts → store.ts | Direct method calls (same process) | `verifyDeviceToken(raw)` used by auth middleware |
| CLI detach hotkey → WS | CLI closes WS; no new frame type | Gateway sees normal socket close; existing `client.detached` path handles it |
| launchd.ts → shell | `child_process.spawn('launchctl', ['load'/'unload', plistPath])` | Same spawn-no-shell-true rule |

### External Boundaries

| Boundary | Notes |
|----------|-------|
| macOS launchd | Plist at `~/Library/LaunchAgents/sh.tether.gateway.plist`; env must be explicit |
| Device token storage (Web) | `localStorage['tether:deviceToken']` — survives page reload, cleared on browser data wipe |
| Device token storage (CLI) | Not implemented in v0.3; CLI is local (127.0.0.1), token optional for LAN-only CLI |

---

## Sources

- Direct inspection of `apps/gateway/src/daemon.ts`, `pty.ts`, `store.ts`
- `apps/cli/src/main.ts` full source
- `.planning/PROJECT.md` v0.3 Active requirements
- `.planning/codebase/ARCHITECTURE.md` Phase 2 architectural constraints
- `docs/working/2026-05-01-phase-2-pty-event-stream.md` §12 security model, §14 task split

---

*Architecture research for: Tether v0.3 Remote Access — integration into PTY event stream*
*Researched: 2026-05-01*
