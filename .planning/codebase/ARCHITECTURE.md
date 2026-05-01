<!-- refreshed: 2026-05-01 -->
# Architecture

**Analysis Date:** 2026-05-01

## System Overview

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              UI Surfaces (clients)                          │
├──────────────────────┬──────────────────────────┬──────────────────────────┤
│   CLI attach client  │      Web client (PWA)    │   Native (placeholder)   │
│  `apps/cli/src/main  │  `apps/web/src/main.tsx` │  `native/flutter/`,      │
│      .ts`            │  xterm.js + React 19     │  `native/harmony/`       │
│   ws + raw stdio     │                          │  (empty, future)         │
└─────────┬────────────┴───────────┬──────────────┴────────────┬─────────────┘
          │ HTTP + WebSocket       │ HTTP + WebSocket          │ (future)
          │ (event-stream frames)  │ (event-stream frames)     │
          ▼                        ▼                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         Tether Gateway (Node.js)                            │
│                       `apps/gateway/src/index.ts`                           │
│                                                                             │
│  ┌──────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐ │
│  │  HTTP + WS server    │  │  PtySessionManager  │  │  tmux fallback     │ │
│  │  `daemon.ts` (Hono + │  │   `pty.ts`          │  │  `tmux.ts`         │ │
│  │   ws WebSocketServer)│  │   spawns node-pty   │  │  spawn('tmux',...) │ │
│  │                      │  │   per session       │  │                    │ │
│  └──────────┬───────────┘  └──────────┬──────────┘  └────────┬───────────┘ │
│             │                         │                      │             │
│             ▼                         ▼                      ▼             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  Store (better-sqlite3, append-only events)  `store.ts`               │ │
│  │  Gateway registry (file-backed)              `registry.ts`            │ │
│  │  Sensitive-data masking                      `mask.ts`                │ │
│  │  Session ID generator                        `ids.ts`                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────┬───────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Local persistence and processes                                            │
│   - SQLite DB:        `~/.tether/tether.db`                                 │
│   - Gateway registry: `~/.tether/gateways.json`                             │
│   - Agent processes:  child processes (codex / claude / opencode) via      │
│                       node-pty (default) or tmux server (fallback)         │
└────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| CLI dispatcher | Parse `tether <subcommand>`, drive Gateway lifecycle, attach to PTY sessions over WS | `apps/cli/src/main.ts` |
| Gateway HTTP/WS server | Serve `/api/...`, host web UI, accept ws-ticket auth, broker stream connections | `apps/gateway/src/daemon.ts` |
| PTY session manager | Spawn `node-pty` per agent, buffer + flush output as events, route input/resize/stop | `apps/gateway/src/pty.ts` |
| Session/event store | SQLite persistence of sessions and `session_events`, transcript replay | `apps/gateway/src/store.ts` |
| tmux transport | Phase-1 fallback: `new-session`, `capture-pane`, `send-keys`, `attach` via `child_process.spawn` | `apps/gateway/src/tmux.ts` |
| Gateway registry | File-backed list of running gateways at `~/.tether/gateways.json` with stale-entry pruning | `apps/gateway/src/registry.ts` |
| Output masking | Regex-based redaction of API keys/tokens before persisting or forwarding | `apps/gateway/src/mask.ts` |
| Session ID generator | `tth_YYYYMMDD_<hex>` ids | `apps/gateway/src/ids.ts` |
| Web client | React 19 + xterm.js renderer, WS-first with HTTP-poll fallback | `apps/web/src/main.tsx` |
| Shared types | `ProviderName`, `UISurfaceKind`, etc. | `packages/core/src/index.ts` |
| Wire protocol types | `RelayFrame` discriminated union for relay phase | `packages/protocol/src/index.ts` |
| Defaults | `DEFAULT_GATEWAY_HOST`, `DEFAULT_GATEWAY_PORT` | `packages/config/src/index.ts` |
| UI shared package | Placeholder for shared UI primitives | `packages/ui/src/index.ts` |
| Native clients | Reserved area, not in workspace build | `native/README.md` |

## Pattern Overview

**Overall:** Single-process local Gateway acting as session owner; multiple UI surfaces attach via HTTP + WebSocket. Persistence is an append-only event log in SQLite; live frames fan out from the in-memory `PtySessionManager` over `EventListener` subscriptions.

**Key Characteristics:**
- Monorepo with pnpm workspaces (`apps/*`, `packages/*`); `native/` is reserved and excluded from build/typecheck.
- TypeScript run directly via `tsx` (no `dist/` shipped). Web client is the only build artifact (`apps/web/dist`), served by the Gateway.
- CLI imports the Gateway in-process (`@tether/gateway`); each CLI invocation that creates or attaches a session boots a Gateway on the requested port.
- Gateway is single-process and single-host. Multiple gateways may coexist on different ports; they self-register in `~/.tether/gateways.json` with a 10 s heartbeat.
- Two transports for agent sessions: `pty-event-stream` (default) and `tmux` (fallback). Both share the same `Session` row but only `pty-event-stream` participates in the live event stream.

## Layers

**CLI dispatcher (`apps/cli`):**
- Purpose: User-facing command parsing and lifecycle orchestration.
- Location: `apps/cli/src/main.ts`
- Contains: `commander` program, subcommand actions, WS attach loop.
- Depends on: `@tether/gateway` (in-process), `@tether/core` types, `ws`, `commander`.
- Used by: Shell users via `bin/tether` shim and `pnpm tether`.

**Gateway runtime (`apps/gateway`):**
- Purpose: HTTP API, WebSocket stream multiplexer, PTY/tmux process supervisor, persistence.
- Location: `apps/gateway/src/`
- Contains: `daemon.ts` (HTTP+WS), `pty.ts`, `tmux.ts`, `store.ts`, `registry.ts`, `mask.ts`, `ids.ts`, `index.ts` (barrel).
- Depends on: `hono`, `@hono/node-server`, `ws`, `node-pty`, `better-sqlite3`, `@tether/core`.
- Used by: `apps/cli` (in-process import) and external HTTP/WS clients.

**Web client (`apps/web`):**
- Purpose: Browser session list and per-session terminal UI.
- Location: `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `apps/web/index.html`
- Contains: React `App` → `SessionList` / `SessionView` / `PtySessionView` (xterm.js).
- Depends on: `react`, `react-dom`, `@xterm/xterm`, `@xterm/addon-fit`, `vite`.
- Used by: Browsers (LAN today). Built into `apps/web/dist/` and served by the Gateway from `daemon.ts`.

**Shared packages (`packages/*`):**
- `@tether/core` — types only (`ProviderName`, `UISurfaceKind`, `WorkTargetRole`, `Gateway`).
- `@tether/protocol` — `RelayFrame` union for the future relay path.
- `@tether/config` — default host/port constants.
- `@tether/ui` — placeholder for shared UI primitives.

## Data Flow

### Primary request path (PTY event stream, default)

1. User runs `tether codex` (or `claude` / `opencode`). CLI parses options (`apps/cli/src/main.ts:48`).
2. CLI calls `startPtyProviderSession` → constructs `Store` and `PtySessionManager`, allocates a session id, then `ptySessions.create(...)` spawns `node-pty` and inserts the session row (`apps/gateway/src/pty.ts:38`).
3. CLI starts the Gateway in-process: `startDaemon({ host, port, store, ptySessions })` (`apps/gateway/src/daemon.ts:43`). Hono routes are mounted; `WebSocketServer` is attached to the Node HTTP server.
4. If `--attach`, CLI requests a one-shot ws ticket (`POST /api/ws-ticket`), opens a WS to `/api/sessions/<id>/stream?ticket=...&surface=cli&mode=control`, and bridges raw stdin/stdout (`apps/cli/src/main.ts:323`).
5. PTY output is buffered for ≤16 ms or 16 KiB, masked, persisted as `terminal.output` events, and published to all `EventListener` subscribers (`apps/gateway/src/pty.ts:172`).
6. Gateway forwards each event as `{ type: 'event', event }` frames to the CLI/Web socket; on disconnect, it appends `client.detached` and may reassign the controller (`apps/gateway/src/daemon.ts:342`).
7. On `term.onExit`, `PtySessionManager` flushes output, marks the session `completed`/`failed`, appends `session.exited`, and removes the live handle (`apps/gateway/src/pty.ts:81`).

### tmux fallback path (`--transport tmux`)

1. CLI verifies tmux is installed via `assertTmuxAvailable` (`apps/gateway/src/tmux.ts:100`).
2. `createAgentSession` runs `tmux new-session -d -s tether_<id> -c <projectPath> <command>` with list-form args, never `shell:true` (`apps/gateway/src/tmux.ts:67`).
3. CLI inserts a `transport: 'tmux'` session row, starts the Gateway, and (when `--attach`) execs `tmux attach -t tether_<id>` taking over the terminal.
4. Web/HTTP clients call `GET /api/sessions/:id/snapshot`, which runs `tmux capture-pane`, masks output, and returns a polled text snapshot (`apps/gateway/src/daemon.ts:84`).
5. Writes go through `POST /api/sessions/:id/send` → `sendKeys` (`set-buffer` + `paste-buffer` + `send-keys C-m`) (`apps/gateway/src/tmux.ts:89`).

### Web client flow

1. Browser loads `/`, `/remote`, or `/remote/session/:id`. Gateway serves `apps/web/dist/index.html` and proxies `/assets/*` from disk (`apps/gateway/src/daemon.ts:201`).
2. `App` reads the URL and renders `SessionList` (polls `/api/sessions`, `/api/sessions?all=1`, `/api/gateways`) or `SessionView`.
3. For PTY-backed sessions, `PtySessionView` first replays past events via `GET /api/sessions/:id/events?after=0`, then either opens a WS (default) or polls `?after=<cursor>` every 500 ms (HTTP fallback selected via `localStorage`).
4. Input is sent over WS as `{type:'input',data}` frames or via `POST /api/sessions/:id/input`. Resizes are throttled and only honored from the controlling client.

**State management:**
- Authoritative state lives in SQLite (`~/.tether/tether.db`): `sessions` and `session_events` tables.
- Live PTY handles are kept in-memory in `PtySessionManager.sessions`. On Gateway start, `Store.markRunningPtySessionsLost` reconciles any rows still marked `running` without a live handle (`apps/gateway/src/daemon.ts:231`).
- `clients` and `controllers` maps inside `daemon.ts` track per-session WS attachments. Controller reassignment happens on socket close.
- Web client persists per-session replay cursor and chosen transport/mode in `localStorage` (`tether:<sid>:latestEventId`, `tether:webTransportMode`, `tether:webClientMode`).

## Key Abstractions

**`Session` (`apps/gateway/src/store.ts:11`):**
- Purpose: Canonical record of an agent session, regardless of transport.
- Fields: `id`, `provider`, `title`, `projectPath`, `status`, `attachState`, `tmuxSessionName`, `command`, `pid`, `transport`, timestamps.
- Pattern: Persisted row + in-memory live handle (PTY sessions only).

**`SessionEvent` (`apps/gateway/src/store.ts:41`):**
- Purpose: Append-only log entry consumed by all UI surfaces.
- Types: `session.started`, `session.exited`, `session.error`, `terminal.output`, `user.input`, `client.attached`, `client.detached`, `terminal.resize`, `client.control_changed`, `approval.requested`, `diff.detected`, `agent.handoff`.
- Pattern: Cursor-addressable (`id INTEGER AUTOINCREMENT`); clients pass `?after=<id>` for incremental fetch.

**`PtySessionManager` (`apps/gateway/src/pty.ts:32`):**
- Purpose: Owns live `IPty` handles, output buffering, event publishing.
- Pattern: In-process pub/sub via `subscribe(sessionId, listener)`; flush is timer- or size-driven.

**`ClientInfo` (`apps/gateway/src/daemon.ts:418`):**
- Purpose: Per-WS attachment metadata (`clientId`, `surface`, `mode`, `deviceName`, timestamps).
- Pattern: Held only in memory; replayed via `client.attached`/`client.detached` events for surfaces that joined later.

**Provider table (`apps/cli/src/main.ts:34`):**
- Purpose: Static map from `ProviderName` (`codex` | `claude` | `opencode`) to executable.
- Pattern: Each provider gets a top-level CLI subcommand (`tether codex` etc.) plus the generic `tether run <provider>`.

**`RelayFrame` (`packages/protocol/src/index.ts`):**
- Purpose: Reserved discriminated union for the future Gateway↔Relay link. Not used by the current Gateway runtime.

## Entry Points

**`bin/tether`:**
- Location: `bin/tether`
- Triggers: User shell invocation (registered as `tether` bin in root `package.json`).
- Responsibilities: Shebangs `node --import tsx` and re-imports `apps/cli/src/main.ts`. Note: the relative path inside (`../apps/cli/src/main.ts`) resolves correctly only when run from the repository root via `pnpm tether`.

**`pnpm tether` / `pnpm dev`:**
- Location: `package.json` scripts.
- Triggers: Developer shell.
- Responsibilities: Runs `tsx apps/cli/src/main.ts` with optional preset args (`dev` runs `codex --host 0.0.0.0`).

**`apps/cli/src/main.ts`:**
- Location: `apps/cli/src/main.ts`
- Triggers: Both bin and pnpm script entry points.
- Responsibilities: Defines all subcommands (`codex`, `claude`, `opencode`, `gateway`, `run`, `attach`, `ls`, `clients`, `url`, `send`, `stop`) and dispatches via commander.

**`tether gateway`:**
- Location: `apps/cli/src/main.ts:65`
- Triggers: `pnpm tether gateway`.
- Responsibilities: Starts a persistent Gateway with no initial session; reconciles lost PTY sessions on startup; serves Web/API; idles on `SIGINT`/`SIGTERM`.

**Web SPA entry:**
- Location: `apps/web/index.html` → `apps/web/src/main.tsx`
- Triggers: Browser load. In dev: Vite at `127.0.0.1:4790` proxying `/api` to `127.0.0.1:4789`. In prod: Gateway serves prebuilt `apps/web/dist/index.html`.
- Responsibilities: Routes between session list and session view based on URL path.

**Tests:**
- Locations: `apps/gateway/src/daemon.test.ts`, `apps/gateway/src/pty.test.ts`, `apps/gateway/src/store.test.ts`.
- Triggers: `pnpm test` → `tsx --test src/*.test.ts` per package.

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop per Gateway process. PTY I/O is fully async via `node-pty`. No worker threads. SQLite uses `better-sqlite3` (synchronous; safe because called from the same loop).
- **Process model:** Each `tether <provider>` invocation spawns its own Gateway HTTP server. Multiple gateways must use distinct ports; they coordinate only via the file registry at `~/.tether/gateways.json`. There is currently no central supervisor — the long-term goal is a single resident Gateway that owns every session, but it is not yet implemented (see `AI_CONTEXT.md` "current implementation limits").
- **Global state:** In-memory maps inside `daemon.ts` (`tickets`, `clients`, `controllers`) are not shared between Gateway processes. SQLite is the only cross-process source of truth.
- **Network binding:** Gateway defaults to `127.0.0.1`. `--host 0.0.0.0` is allowed only for trusted LAN; there is no full device-token / pairing flow yet — only one-shot WS tickets (`POST /api/ws-ticket`, 60 s TTL, single-use).
- **Subprocess invocation:** All external commands (tmux, agents) MUST be invoked via `child_process.spawn(cmd, args[])`/`pty.spawn(cmd, args[])`. **Never** pass `shell: true` and never concatenate user input into a shell string.
- **Sensitive output:** All text persisted as `terminal.output` or `user.input`, and all tmux `capture-pane` output served to clients, must pass through `maskSensitiveOutput` first (`apps/gateway/src/mask.ts`).
- **Native clients:** `native/flutter/`, `native/harmony/` are reserved placeholders only. They must consume the protocol via `packages/protocol`; they MUST NOT replicate session ownership, auth, or process control logic.
- **Storage location:** Hard-coded to `~/.tether/`. Only the Store and gateway registry write here.

## Anti-Patterns

### Spawning external commands with `shell: true`

**What happens:** Building `tmux new-session -d -s tether_<id> ... <command>` as a single string and passing it to `spawn` with `shell: true`, or to `exec`.
**Why it's wrong:** Any path or user-derived value can become shell injection. Tether directly controls the local terminal, so this is a security-critical bug, not a style issue.
**Do this instead:** Always use list-form args, exactly like `apps/gateway/src/tmux.ts:27` (`spawn('tmux', args, { stdio: ... })`) and `apps/gateway/src/pty.ts:40` (`pty.spawn(command, [], { ... })`). See PROJECT.md "安全门槛".

### Letting clients open arbitrary processes

**What happens:** Adding an HTTP/WS endpoint that accepts a shell command and runs it.
**Why it's wrong:** Tether's contract is "send keys to an existing agent process". Allowing arbitrary spawn turns the Gateway into a remote execution server, breaking the safety model.
**Do this instead:** Mirror the existing `/api/sessions/:id/input` and `/api/sessions/:id/stop` shape (`apps/gateway/src/daemon.ts:161`). Inputs only target an existing PTY/tmux session that the Gateway already owns.

### Forwarding terminal output without masking

**What happens:** Writing PTY output directly to a `session_events` row or to a WS frame without running it through `maskSensitiveOutput`.
**Why it's wrong:** Both `~/.tether/tether.db` (transcripts) and external surfaces (web/CLI) would leak API keys / tokens. The codebase consistently masks at write time.
**Do this instead:** Funnel writes through `PtySessionManager.flushOutput` and `PtySessionManager.write` (already mask), or, for tmux snapshots, through `daemon.ts`'s call to `maskSensitiveOutput(raw)` (`apps/gateway/src/daemon.ts:101`).

### Mutating session state outside the Store

**What happens:** Updating session status by writing fields directly on a `Session` object retrieved from the Store, then expecting other clients to see it.
**Why it's wrong:** `Session` rows returned from `Store.listSessions` / `getSession` are plain copies (`fromRow`). Mutations are not persisted unless they go through `Store.updateSessionStatus` / `updateAttachState` / `touchSession` / `appendEvent`.
**Do this instead:** Always call the Store mutators (`apps/gateway/src/store.ts:138`) and rely on `session_events` for cross-surface state changes.

### Creating a parallel state stream alongside `session_events`

**What happens:** Adding a new in-memory broadcast that bypasses `session_events`.
**Why it's wrong:** Late joiners (web reload, CLI re-attach) replay from `session_events` before subscribing. State only on the live channel will be invisible to them.
**Do this instead:** Append a typed entry to `SessionEventType` and persist via `Store.appendEvent` before publishing to `PtySessionManager` listeners (`apps/gateway/src/pty.ts:162`).

## Error Handling

**Strategy:** Convert lower-layer errors into typed responses at the API boundary; never let raw errors crash the Gateway.

**Patterns:**
- `TmuxError` (`apps/gateway/src/tmux.ts:3`) wraps stderr; `formatTmuxError` is the single CLI-side formatter.
- HTTP routes return `{ error: '<reason>' }` with explicit status codes (`404` unknown session, `409` wrong transport, `410` session no longer running, `400` malformed body, `501` not implemented for tmux stop).
- WebSocket errors are sent as `{ type: 'error', code, message }` frames (`bad_frame`, `observe_only`, `session_lost`); the socket is closed with code `1008` for unsupported paths or invalid tickets.
- PTY exits resolve into `session.exited` events with `exitCode`/`signal`; abnormal ones flip status to `failed`.
- On Gateway startup, `Store.markRunningPtySessionsLost` flips orphaned `running` PTY sessions to `lost` and writes a `session.error` event.

## Cross-Cutting Concerns

**Logging:** None of the runtime uses a logger framework; user-facing CLI text goes to `console.log` / `console.error`. Gateway routes intentionally avoid noisy server logs.
**Validation:** Manual at the route boundary in `daemon.ts` (`typeof body.text === 'string'`, length checks, integer parsing via `parseIntegerQuery`). No external schema validator (no zod/yup yet).
**Authentication:** One-shot 60 s WebSocket ticket via `POST /api/ws-ticket`, single-use. HTTP routes are unauthenticated (LAN-only assumption today). Device-token / pairing is planned for Phase 2.5.
**Sensitive-data masking:** Centralized in `apps/gateway/src/mask.ts`; used by both PTY input/output and tmux snapshots.
**Persistence migration:** `Store.migrate` (`apps/gateway/src/store.ts:223`) adds new columns (`attach_state`, `pid`, `transport`) on first open. No down-migrations; do not rename columns destructively.
**Static assets:** Gateway streams `apps/web/dist/index.html` and `apps/web/dist/assets/*` directly from disk; if `dist/` is missing it returns `503 Web app is not built. Run: pnpm web:build`.

---

*Architecture analysis: 2026-05-01*
