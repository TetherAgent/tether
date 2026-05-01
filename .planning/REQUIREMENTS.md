# Requirements: Tether v0.3 — Personal Relay Access

**Defined:** 2026-05-01
**Core Value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。

## Milestone Scope

This is a **personal remote-access milestone** — Phase 2 PTY-backed event stream main path is shipped (see `.planning/PROJECT.md` Validated section), and the next priority is making it usable by the owner from outside the LAN through a minimal self-hosted Relay. The v0.3 requirements below cover the unchecked Phase 2 hardening items plus one new Relay MVP requirement.

**Milestone exit:** A solo user can reach a Mac Gateway through a self-hosted Relay, then the remaining P0+P1 requirements pass: direct/relay writes are authenticated, local terminal experience does not regress vs tmux, event storage is bounded, and security/integration tests cover the relay and Gateway safety boundaries.

## v1 Requirements

### Personal Relay MVP (P0 — remote access for a solo owner)

- [x] **RELAY-01**: Gateway can connect outbound to a self-hosted Relay over WSS using an owner-configured relay link secret. A remote Web client can authenticate to that Relay, list/attach to existing Gateway sessions, and exchange terminal output/input/resize/control frames. Relay only forwards authenticated protocol frames, never executes commands, never accepts provider command/args/env, and does not persist terminal plaintext. Multi-user accounts, billing, federation, push, and full E2EE relay envelopes are out of scope for this requirement.

### Experience Hardening (P0 — local terminal experience must not regress vs tmux)

- [ ] **EXP-01**: User can detach from a `tether attach <id>` session via a Tether-defined hotkey (`Ctrl-]`) without killing the agent. Hotkey is CLI-side; closing the attach client is also still a valid detach.
- [ ] **EXP-02**: `Enter` / `Backspace` / `Ctrl-C` / `Ctrl-D` behave the same inside `tether attach` as in a direct `tmux attach` to the same agent. Verified against Codex and Claude TUIs on macOS.
- [ ] **EXP-03**: Pasting >2KB of text via bracketed paste into `tether attach` reaches the agent intact (no truncation, no control-character misinterpretation, no macOS 1024-byte buffer corruption).
- [ ] **EXP-04**: ANSI color, cursor movement, screen clearing, and alternate-screen TUIs (Codex / Claude full-screen modes) render correctly on both CLI attach and Web xterm.js client.
- [ ] **EXP-05**: Resizing the terminal while a complex TUI is mounted (Codex / Claude) does not produce persistent layout corruption — agent re-renders within one frame after resize completes.

### Cleanup (P2 — clears the deck before full auth work)

- [ ] **CLEAN-01**: tmux fallback transport (`--transport tmux`) is removed from production paths. Historical `transport='tmux'` rows in SQLite remain readable but no new tmux sessions can be created.
- [ ] **CLEAN-02**: `transport` column / TypeScript `SessionTransport` type is either removed or explicitly retained as a future extension point with a documented migration path (decision recorded).

### Authentication (P1 — hardens direct and relay-routed writes)

- [ ] **AUTH-02**: User can run `tether pair`, receive a one-time pairing code (or QR), enter it from a phone/Web client, and receive a device token. Token hash (SHA-256) is stored in SQLite `device_tokens` table; raw token only ever exists in memory and the response payload.
- [ ] **AUTH-01**: All write endpoints (input / resize / stop / claim-control / release-control / `POST /api/sessions` / `POST /api/ws-ticket`) reject requests without a valid `Authorization: Bearer <device-token>` header. Device names appear in `client.attached` events. Relay-routed writes use the same device-token checks once this requirement lands.

### Retention & Storage Health (P1 — required before multi-hour Gateway uptimes)

- [ ] **RETAIN-01**: Gateway runs an internal retention job (default: keep 7 days OR 100MB per session, whichever hits first; configurable). Job is scheduled inside the Gateway process, runs every 15 minutes, deletes rows in batches without blocking writers, and triggers `PRAGMA wal_checkpoint(RESTART)` on a longer cadence to prevent WAL bloat.

### Supervisor & Background Service (P1 — required to make Gateway the single session owner)

- [ ] **GW-01**: A single persistent `tether gateway` process owns all PTY sessions. CLI `tether run / codex / claude / opencode / attach / stop` commands probe for a running Gateway and forward to it; absence of a running Gateway falls back to inline bootstrap with a warning. node-pty is upgraded to >= 1.2.0-beta.12 (closes fd-leak issue #907) before this requirement is closed.
- [ ] **GW-02**: User can run `tether gateway install` to register a `~/Library/LaunchAgents/sh.tether.gateway.plist` that launches Gateway at login (`RunAtLoad`), restarts on crash (`KeepAlive`), and uses an absolute `node` path snapshotted at install time. `tether gateway uninstall` removes it cleanly.

### Tests (P1 — milestone exit gate)

- [ ] **TEST-01**: Integration tests cover: Relay rejects unauthenticated connections and cannot spawn arbitrary providers; write endpoints reject unauthenticated requests; provider whitelist rejects non-listed providers; secret mask redacts known tokens in `terminal.output` and `user.input` events; legacy snapshot/send endpoints still respond correctly through the event store; retention job deletes correct rows under both time-based and size-based triggers.

### Structured Event Cleanup (P2 — minor)

- [ ] **CLEAN-03**: ROADMAP/Phase docs note that Phase 4 owns the full diff/approval UI; `approval.requested` / `diff.detected` / `agent.handoff` event types have an exhaustive-switch parser test that fails when new event types are added without handling.

## v2 Requirements (deferred — not in v0.3 roadmap)

### Remote Access (full)

- **TUNNEL-01**: First-class Cloudflare Tunnel / Tailscale documentation and `--public-url` flag end-to-end.
- **RELAY-02**: Production-grade Relay hardening: multi-user accounts, hosted control plane, end-to-end encrypted relay envelopes, advanced reconnect/session migration, and operational observability.
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
| Hosted Relay service / multi-user accounts | Personal-use MVP only; production SaaS/control plane waits |
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
| AUTH-02 | Phase 4 | Pending |
| AUTH-01 | Phase 4 | Pending |
| RETAIN-01 | Phase 5 | Pending |
| GW-01 | Phase 6 | Pending |
| GW-02 | Phase 6 | Pending |
| TEST-01 | Phase 7 | Pending |
| CLEAN-03 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-05-01*
*Last updated: 2026-05-01 — personal Relay MVP promoted into v0.3*
