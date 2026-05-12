# Requirements: Tether v0.3 — Multi-account Relay Access

**Defined:** 2026-05-01
**Core Value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。

## Milestone Scope

This is a **multi-account remote-access milestone** — Phase 2 PTY-backed event stream main path is shipped (see `.planning/PROJECT.md` Validated section), and the next priority is making it usable through an authenticated Relay path that supports multiple accounts, multiple external clients, Gateway ownership, session ownership, and role-based control.

The already-shipped Personal Relay MVP remains useful as a development bootstrap, but its shared-secret model is not the target auth model. Production-facing direct/relay writes must be account-token authenticated.

**Milestone exit:** Multiple logged-in users can use external clients against the Relay without crossing account/workspace boundaries. A Gateway authenticates at startup, sessions are scoped to their owning account/workspace/Gateway, direct/relay writes are authorized by role, local terminal experience does not regress vs tmux, event storage is bounded, and security/integration tests cover account isolation, Relay auth, Gateway auth, and audit boundaries.

## v1 Requirements

### Personal Relay MVP (P0 — remote access for a solo owner)

- [x] **RELAY-01**: Gateway can connect outbound to a self-hosted Relay over WSS using an owner-configured relay link secret. A remote Web client can authenticate to that Relay, list/attach to existing Gateway sessions, and exchange terminal output/input/resize/control frames. Relay only forwards authenticated protocol frames, never executes commands, never accepts provider command/args/env, and does not persist terminal plaintext. This is a completed bootstrap requirement; production multi-account auth is covered by `ACCOUNT-*`, `AUTH-*`, `RELAY-AUTH-*`, and `AUDIT-*`.

### Experience Hardening (P0 — local terminal experience must not regress vs tmux)

- [ ] **EXP-01**: User can detach from a `tether attach <id>` session via a Tether-defined hotkey (`Ctrl-]`) without killing the agent. Hotkey is CLI-side; closing the attach client is also still a valid detach.
- [ ] **EXP-02**: `Enter` / `Backspace` / `Ctrl-C` / `Ctrl-D` behave the same inside `tether attach` as in a direct `tmux attach` to the same agent. Verified against Codex and Claude TUIs on macOS.
- [ ] **EXP-03**: Pasting >2KB of text via bracketed paste into `tether attach` reaches the agent intact (no truncation, no control-character misinterpretation, no macOS 1024-byte buffer corruption).
- [ ] **EXP-04**: ANSI color, cursor movement, screen clearing, and alternate-screen TUIs (Codex / Claude full-screen modes) render correctly on both CLI attach and Web xterm.js client.
- [ ] **EXP-05**: Resizing the terminal while a complex TUI is mounted (Codex / Claude) does not produce persistent layout corruption — agent re-renders within one frame after resize completes.

### Cleanup (P2 — clears the deck before full auth work)

- [ ] **CLEAN-01**: tmux fallback transport (`--transport tmux`) is removed from production paths. Historical `transport='tmux'` rows in SQLite remain readable but no new tmux sessions can be created.
- [ ] **CLEAN-02**: `transport` column / TypeScript `SessionTransport` type is either removed or explicitly retained as a future extension point with a documented migration path (decision recorded).

### Account & Auth Contract (P0 — short no-code gate before Phase 5)

- [ ] **ACCOUNT-01**: Define the canonical ownership graph in a Phase 4 contract document: `account -> workspace -> gateway -> session`, plus `user` and `device` identities. Every Gateway and session must resolve to exactly one account/workspace boundary before it can be exposed through Relay.
- [ ] **ACCOUNT-02**: Define roles and permissions for multi-user use in the same contract. Minimum roles are `owner`, `admin`, `controller`, and `observer`; list/read/subscribe/input/resize/claim-control/release-control/stop/session-create/Gateway-admin permissions are explicitly mapped.
- [ ] **ACCOUNT-03**: Define token classes and trust boundaries in the contract: client access token, client refresh token, device identity, Gateway token, and short-lived WS ticket. Token payloads must carry enough identity to authorize account/workspace/Gateway/session access without trusting client-supplied query fields.
- [ ] **ACCOUNT-04**: Define where auth state lives and how Phase 5 consumes the contract. The remote auth/control-plane is source of truth for accounts, users, devices, Gateway registrations, session visibility policy, token issuance, refresh, logout, and revoke. Local Gateway stores only the minimum cached identity/session metadata needed for offline-safe operation and audit continuity.
- [ ] **ACCOUNT-05**: Phase 4 is no-code by default. It must not change runtime code, database schema, API handlers, Relay behavior, or Web UI; it only produces the contract that Phase 5 implements. Any exception must be explicitly called out and approved before execution.

### Multi-user Authentication & Access Control (P1 — replaces single-owner device auth)

- [ ] **AUTH-01**: External Web/native clients must log in to the remote auth/control-plane and receive a short-lived access token plus refresh token. Relay and Gateway APIs must reject unauthenticated clients; relay secret is development/bootstrap only and not accepted as production client auth.
- [ ] **AUTH-02**: Gateway startup must authenticate to the remote auth/control-plane, bind to an account/workspace, receive or refresh a Gateway token, and use that token when connecting outbound to Relay. A Gateway without a valid token cannot publish sessions through Relay.
- [ ] **AUTH-03**: All write endpoints (input / resize / stop / claim-control / release-control / `POST /api/sessions` / `POST /api/ws-ticket`) reject requests without a valid token and a role that permits the action. Direct Gateway mode and Relay-routed mode must use the same authorization rules.
- [ ] **AUTH-04**: Browser WebSocket connections use HTTP token auth to obtain a short-lived, single-use WS ticket; the ticket is scoped to account/workspace/Gateway/session/mode and cannot be reused for another session or role.
- [ ] **AUTH-05**: Token revoke, device revoke, logout, and Gateway unlink are enforced. Revoked clients cannot obtain new WS tickets or perform HTTP writes; existing WS connections are closed or downgraded on the next server-side authorization check.
- [ ] **AUTH-06**: Multi-user concurrent attach is supported. Multiple users may observe the same session; only authorized controllers can input/resize/claim-control. Control arbitration is deterministic and records the winning user/device.

### Relay Authentication & Routing (P1 — upgrades Personal Relay MVP)

- [ ] **RELAY-AUTH-01**: Relay Gateway WS (`/gateway`) and Client WS (`/client`) both require valid tokens. Relay validates token class and account/workspace/Gateway/session scope before accepting registration, list, subscribe, input, resize, or control frames.
- [ ] **RELAY-AUTH-02**: Relay routes frames only within the same authorized account/workspace/Gateway/session boundary. A client from account A cannot list, subscribe to, or control account B sessions, even if it guesses IDs.
- [ ] **RELAY-AUTH-03**: Relay remains non-executing infrastructure. It never accepts provider command/args/env, never starts sessions by arbitrary command, never persists terminal plaintext, and never becomes the source of truth for session ownership.

### Audit & Identity Events (P1 — required for multi-user accountability)

- [ ] **AUDIT-01**: `client.attached`, `client.detached`, `control.claimed`, `control.released`, `user.input`, `resize`, `session.created`, `session.stopped`, and Relay auth failures record `accountId`, `workspaceId`, `userId`, `deviceId`, `gatewayId`, and `role` where applicable.
- [ ] **AUDIT-02**: Stored and streamed events continue to mask secrets/API keys, and identity metadata must not include raw tokens, refresh tokens, or relay secrets.

### Retention & Storage Health (P1 — required before multi-hour Gateway uptimes)

- [ ] **RETAIN-01**: Gateway runs an internal retention job (default: keep 7 days OR 100MB per session, whichever hits first; configurable). Job is scheduled inside the Gateway process, runs every 15 minutes, deletes rows in batches without blocking writers, and triggers `PRAGMA wal_checkpoint(RESTART)` on a longer cadence to prevent WAL bloat.

### Supervisor & Background Service (P1 — required to make Gateway the single session owner)

- [x] **GW-01**: A single persistent `tether gateway` process owns all PTY sessions. CLI `tether run / codex / claude / opencode / attach / stop` commands probe for a running Gateway and forward to it; absence of a running Gateway falls back to inline bootstrap with a warning. node-pty is upgraded to >= 1.2.0-beta.12 (closes fd-leak issue #907) before this requirement is closed.
- [x] **GW-02**: User can run `tether gateway install` to register a `~/Library/LaunchAgents/sh.tether.gateway.plist` that launches Gateway at login (`RunAtLoad`), restarts on crash (`KeepAlive`), and uses an absolute `node` path snapshotted at install time. `tether gateway uninstall` removes it cleanly.

### Tests (P1 — milestone exit gate)

- [ ] **TEST-01**: Integration tests cover: Relay rejects unauthenticated Gateway/client connections; Gateway startup without a valid Gateway token cannot publish sessions; write endpoints reject unauthenticated or under-authorized requests; account A cannot list/subscribe/control account B sessions; observer cannot input/resize/stop; provider whitelist rejects non-listed providers; revoked tokens fail; secret mask redacts known tokens in `terminal.output` and `user.input` events; legacy snapshot/send endpoints still respond correctly through the event store; retention job deletes correct rows under both time-based and size-based triggers.

### Structured Event Cleanup (P2 — minor)

- [ ] **CLEAN-03**: ROADMAP/Phase docs note that future review UI owns the full diff/approval surface; `approval.requested` / `diff.detected` / `agent.handoff` event types have an exhaustive-switch parser test that fails when new event types are added without handling.

### SQLite Removal (P1 — remove local PTY persistence)

- [x] **SQLITE-01**: PTY live events and session metadata no longer depend on local SQLite writes on the live Gateway path.
- [x] **SQLITE-02**: Relay restores gateway-scoped sessions after auth and PTY session creation moves to `client.new-pty-session` websocket frames for CLI/Gateway runtime flow.
- [ ] **SQLITE-03**: `store.ts`, `better-sqlite3`, and all residual local SQLite references are removed from Gateway and CLI runtime paths.

## v2 Requirements (deferred — not in v0.3 roadmap)

### Remote Access (full)

- **TUNNEL-01**: First-class Cloudflare Tunnel / Tailscale documentation and `--public-url` flag end-to-end.
- **RELAY-02**: Production-grade Relay hardening beyond v0.3: hosted operations, end-to-end encrypted relay envelopes, advanced reconnect/session migration, and operational observability.
- **PUSH-01**: APNs / FCM push notifications.

### Phase 3a — Provider Abstraction

- **PROV-01**: ACP / JSON-RPC provider protocol abstraction; multi-agent concurrent tabs.

### Phase 3b — Federation

- **FED-01**: Multi-machine federation with discovery and trust model.

### Phase 4 — Read-only Review UI

- **REVIEW-01**: Read-only diff viewer / file tree / rich permission review (NOT a code editor).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloudflare Tunnel / Tailscale tooling | v0.3 focuses on self-hosted Relay MVP first; tunnel-specific UX waits |
| Hosted SaaS billing / organization administration | v0.3 defines and implements the minimum multi-account auth boundary, but not a full commercial SaaS control plane |
| End-to-end encrypted relay envelopes | Production hardening after frame routing proves useful |
| Provider abstraction layer | Phase 3a — adds complexity without changing v0.3 finishing surface |
| Multi-machine federation | Phase 3b — orthogonal, separate milestone |
| Push notifications | Phase 3c — depends on stable relay/session ownership first |
| Diff / file tree / approval UI | Phase 4 — v0.3 ships only the structured-event placeholder |
| Code patch editor / full code editor / LSP | **Permanent** — IDE-creep boundary |
| tmux pane / window / prefix / copy mode / plugins | **Permanent** — Tether is not a general multiplexer |
| Arbitrary shell command remote execution | **Permanent** — security baseline |
| Linux / Windows support | v0.3 is macOS-only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RELAY-01 | Phase 1 | Satisfied |
| EXP-01 | Phase 2 | Pending |
| EXP-02 | Phase 2 | Pending |
| EXP-03 | Phase 2 | Pending |
| EXP-04 | Phase 2 | Pending |
| EXP-05 | Phase 2 | Pending |
| CLEAN-01 | Phase 3 | Pending |
| CLEAN-02 | Phase 3 | Pending |
| ACCOUNT-01 | Phase 4 | Pending |
| ACCOUNT-02 | Phase 4 | Pending |
| ACCOUNT-03 | Phase 4 | Pending |
| ACCOUNT-04 | Phase 4 | Pending |
| ACCOUNT-05 | Phase 4 | Pending |
| AUTH-01 | Phase 5 | Pending |
| AUTH-02 | Phase 5 | Pending |
| AUTH-03 | Phase 5 | Pending |
| AUTH-04 | Phase 5 | Pending |
| AUTH-05 | Phase 5 | Pending |
| AUTH-06 | Phase 5 | Pending |
| RELAY-AUTH-01 | Phase 5 | Pending |
| RELAY-AUTH-02 | Phase 5 | Pending |
| RELAY-AUTH-03 | Phase 5 | Pending |
| AUDIT-01 | Phase 5 | Pending |
| AUDIT-02 | Phase 5 | Pending |
| RETAIN-01 | Phase 6 | Pending |
| GW-01 | Phase 7 | Complete |
| GW-02 | Phase 7 | Complete |
| TEST-01 | Phase 8 | Pending |
| CLEAN-03 | Phase 8 | Pending |
| SQLITE-01 | Phase 18 | Complete |
| SQLITE-02 | Phase 18 | Complete |
| SQLITE-03 | Phase 18 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-05-01*
*Last updated: 2026-05-02 — multi-account auth promoted into v0.3 and single-owner auth replaced*
