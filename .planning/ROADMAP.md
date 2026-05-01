# Roadmap: Tether v0.3 — Personal Relay Access

## Overview

Finishing milestone: Phase 2 PTY-backed event stream is shipped. This roadmap now
prioritizes personal remote use: ship a minimal self-hosted Relay first so the user can
reach the Mac Gateway without LAN/VPN assumptions, then harden local terminal parity,
remove tmux fallback, add full device-token auth, bound storage, install the Gateway as
the single persistent session owner, and close with security/integration tests.

Build order is optimized for a solo user rather than a public multi-user service. The
Relay MVP may use a single owner link secret and outbound Gateway connection, but it
must still preserve the safety boundary: Relay only forwards authenticated frames, never
executes commands, never accepts arbitrary process creation, and does not persist terminal
plaintext. Full pairing/device-token auth remains a later phase before broader exposure.

## Phases

- [ ] **Phase 1: Personal Relay MVP** - Gateway connects outbound to a self-hosted Relay; one remote Web client can attach to an existing session
- [ ] **Phase 2: Experience Hardening** - Detach hotkey, key passthrough, paste, ANSI, and TUI resize all verified on macOS
- [ ] **Phase 3: Cleanup** - tmux fallback removed; single-transport codebase ready for auth work
- [ ] **Phase 4: Authentication** - Pairing flow live; all write endpoints reject unauthenticated requests
- [ ] **Phase 5: Retention** - Event store bounded; WAL checkpoint scheduled; Gateway stable under multi-hour uptime
- [ ] **Phase 6: Supervisor & launchd** - Single persistent Gateway owns all PTY sessions; auto-starts on login
- [ ] **Phase 7: Security Tests & Final Cleanup** - Milestone exit gate; relay, auth, whitelist, mask, retention all covered by integration tests

## Phase Details

### Phase 1: Personal Relay MVP
**Goal**: A solo user can run a self-hosted Relay, connect the local Gateway to it over outbound WSS, open the remote Web client, and control an existing PTY session through the relay without exposing the Gateway directly
**Depends on**: Nothing (PTY event stream already shipped)
**Requirements**: RELAY-01
**Success Criteria** (what must be TRUE):
  1. `apps/relay` exists as a minimal Node/TypeScript service that accepts Gateway and Web client WSS connections using an owner-configured relay link secret
  2. Gateway can start with a relay URL/secret, establish an outbound WSS connection, register its available sessions, and reconnect after transient Relay disconnects
  3. A remote Web client can list and attach to an existing Gateway session through Relay; terminal output, input, resize, and control/observe mode frames round-trip through the relay
  4. Relay only forwards protocol frames between authenticated Gateway/client peers; it never spawns commands, never receives provider command/args/env, and does not persist terminal plaintext
  5. The MVP is explicitly single-owner/single-Gateway oriented; multi-user accounts, billing, federation, push notifications, and end-to-end encrypted relay envelopes are out of scope
**Plans**: TBD

### Phase 2: Experience Hardening
**Goal**: Local terminal experience is at parity with tmux — detach works, key sequences pass through correctly, paste arrives intact, ANSI renders faithfully, and TUI resize is clean
**Depends on**: Phase 1
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05
**Success Criteria** (what must be TRUE):
  1. User can press `Ctrl-]` inside `tether attach` to detach without killing the agent; terminal raw mode is fully restored afterward (stty echo set, shell prompt usable)
  2. `Enter`, `Backspace`, `Ctrl-C`, and `Ctrl-D` inside `tether attach` produce the same effect as the same keys in a direct tmux session running the same agent on macOS
  3. Pasting more than 2 KB of text via bracketed paste into `tether attach` delivers the content to the agent intact — no truncation, no corruption from the macOS PTY 1024-byte buffer limit
  4. Codex and Claude TUI full-screen modes (alternate screen, color, cursor movement, clear screen) render without artifacts on both CLI attach and the Web xterm.js client
  5. Resizing the terminal while Codex or Claude is mounted does not leave persistent layout corruption; the agent re-renders cleanly within one frame after resize completes
**Plans**: TBD

### Phase 3: Cleanup
**Goal**: The codebase has a single active transport; tmux code is deleted; the `transport` field is documented as a retained extension point
**Depends on**: Phase 2
**Requirements**: CLEAN-01, CLEAN-02
**Success Criteria** (what must be TRUE):
  1. `tether --transport tmux` (or any equivalent flag) is no longer accepted; the CLI rejects it with a clear error
  2. `apps/gateway/src/tmux.ts` is deleted; `daemon.ts`, `store.ts`, and `apps/cli/src/main.ts` have no tmux-conditional branches
  3. The `transport` column and TypeScript type are retained with a code comment documenting the intent (historical rows readable; future extension point); only `'pty-event-stream'` is valid for new sessions
**Plans**: TBD

### Phase 4: Authentication
**Goal**: Users can pair a phone or remote client with the Gateway via a one-time code, and all write operations require a valid device token
**Depends on**: Phase 3
**Requirements**: AUTH-02, AUTH-01
**Success Criteria** (what must be TRUE):
  1. A user can run the pairing flow from the Web client: obtain a 6-digit code, enter it, and receive a device token stored in the browser; the token hash (SHA-256) is persisted in the `device_tokens` SQLite table and the raw token never touches disk
  2. All write endpoints (`POST /api/sessions/:id/input`, `POST /api/sessions/:id/resize`, `POST /api/sessions/:id/stop`, `POST /api/sessions/:id/claim-control`, `POST /api/sessions`, `POST /api/ws-ticket`) return HTTP 401 when called without a valid `Authorization: Bearer <device-token>` header
  3. A paired device token remains valid across Gateway restarts; an unpaired client cannot write to any session
  4. Two simultaneous pairing-confirm requests for the same code produce exactly one success (no TOCTOU race); after 5 failed attempts the code is invalidated
  5. Relay-routed writes use the same device-token checks as direct HTTP/WS writes once this phase lands
**Plans**: TBD

### Phase 5: Retention
**Goal**: The `session_events` table is bounded; the SQLite WAL file cannot grow unbounded during long Gateway uptimes
**Depends on**: Phase 4
**Requirements**: RETAIN-01
**Success Criteria** (what must be TRUE):
  1. Events older than 7 days are deleted automatically; after the retention job runs, no `session_events` row has a `ts` value older than 7 days
  2. When a single session's `session_events` rows exceed 100 MB (measured by `SUM(length(payload_json))`), the oldest rows for that session are deleted until the session is under limit
  3. The retention job runs every 15 minutes inside the Gateway process without blocking WS output to connected clients; `PRAGMA wal_checkpoint(RESTART)` runs on a separate 5-minute cadence
  4. The Gateway process exits cleanly (no dangling interval) when `close()` is called
**Plans**: TBD

### Phase 6: Supervisor & launchd
**Goal**: A single persistent `tether gateway` process owns all PTY sessions; it auto-starts on macOS login, restarts on crash, and can be installed or uninstalled with a single command
**Depends on**: Phase 5
**Requirements**: GW-01, GW-02
**Success Criteria** (what must be TRUE):
  1. `tether codex` (or any provider command) in a new terminal finds a running Gateway, forwards session creation to it via `POST /api/sessions`, and attaches — the PTY handle lives in the persistent Gateway process, not the CLI process
  2. `tether codex` when no Gateway is running falls back to in-process bootstrap with a visible warning; the user experience degrades gracefully rather than failing
  3. `tether gateway install` registers `~/Library/LaunchAgents/sh.tether.gateway.plist`, uses an absolute node path snapshotted at install time, and the Gateway auto-starts on next login; `tether gateway uninstall` removes the plist and unloads it cleanly
  4. After an unexpected Gateway crash, launchd restarts it; CLI commands issued after restart can create new sessions and attach to them
  5. Gateway relay connection can be managed by the persistent Gateway process rather than by short-lived CLI processes
**Plans**: TBD

### Phase 7: Security Tests & Final Cleanup
**Goal**: The v0.3 milestone exit criteria are satisfied — integration tests verify relay safety, auth properties, and the Phase 2 structured event schema is closed
**Depends on**: Phase 6
**Requirements**: TEST-01, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. Integration tests assert that Relay rejects unauthenticated Gateway/client connections and never accepts arbitrary provider command/args/env frames
  2. Integration tests assert that all write endpoints return 401 for unauthenticated requests and 200 for requests with a valid device token
  3. Integration tests assert that `POST /api/sessions` with a non-whitelisted provider name is rejected
  4. Integration tests assert that API keys matching known patterns are redacted in `terminal.output` and `user.input` events stored in the DB
  5. Integration tests assert that the legacy snapshot (`GET /api/sessions/:id/snapshot`) and send (`POST /api/sessions/:id/send`) endpoints still respond correctly through the event store
  6. Integration tests assert that the retention job deletes the correct rows under both the 7-day time trigger and the 100 MB per-session size trigger
  7. `approval.requested`, `diff.detected`, and `agent.handoff` event types have an exhaustive-switch parser test that fails compilation when a new event type is added without a handler; roadmap and phase docs note that Phase 4 owns the full diff/approval UI
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Personal Relay MVP | 0/TBD | Not started | - |
| 2. Experience Hardening | 0/TBD | Not started | - |
| 3. Cleanup | 0/TBD | Not started | - |
| 4. Authentication | 0/TBD | Not started | - |
| 5. Retention | 0/TBD | Not started | - |
| 6. Supervisor & launchd | 0/TBD | Not started | - |
| 7. Security Tests & Final Cleanup | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-01*
*Milestone reordered: 2026-05-01 — personal Relay MVP moved to Phase 1*
*Coverage: 15/15 v1 requirements mapped*
