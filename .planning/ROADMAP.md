# Roadmap: Tether v0.3 — Multi-account Relay Access

## Overview

Finishing milestone: Phase 2 PTY-backed event stream is shipped, and Phase 1 Personal
Relay MVP plus Phase 6 persistent Gateway are already complete. The roadmap now treats
the shared-secret Personal Relay path as a temporary bootstrap, not the target security
model. The target is authenticated multi-account remote access: external clients log in,
Gateways authenticate at startup, Relay authenticates both Gateway and client WebSockets,
and every session operation is scoped by account/workspace/Gateway/session ownership.

The safety boundary remains unchanged: Relay forwards authenticated protocol frames only.
It never executes commands, never accepts arbitrary process creation, never becomes the
source of truth for ownership, and never persists terminal plaintext. Multi-account auth is
now in-scope for v0.3; hosted SaaS billing, organization administration, full E2EE relay
envelopes, federation, and push notifications remain post-v0.3.

## Phases

- [x] **Phase 1: Personal Relay MVP** - Gateway connects outbound to a self-hosted Relay; one remote Web client can attach to an existing session
- [ ] **Phase 2: Experience Hardening** - Detach hotkey, key passthrough, paste, ANSI, and TUI resize all verified on macOS
- [ ] **Phase 3: Cleanup** - tmux fallback removed; single-transport codebase ready for auth work
- [ ] **Phase 4: Account & Auth Contract** - Short no-code contract gate for ownership, roles, token classes, and Auth/Gateway/Relay boundaries before implementation
- [ ] **Phase 5: Multi-user Auth, Relay Auth & Audit** - Implements the Phase 4 contract: login, Gateway startup auth, scoped WS tickets, role checks, Relay auth, and identity audit events
- [ ] **Phase 6: Retention** - Event store bounded; WAL checkpoint scheduled; Gateway stable under multi-hour uptime
- [x] **Phase 7: Supervisor & launchd** - Single persistent Gateway owns all PTY sessions; auto-starts on login
- [ ] **Phase 8: Security, Isolation Tests & Final Cleanup** - Milestone exit gate; account isolation, relay auth, whitelist, mask, retention all covered by integration tests

## Phase Details

### Phase 1: Personal Relay MVP
**Goal**: A solo user can run a self-hosted Relay, connect the local Gateway to it over outbound WSS, open the remote Web client, and control an existing PTY session through the relay without exposing the Gateway directly. This phase is complete and now considered a bootstrap path; later phases replace shared-secret auth with account tokens.
**Depends on**: Nothing (PTY event stream already shipped)
**Requirements**: RELAY-01
**Success Criteria** (what must be TRUE):
  1. `apps/relay` exists as a minimal Node/TypeScript service that accepts Gateway and Web client WSS connections using an owner-configured relay link secret
  2. Gateway can start with a relay URL/secret, establish an outbound WSS connection, register its available sessions, and reconnect after transient Relay disconnects
  3. A remote Web client can list and attach to an existing Gateway session through Relay; terminal output, input, resize, and control/observe mode frames round-trip through the relay
  4. Relay only forwards protocol frames between authenticated Gateway/client peers; it never spawns commands, never receives provider command/args/env, and does not persist terminal plaintext
  5. The MVP is explicitly single-owner/single-Gateway oriented as a temporary bootstrap; multi-account auth is implemented by later v0.3 phases
**Plans**:
  - `01-01-PLAN.md` — Relay Protocol Contract
  - `01-02-PLAN.md` — Relay Service Runtime *(depends on Plan 01)*
  - `01-03-PLAN.md` — Gateway Relay Bridge *(depends on Plans 01, 02)*
  - `01-04-PLAN.md` — Web Relay Mode and End-to-End Verification *(depends on Plans 01, 02, 03)*

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
**Plans**:
  - **Wave 1**:
    - `03-01-PLAN.md` — Store and Protocol Transport Contract
  - **Wave 2** *(blocked on Wave 1 completion)*:
    - `03-02-PLAN.md` — Gateway Runtime tmux Removal *(depends on Plan 01)*
  - **Wave 3** *(blocked on Wave 1 and Wave 2 completion)*:
    - `03-03-PLAN.md` — CLI Transport Simplification *(depends on Plans 01, 02)*
  - **Wave 4** *(blocked on Wave 1, Wave 2, and Wave 3 completion)*:
    - `03-04-PLAN.md` — Web Display, Docs, and End-to-End Cleanup Verification *(depends on Plans 01, 02, 03)*

### Phase 4: Account & Auth Contract
**Goal**: Produce a short executable contract for multi-account auth before implementation. This phase does not change runtime code, database schema, API handlers, Relay behavior, or Web UI.
**Depends on**: Phase 3
**Requirements**: ACCOUNT-01, ACCOUNT-02, ACCOUNT-03, ACCOUNT-04, ACCOUNT-05
**Success Criteria** (what must be TRUE):
  1. A single `ACCOUNT-AUTH-SPEC.md` (or equivalent Phase 4 plan artifact) defines the canonical graph: `account -> workspace -> gateway -> session`, plus `user` and `device`
  2. The contract maps role permissions for list/read/subscribe/input/resize/claim-control/release-control/stop/session-create/Gateway-admin
  3. The contract defines token classes: client access token, client refresh token, device identity, Gateway token, and short-lived WS ticket
  4. The contract fixes trust boundaries: remote auth/control-plane owns accounts, users, devices, Gateway registration, token issuance, refresh, logout, and revoke; Gateway stores only minimal cached identity/session metadata
  5. The contract documents Relay as a routing layer, not an ownership or execution authority
  6. Phase 5 plans reference this contract and may not start until the contract has no unresolved ownership, token, or role questions
**Plans**: TBD

### Phase 5: Multi-user Auth, Relay Auth & Audit
**Goal**: Implement the Phase 4 contract so logged-in users and authenticated Gateways can use direct and Relay paths with consistent authorization and auditable identity
**Depends on**: Phase 4
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, RELAY-AUTH-01, RELAY-AUTH-02, RELAY-AUTH-03, AUDIT-01, AUDIT-02
**Success Criteria** (what must be TRUE):
  1. External Web/native clients log in to the remote auth/control-plane and receive short-lived access tokens plus refresh tokens
  2. Gateway startup authenticates to the remote auth/control-plane, binds to an account/workspace, and receives or refreshes a Gateway token before publishing sessions through Relay
  3. HTTP write endpoints and WS ticket issuance reject missing, invalid, revoked, cross-account, or under-authorized tokens
  4. Browser WS uses a short-lived, single-use ticket scoped to account/workspace/Gateway/session/mode
  5. Relay authenticates both Gateway and client sockets and routes frames only inside authorized account/workspace/Gateway/session boundaries
  6. Multiple users can observe the same session; only authorized controllers can input/resize/claim-control, and arbitration is deterministic
  7. Identity-bearing audit events record account/workspace/user/device/Gateway/session/role without storing raw tokens
**Plans**: TBD

### Phase 6: Retention
**Goal**: The `session_events` table is bounded; the SQLite WAL file cannot grow unbounded during long Gateway uptimes
**Depends on**: Phase 5
**Requirements**: RETAIN-01
**Success Criteria** (what must be TRUE):
  1. Events older than 7 days are deleted automatically; after the retention job runs, no `session_events` row has a `ts` value older than 7 days
  2. When a single session's `session_events` rows exceed 100 MB (measured by `SUM(length(payload_json))`), the oldest rows for that session are deleted until the session is under limit
  3. The retention job runs every 15 minutes inside the Gateway process without blocking WS output to connected clients; `PRAGMA wal_checkpoint(RESTART)` runs on a separate 5-minute cadence
  4. The Gateway process exits cleanly (no dangling interval) when `close()` is called
**Plans**: TBD

### Phase 7: Supervisor & launchd
**Goal**: A single persistent `tether gateway` process owns all PTY sessions; it auto-starts on macOS login, restarts on crash, and can be installed or uninstalled with a single command
**Depends on**: Phase 1 (completed earlier and renumbered after multi-account roadmap update; Phase 4/5 auth and Phase 6 retention remain later hardening)
**Requirements**: GW-01, GW-02
**Success Criteria** (what must be TRUE):
  1. `tether codex` (or any provider command) in a new terminal finds a running Gateway, forwards session creation to it via `POST /api/sessions`, and attaches — the PTY handle lives in the persistent Gateway process, not the CLI process
  2. `tether codex` when no Gateway is running falls back to in-process bootstrap with a visible warning; the user experience degrades gracefully rather than failing
  3. `tether gateway install` registers `~/Library/LaunchAgents/sh.tether.gateway.plist`, uses an absolute node path snapshotted at install time, and the Gateway auto-starts on next login; `tether gateway uninstall` removes the plist and unloads it cleanly
  4. After an unexpected Gateway crash, launchd restarts it; CLI commands issued after restart can create new sessions and attach to them
  5. Gateway relay connection can be managed by the persistent Gateway process rather than by short-lived CLI processes
**Plans**:
  - **Wave 1**:
    - `06-01-PLAN.md` — Gateway Config and Provider Policy Foundation
  - **Wave 2** *(blocked on Wave 1 completion)*:
    - `06-02-PLAN.md` — Gateway Session Creation API and Runtime Status
  - **Wave 3** *(blocked on required earlier plans)*:
    - `06-03-PLAN.md` — CLI Forwarding and Inline Fallback *(depends on Plans 01, 02)*
    - `06-04-PLAN.md` — launchd Lifecycle and Chinese Gateway Status *(depends on Plan 01)*
  - **Wave 4** *(blocked on Wave 2 and Wave 3 completion)*:
    - `06-05-PLAN.md` — Supervisor Documentation and End-to-End Verification *(depends on Plans 02, 03, 04)*

### Phase 8: Security, Isolation Tests & Final Cleanup
**Goal**: The v0.3 milestone exit criteria are satisfied — integration tests verify account isolation, relay safety, auth properties, and the structured event schema is closed
**Depends on**: Phase 7
**Requirements**: TEST-01, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. Integration tests assert that Relay rejects unauthenticated Gateway/client connections and never accepts arbitrary provider command/args/env frames
  2. Integration tests assert that Gateway startup without a valid Gateway token cannot publish sessions
  3. Integration tests assert that account A cannot list, subscribe to, or control account B sessions
  4. Integration tests assert that observers cannot input/resize/stop and revoked tokens cannot obtain WS tickets or write
  5. Integration tests assert that `POST /api/sessions` with a non-whitelisted provider name is rejected
  6. Integration tests assert that API keys matching known patterns are redacted in `terminal.output` and `user.input` events stored in the DB
  7. Integration tests assert that the legacy snapshot (`GET /api/sessions/:id/snapshot`) and send (`POST /api/sessions/:id/send`) endpoints still respond correctly through the event store
  8. Integration tests assert that the retention job deletes the correct rows under both the 7-day time trigger and the 100 MB per-session size trigger
  9. `approval.requested`, `diff.detected`, and `agent.handoff` event types have an exhaustive-switch parser test that fails compilation when a new event type is added without a handler; roadmap and phase docs note that future review UI owns the full diff/approval surface
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Personal Relay MVP | 4/4 | Complete | 2026-05-01 |
| 2. Experience Hardening | 0/TBD | Not started | - |
| 3. Cleanup | 0/4 | Planned | - |
| 4. Account & Auth Contract | 0/TBD | Not started | - |
| 5. Multi-user Auth, Relay Auth & Audit | 0/TBD | Not started | - |
| 6. Retention | 0/TBD | Not started | - |
| 7. Supervisor & launchd | 5/5 | Complete | 2026-05-02 |
| 8. Security, Isolation Tests & Final Cleanup | 0/TBD | Not started | - |

---
*Roadmap created: 2026-05-01*
*Milestone reordered: 2026-05-01 — personal Relay MVP moved to Phase 1*
*Execution order update: 2026-05-01 — Phase 6 pulled forward after Phase 1 for solo-use Gateway persistence*
*Scope update: 2026-05-02 — multi-account auth promoted into v0.3; shared-secret Relay remains bootstrap only*
*Coverage: 28/28 v1 requirements mapped*
