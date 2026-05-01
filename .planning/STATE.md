---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: executing
stopped_at: Phase 1 context gathered
last_updated: "2026-05-01T13:56:39.621Z"
last_activity: 2026-05-01 -- Phase 1 Wave 3 complete
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 4
  completed_plans: 3
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。
**Current focus:** Phase 1 — Personal Relay MVP

## Current Position

Phase: 1 of 7 (Personal Relay MVP)
Plan: 3 of 4 in current phase
Status: Executing
Last activity: 2026-05-01 -- Phase 1 Wave 3 complete

Progress: [████████░░] 75%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
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
- v0.3 scope: personal Relay-first remote access; macOS Gateway owner; avoid broad multi-user/product relay scope
- Relay MVP is Phase 1: self-hosted Relay, Gateway outbound WSS, owner link secret, one Gateway + remote Web client; Relay forwards frames only and never executes commands or persists terminal plaintext
- Detach hotkey: `Ctrl-]` (0x1D, ASCII GS) — CLI-side intercept only, not Gateway-side
- PTY write chunking: 512 bytes per write with `setImmediate` between chunks (macOS PTY 1024-byte buffer bug)
- node-pty must upgrade to ≥ 1.2.0-beta.12 before Phase 5 (GW-01) begins — closes fd-leak issue #907
- Auth pattern: one-time WS ticket stays; device token gates `POST /api/ws-ticket` itself
- Token storage: SHA-256 hash only in SQLite; raw token returned once at pairing and never stored
- Retention: DELETE WHERE ts < cutoff every 15 min; WAL checkpoint (RESTART) on 5-min cadence; no auto-VACUUM
- launchd plist: absolute node path snapshotted at install time via `process.execPath`; `$HOME` not expanded — all paths must be literal strings
- CLEAN-02 decision: retain `transport` column as extension point; remove `'tmux'` from active write types only; keep `'tmux'` in `fromRow` for historical reads

### Pending Todos

None yet.

### Blockers/Concerns

- GW-01 probe fallback behavior when Gateway is mid-restart (launchd race) is underspecified in research — recommend a brief design pass before Phase 5 planning. Suggested: retry loop with 3 attempts / 500ms spacing before falling back to in-process.
- node-pty upgrade to beta.12 is a prerequisite for GW-01 (Phase 5) and should be done at the start of that phase.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Phase 1.5 | Cloudflare Tunnel / Tailscale tooling | Deferred to v0.4+ | v0.3 scoping |
| Relay hardening | Hosted Relay service, multi-user accounts, E2EE relay envelopes | Deferred after personal MVP | v0.3 reorder |
| Phase 3a | Provider abstraction (ACP / JSON-RPC) + multi-agent | Deferred | v0.3 scoping |
| Phase 3b | Multi-machine federation | Deferred | v0.3 scoping |
| Phase 3c | Push notifications + encrypted relay | Deferred | v0.3 scoping |
| Phase 4 | Diff / file tree / rich approval UI | Deferred to v1.0+ | v0.3 scoping |

## Session Continuity

Last session: 2026-05-01
Stopped at: Phase 1 context gathered
Resume file: .planning/phases/01-personal-relay-mvp/01-CONTEXT.md
