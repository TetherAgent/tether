---
phase: 14-multi-device-gateway-routing
plan: 01
subsystem: database
tags: [mysql, migration, gateway, multi-device]
requires:
  - phase: 14-multi-device-gateway-routing
    provides: phase context and migration requirements
provides:
  - Idempotent MySQL migration for per-device Gateway records
  - New unique key shape for account/user/device-key Gateway binding
affects: [apps-server, gateway-auth, relay-routing, web-gateway-selector]
tech-stack:
  added: []
  patterns: [INFORMATION_SCHEMA guarded DDL migrations]
key-files:
  created:
    - apps/server/sql/009_multi_device_gateway.sql
  modified: []
key-decisions:
  - "Migration 009 only adds device_key, hostname, and local_port plus unique-key replacement; it does not touch workspace_id or fk_gateways_workspace because 007 already removed them."
patterns-established:
  - "Use INFORMATION_SCHEMA checks with PREPARE/EXECUTE for repeated Server startup-safe DDL."
requirements-completed: [GATEWAY-MULTI-01]
duration: 16min
completed: 2026-05-11
---

# Phase 14 Plan 01: DB Migration Summary

**Idempotent MySQL migration adds per-device Gateway metadata and replaces the per-user unique key with account/user/device-key uniqueness.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-11T05:30:00Z
- **Completed:** 2026-05-11T05:46:31Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `apps/server/sql/009_multi_device_gateway.sql`.
- Added guarded DDL for `device_key`, `hostname`, and `local_port` on `gateways`.
- Replaced `uq_gateways_account_user` with `uq_gateways_device_key (account_id, user_id, device_key)`.
- Kept legacy rows compatible by allowing `device_key` to remain `NULL`.

## Task Commits

1. **Task 1: 创建 009_multi_device_gateway.sql（幂等 DDL）** - `9e3ca6a` (feat)

## Files Created/Modified

- `apps/server/sql/009_multi_device_gateway.sql` - Phase 14 migration with `INFORMATION_SCHEMA` guards for columns and indexes.

## Decisions Made

- Followed the existing `008_gateway_session_title_source.sql` conditional DDL pattern.
- Did not drop or reference `workspace_id` / `fk_gateways_workspace`, matching the Phase 14 research finding that 007 already removed them.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- `pnpm --filter @tether/server typecheck` passed.
- MySQL double-run verification was not run because this machine does not expose a `mysql` client in PATH. Remaining manual check: run the two `mysql -u root tether < apps/server/sql/009_multi_device_gateway.sql` commands from the plan in an environment with MySQL client access.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can now implement server-side `device_key` upsert and Gateway list APIs against the expected database shape. The only residual risk is live MySQL execution, which should be confirmed before relying on the migration in a persistent dev/prod database.

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
