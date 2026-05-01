# External Integrations

**Analysis Date:** 2026-05-01

## APIs & External Services

Tether is a self-hosted local agent console. It does **not** call any third-party SaaS API from its own code. The "external" integrations it has are local OS-level subsystems and the agent CLIs it supervises.

**Agent CLIs (spawned as child processes):**
- `codex` — Provider `codex`, default command `codex` (`apps/cli/src/main.ts` line 35)
- `claude` — Provider `claude`, default command `claude` (`apps/cli/src/main.ts` line 36)
- `opencode` — Provider `opencode`, default command `opencode` (`apps/cli/src/main.ts` line 37)
- These commands must be on `PATH` of whoever runs `tether`. Tether passes the full `process.env` to them (`apps/gateway/src/pty.ts` line 45), so credentials those CLIs need (e.g. `OPENAI_API_KEY` for `codex`) are inherited from the user's shell. Tether itself does not read or store them.
- Spawn surface: `node-pty`'s `pty.spawn(command, [], { ... })` for the default transport, or `tmux new-session ... command` for the legacy `--transport tmux` fallback. Both call list-form arguments — never `shell: true` (`apps/gateway/src/tmux.ts` line 27, `apps/gateway/src/pty.ts` line 40).

**tmux (legacy / migration fallback):**
- Used only when `--transport tmux` is passed
- All operations go through `spawn('tmux', args, { ... })` in `apps/gateway/src/tmux.ts`
- Operations: `new-session`, `attach`, `capture-pane`, `has-session`, `set-buffer` + `paste-buffer` + `send-keys`, `set-option`, `-V` (availability check)
- `assertTmuxAvailable()` is called before any tmux command; absence raises `TmuxError('tmux is required for Phase 1 demo but was not found in PATH')`

## Data Storage

**Databases:**
- SQLite (local file)
  - File: `~/.tether/tether.db` (resolved by `defaultDbPath()` in `apps/gateway/src/store.ts` line 240)
  - Client: `better-sqlite3` ^11.10.0 (synchronous, in-process)
  - Pragma: `journal_mode = WAL`
  - Tables:
    - `sessions` — one row per session; columns include `id`, `provider`, `status`, `attach_state`, `tmux_session_name`, `command`, `pid`, `transport`, timestamps. Migrations in `Store.migrate()` add `attach_state`, `pid`, `transport` to older databases.
    - `session_events` — append-only log of `terminal.output`, `user.input`, `client.attached`, `client.detached`, `terminal.resize`, `client.control_changed`, `session.started`, `session.exited`, `session.error`, plus reserved future types `approval.requested`, `diff.detected`, `agent.handoff`. Indexed by `(session_id, id)`.
  - No external/cloud database. No migrations framework — `CREATE TABLE IF NOT EXISTS` and ad-hoc `ALTER TABLE` in `Store.migrate()`.

**File Storage:**
- Local filesystem only.
- `~/.tether/gateways.json` — Live Gateway registry maintained by `apps/gateway/src/registry.ts`. Each Gateway writes its `{ id, host, port, url, pid, startedAt, lastSeenAt }` and refreshes every 10s; entries are pruned if `lastSeenAt > 30s` ago or if `process.kill(pid, 0)` fails.
- Static web bundle: `apps/web/dist` (built by `pnpm web:build`); served by Gateway at `/`, `/remote`, `/remote/session/:id`, and `/assets/*` (`apps/gateway/src/daemon.ts` lines 201–223).

**Caching:**
- None. PTY output is buffered in-memory for ~16ms or 16 KiB before flushing into `session_events` (`apps/gateway/src/pty.ts` `bufferOutput` / `flushOutput`).

## Authentication & Identity

**Current state — local-only, low-trust:**
- The Gateway has **no full authentication layer yet**. It is only safe to expose on `127.0.0.1` (default) or a trusted LAN with explicit `--host` opt-in.
- WebSocket write surface (`/api/sessions/:id/stream`) is gated by a one-time **WS ticket**:
  - Client `POST /api/ws-ticket` → `{ ticket, expiresInMs: 60_000 }`
  - Ticket is a `randomUUID()` stored in the in-process `tickets: Map<string, number>` (`apps/gateway/src/daemon.ts` line 47)
  - WS upgrade reads `?ticket=` from the URL, then `consumeTicket()` deletes it and validates expiry. Single-use.
- HTTP write endpoints (`POST /api/sessions/:id/send`, `POST /api/sessions/:id/input`, `POST /api/sessions/:id/stop`) currently have **no ticket** or auth check — same-origin / loopback assumption only.
- `clientId` for an attached WS client is server-assigned (`cli_${randomUUID()}`) and returned in the `hello` frame; query-string `?surface=`, `?mode=control|observe`, `?device=` are recorded but trusted.

**Planned (per `AI_CONTEXT.md` and `PROJECT.md`):**
- Phase 2.5: device tokens via `tether pair` / `tether devices` / `tether revoke`
- Cloud account is deferred and will only own control plane (login, devices, push, remote revoke) — not session contents
- These are **not implemented** in source today

**Auth Provider:**
- None (no Auth0 / Clerk / Supabase auth / OAuth / JWT). Custom local scheme only.

## Monitoring & Observability

**Error Tracking:** None. No Sentry, no Bugsnag, no telemetry.

**Logs:**
- Plain `console.log` / `console.error` / `console.warn` in `apps/cli/src/main.ts` and `apps/gateway/src/daemon.ts`
- No structured logger (no pino / winston / bunyan)
- The append-only `session_events` table is the de facto audit log for terminal activity

**Metrics:** None.

## CI/CD & Deployment

**Hosting:**
- None — local-only software. The Gateway runs on the developer's workstation.
- Web bundle is served from disk by the Gateway, not from a CDN.

**CI Pipeline:**
- No `.github/`, `.gitlab-ci.yml`, `circleci`, or other CI config detected at repo root.

**Release Artifacts:**
- None. Distribution path today is "clone repo → `pnpm install` → `pnpm tether ...`" or `bin/tether`.

## Environment Configuration

**Required env vars (Tether's own code):**
- None. Tether reads no environment variables for its own configuration.
- The only `process.env` reference in source is `apps/gateway/src/pty.ts` line 45, which forwards the parent process's full env to the spawned agent CLI.

**Required env vars (downstream agents):**
- The agent CLIs (`codex`, `claude`, `opencode`) read their own credentials from the inherited environment. Tether neither validates nor stores them.

**Configuration surface:**
- CLI flags only: `--host`, `--port` (default `4789` from `@tether/config`), `--project`, `--transport pty|tmux`, `--no-attach`, `--control`, `--observe`
- Default port: `DEFAULT_GATEWAY_PORT = 4789` in `packages/config/src/index.ts`
- Default host: `DEFAULT_GATEWAY_HOST = '127.0.0.1'`

**Secrets location:**
- No secret store. Tether persists no API keys.
- Sensitive output flowing through PTY is masked before being written to `session_events` and before being broadcast to clients (see "Output sanitization" below).

## Webhooks & Callbacks

**Incoming:** None.

**Outgoing:** None. The Gateway does not call out to any third-party URL.

## IPC and Inter-Process Mechanisms

**HTTP API (Hono on top of `@hono/node-server`)** — `apps/gateway/src/daemon.ts`:
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ws-ticket` | Issue one-time 60s WS ticket |
| GET | `/api/sessions` (`?all=1` to include stopped) | List sessions, reconciling tmux liveness |
| GET | `/api/gateways` | List live Gateways from `~/.tether/gateways.json` |
| GET | `/api/sessions/:id/snapshot` | ANSI-stripped transcript snapshot (HTTP fallback for the Web client) |
| POST | `/api/sessions/:id/send` | Send line text (≤4000 chars) — works for both transports |
| GET | `/api/sessions/:id/events?after=&limit=` | Cursor-paginated event log; used for replay + HTTP-mode tail polling |
| GET | `/api/sessions/:id/clients` | List attached clients and current controller |
| POST | `/api/sessions/:id/input` | Raw input bytes (PTY only) |
| POST | `/api/sessions/:id/stop` | Stop a PTY session (tmux stop is currently `501 Not Implemented`) |
| GET | `/`, `/remote`, `/remote/session/:id`, `/assets/*` | Static web bundle from `apps/web/dist` |

**WebSocket (ws library)** — single endpoint `/api/sessions/:id/stream`:
- Server: `apps/gateway/src/daemon.ts` lines 239–363, attached to the underlying `http.Server` returned by `@hono/node-server`'s `serve()`
- Client: `apps/cli/src/main.ts` `attachPtySession()` and the React `PtySessionView` in `apps/web/src/main.tsx`
- Auth: `?ticket=<uuid>`; `?surface=cli|web|...`; `?mode=control|observe`; `?after=<eventId>`; `?device=<name>`
- Server frames: `{type:"hello", sessionId, clientId, latestEventId, controllerClientId}`, `{type:"event", event}`, `{type:"replay.done", latestEventId}`, `{type:"error", code, message}`
- Client frames: `{type:"input", data}`, `{type:"resize", cols, rows}`
- Replay model: on connect the server replays events from `?after=` (up to 5000) before signalling `replay.done`, then forwards new events as they're produced by `PtySessionManager.subscribe`

**Vite dev proxy** — `apps/web/vite.config.ts`:
- `/api` (HTTP and WS) reverse-proxied to `http://127.0.0.1:4789` so the React dev server at `127.0.0.1:4790` can talk to a locally running Gateway

**Multi-Gateway coordination via filesystem:**
- `apps/gateway/src/registry.ts` writes `~/.tether/gateways.json` with `{ id, host, port, url, pid, startedAt, lastSeenAt }`
- Heartbeat: each Gateway calls `touchGateway` every 10s (interval is `unref()`'d)
- Liveness check: stale after 30s OR `process.kill(pid, 0)` fails
- This is how the Web `SessionList` shows multiple running Gateways without any of them having to talk to each other

**Subprocess IPC — agent CLIs:**
- PTY (default): `node-pty.spawn(command, [], { name: 'xterm-256color', cols, rows, cwd, env: process.env })` in `apps/gateway/src/pty.ts`
  - PTY data flows in via `term.onData` → masked → appended to `session_events` (type `terminal.output`) → broadcast to subscribers
  - Input flows: client WS frame → `PtySessionManager.write` → masked copy stored as `user.input` event → `term.write(rawData)` (raw bytes go to the PTY; only the audit copy is masked)
  - Lifecycle: `term.onExit` updates session status to `completed`/`failed` and emits `session.exited`
- tmux (fallback): `spawn('tmux', args, { stdio: 'pipe' | 'inherit' })` — never `shell: true`. `sendKeys` uses `set-buffer` + `paste-buffer` + `send-keys C-m` to safely paste arbitrary text without shell interpolation.

## Output Sanitization

Implemented in `apps/gateway/src/mask.ts` and applied at every external boundary that writes content into `session_events` or returns transcripts to clients:

```ts
const PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g
];
```

Replacement string: `[REDACTED]`. Applied in:
- `PtySessionManager.flushOutput` (terminal output before storage and broadcast)
- `PtySessionManager.write` (user input — only the stored audit copy is masked; live PTY still receives the raw bytes)
- `daemon.ts` tmux `capture-pane` snapshot endpoint

## Future / Reserved External Integrations

These are referenced in design docs and the protocol package but are **not implemented in code** today:

- **Tether Relay** — outbound WSS connection from Gateway to a self-hosted relay; frame schema sketched in `packages/protocol/src/index.ts` as the `RelayFrame` union (`hello`, `subscribe`, `input`, `snapshot`, `event`, `error`). No relay client, no relay server in the repo.
- **Tunnel providers** (Cloudflare Tunnel, Tailscale) — referenced in `AI_CONTEXT.md` as deployment options, no in-repo integration.
- **Push notifications / federation** — Phase 3 only, no code.
- **Native client SDKs** (Dart for Flutter, ArkTS for HarmonyOS) — `native/` exists as placeholders only; not part of the pnpm workspace build.

---

*Integration audit: 2026-05-01*
