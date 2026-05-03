---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: verifying
stopped_at: Phase 6 UI-SPEC approved
last_updated: "2026-05-02T17:22:36.089Z"
last_activity: 2026-05-02 -- Phase 05 MySQL-backed live auth/gateway verification complete; same-user multi-device metadata refresh still pending
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 20
  completed_plans: 16
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。
**Current focus:** Phase 05 — web-first-account-setup-server-auth-runtime

## Current Position

Phase: 05 (web-first-account-setup-server-auth-runtime) — EXECUTING
Plan: 7 of 7
Status: Automated execution complete; web auth routes and live submit verification complete; waiting on same-user multi-device metadata refresh verification
Last activity: 2026-05-02 -- Phase 05 MySQL-backed live auth/gateway verification complete; same-user multi-device metadata refresh still pending

Progress: [████████░░] 86%

## Performance Metrics

**Velocity:**

- Total plans completed: 19
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03 | 4 | - | - |
| 3 | 4 | - | - |
| 04 | 1 | - | - |
| 4 | 1 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 2 shipped: PTY-backed event stream (TRANSPORT-01..04, CLI-01/02, MULTI-01, WEB-01, REPLAY-01, SAFE-01..03, STATE-01, STRUCT-01) — all validated
- v0.3 scope has changed to Multi-account Relay Access: account login, Gateway startup auth, Relay Gateway/Client WS auth, ownership, roles, revoke, and audit are now in scope
- Relay MVP is Phase 1: self-hosted Relay, Gateway outbound WSS, owner link secret, one Gateway + remote Web client; this remains a bootstrap path only, not the target auth model
- Supervisor/launchd was pulled forward and completed as a foundation capability for Gateway persistence; it no longer occupies an active roadmap phase number
- Normal roadmap now resumes at Phase 4 account/auth contract, then Phase 5 Web-first account setup/auth runtime, Phase 6 account management console, Phase 7 retention, and Phase 8 security/isolation tests
- Phase 4 is a short no-code contract gate: it must define account/workspace/Gateway/session ownership, user/device identity, roles, token classes, sharing/control semantics, revoke, and audit before Phase 5 implementation starts
- Phase 5 is Web-first Account Setup & Server Auth Runtime: it should add `apps/server`, `/register`, `/login`, `/admin/register`, `/admin/login`, Gateway login/bind, Relay auth/role/audit runtime only, not the full account management UI
- Phase 6 is Account Management Console: workspace/member/role/device/Gateway/revoke/audit administration belongs there
- Dedicated Server decision: account registration, login, token issuance/refresh/revoke, Gateway registration/binding, Relay authorization checks, and audit ingestion belong in remote `apps/server`; Relay stays routing-only and Gateway stays local session owner
- First account creation decision: first owner creation is normal Web registration in `apps/web` using `/register`; bootstrap-only setup semantics are not part of the required Phase 5 product path, and CLI bootstrap is only emergency/admin recovery, not the primary product path
- Gateway binding decision: `tether gateway login` prompts for account/password in CLI, binds the local Gateway to the account/default workspace, stores/refreshes a Gateway token, and treats expired/revoked/unrefreshable tokens as logged out with a clear relogin prompt
- Management identity decision: management console has a separate registration/login flow from normal Web/session users; the first registered management-console account is `super_admin`; management tokens do not automatically grant terminal/session control
- Normal Web user decision: v0.3 normal Web/session users have no role hierarchy; they can access/control their own sessions only. Session sharing roles such as controller/observer and claim-control arbitration are deferred.
- Management role decision: v0.3 management console roles are limited to `super_admin` and `admin`. `super_admin` manages management users and system/security settings; `admin` handles day-to-day normal user/device/Gateway/audit operations only. Additional roles such as auditor/operator/support are deferred.
- Multi-device sync decision: same-user Web/native devices use an authenticated Server notification WebSocket for lightweight metadata and invalidation events. Server pushes session list refresh, session lifecycle, Gateway online/offline, logout, token/device revoke, and auth state changes there; PTY bytes remain on Relay/Gateway session sockets, and APNs/FCM offline push stays deferred.
- Login analytics decision: auth success/failure/logout/refresh and device create/revoke events are first-class audit events. Phase 6 management console shows per-user login counts, last login/failure, active/revoked device counts, and recent auth/security history derived from audit data without storing raw passwords, tokens, or secrets.
- Web UI decision: `apps/web` setup, login, authenticated session shell, and Phase 6 management console should use shadcn as the shared component system
- Workspace decision: v0.3 product UI only exposes one auto-created default workspace per account; schema, token payloads, Gateway binding, session ownership, and audit events must still include `workspaceId`; full multi-workspace creation/switching is deferred to `WORKSPACE-01`
- Detach hotkey: `Ctrl-]` (0x1D, ASCII GS) — CLI-side intercept only, not Gateway-side
- PTY write chunking: 512 bytes per write with `setImmediate` between chunks (macOS PTY 1024-byte buffer bug)
- node-pty must upgrade to ≥ 1.2.0-beta.12 before Phase 5 (GW-01) begins — closes fd-leak issue #907
- Auth pattern: browser WS still uses HTTP token auth to obtain a short-lived one-time WS ticket; token checks must include account/workspace/Gateway/session scope and role
- Token model: client access token, refresh token, Gateway token, device identity, and WS ticket are separate classes; raw long-lived secrets must not be stored in session events or Relay logs
- Retention is now Phase 7: DELETE WHERE ts < cutoff every 15 min; WAL checkpoint (RESTART) on 5-min cadence; no auto-VACUUM
- launchd plist: absolute node path snapshotted at install time via `process.execPath`; `$HOME` not expanded — all paths must be literal strings
- CLEAN-02 decision: retain `transport` column as extension point; remove `'tmux'` from active write types only; keep `'tmux'` in `fromRow` for historical reads

### Pending Todos

- Manual Phase 5 verification pending:
  - verify same-user multi-device metadata refresh flow in a live environment

### Roadmap Evolution

- Phase 9 added: Flutter Client App
- Phase 10 added: Multi-workspace Expansion for WORKSPACE-01; use `$gsd-discuss-phase 10` when ready

### Blockers/Concerns

- GW-01 probe fallback behavior when Gateway is mid-restart (launchd race) is underspecified in research — recommend a brief design pass before future Gateway hardening. Suggested: retry loop with 3 attempts / 500ms spacing before falling back to in-process.
- Phase 4 must happen before Phase 5. Without a written ownership/token/role/setup/Server contract, Phase 5 auth runtime and Phase 6 management console will likely conflict and require rework.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Phase 1.5 | Cloudflare Tunnel / Tailscale tooling | Deferred to v0.4+ | v0.3 scoping |
| Relay hardening | Hosted SaaS operations and E2EE relay envelopes | Deferred after multi-account auth boundary | v0.3 reorder |
| Phase 3a | Provider abstraction (ACP / JSON-RPC) + multi-agent | Deferred | v0.3 scoping |
| Phase 3b | Multi-machine federation | Deferred | v0.3 scoping |
| Phase 3c | Push notifications + encrypted relay | Deferred | v0.3 scoping |
| Phase 4 | Diff / file tree / rich approval UI | Deferred to v1.0+ | v0.3 scoping |
| Workspace expansion | Multi-workspace creation, switching, per-workspace member management | Deferred to Phase 10 / WORKSPACE-01 | Phase 4 discussion |
| Session sharing | controller/observer roles, session sharing invites, and claim-control arbitration | Deferred to SHARING-01 | Phase 4 discussion |

## Session Continuity

Last session: 2026-05-02T17:22:36.084Z
Stopped at: Phase 6 UI-SPEC approved
Resume file: .planning/phases/06-account-management-console/06-UI-SPEC.md
