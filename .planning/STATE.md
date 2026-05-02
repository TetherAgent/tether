---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: executing
stopped_at: Phase 6 complete
last_updated: "2026-05-02T10:06:32.982Z"
last_activity: 2026-05-02 -- Phase 3 planning complete
progress:
  total_phases: 8
  completed_phases: 2
  total_plans: 13
  completed_plans: 9
  percent: 69
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。
**Current focus:** Phase 3 — Cleanup

## Current Position

Phase: 3 (Cleanup) — EXECUTING
Plan: 1 of 4
Status: Ready to execute
Last activity: 2026-05-02 -- Phase 3 planning complete

Progress: [██░░░░░░░░] 25%

## Performance Metrics

**Velocity:**

- Total plans completed: 9
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

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
- Phase 7 was pulled forward and completed as the former Phase 6 for Gateway persistence; normal roadmap now resumes at Phase 2, then cleanup, account/auth contract, multi-user auth implementation, retention, and security/isolation tests
- Phase 4 is a short no-code contract gate: it must define account/workspace/Gateway/session ownership, user/device identity, roles, token classes, sharing/control semantics, revoke, and audit before Phase 5 implementation starts
- Detach hotkey: `Ctrl-]` (0x1D, ASCII GS) — CLI-side intercept only, not Gateway-side
- PTY write chunking: 512 bytes per write with `setImmediate` between chunks (macOS PTY 1024-byte buffer bug)
- node-pty must upgrade to ≥ 1.2.0-beta.12 before Phase 5 (GW-01) begins — closes fd-leak issue #907
- Auth pattern: browser WS still uses HTTP token auth to obtain a short-lived one-time WS ticket; token checks must include account/workspace/Gateway/session scope and role
- Token model: client access token, refresh token, Gateway token, device identity, and WS ticket are separate classes; raw long-lived secrets must not be stored in session events or Relay logs
- Retention: DELETE WHERE ts < cutoff every 15 min; WAL checkpoint (RESTART) on 5-min cadence; no auto-VACUUM
- launchd plist: absolute node path snapshotted at install time via `process.execPath`; `$HOME` not expanded — all paths must be literal strings
- CLEAN-02 decision: retain `transport` column as extension point; remove `'tmux'` from active write types only; keep `'tmux'` in `fromRow` for historical reads

### Pending Todos

None yet.

### Blockers/Concerns

- GW-01 probe fallback behavior when Gateway is mid-restart (launchd race) is underspecified in research — recommend a brief design pass before future Gateway hardening. Suggested: retry loop with 3 attempts / 500ms spacing before falling back to in-process.

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

## Session Continuity

Last session: 2026-05-02T00:00:00Z
Stopped at: Phase 6 complete
Resume file: .planning/ROADMAP.md
