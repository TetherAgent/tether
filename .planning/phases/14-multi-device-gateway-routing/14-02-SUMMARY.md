---
phase: 14-multi-device-gateway-routing
plan: 02
subsystem: server-api
tags: [egg, gateway, device-key, mysql, auth]
requires:
  - phase: 14-multi-device-gateway-routing
    provides: apps/server/sql/009_multi_device_gateway.sql
provides:
  - Device-key based Gateway bind/upsert service path
  - Normal-user Gateway list API for Web selection
affects: [apps-server, apps-web, gateway-cli, relay-routing]
tech-stack:
  added: []
  patterns: [repository-owned storage fallback, thin controller, route-level token-class guard]
key-files:
  created: []
  modified:
    - apps/server/app/service/runtime.ts
    - apps/server/app/service/gatewayRepository.ts
    - apps/server/app/service/gateway.ts
    - apps/server/app/controller/gateway-auth.ts
    - apps/server/app/controller/gateway.ts
    - apps/server/app/router.ts
key-decisions:
  - "Existing Gateway names are not overwritten on repeated device-key bind; only hostname, localPort, status, and timestamps refresh."
  - "GET /api/server/gateways uses userId from normal_client_access auth state and accepts no user-supplied owner parameter."
patterns-established:
  - "Gateway device-key writes go through gatewayRepository.upsertGatewayByDeviceKey and depend on uq_gateways_device_key."
requirements-completed: [GATEWAY-MULTI-02]
duration: 18min
completed: 2026-05-11
---

# Phase 14 Plan 02: Server Gateway API Summary

**Server Gateway binding now accepts stable `dev_*` device keys and exposes the current user's Gateway list for Web selection.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-11T05:47:00Z
- **Completed:** 2026-05-11T06:05:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Extended `GatewayRecord` with `deviceKey`, `hostname`, `localPort`, and `revoked` status support.
- Added repository methods for `upsertGatewayByDeviceKey`, `loadGatewayByDeviceKey`, and `loadGatewaysByUserId`.
- Updated browser-authorized Gateway bind to require `deviceKey`, validate the `dev_` format in service, and preserve existing Gateway names on rebind.
- Added `GET /api/server/gateways` behind `normal_client_access`.

## Task Commits

1. **Task 1-2: GatewayRecord/repository/service/controller/router updates** - `069709e` (feat)

## Files Created/Modified

- `apps/server/app/service/runtime.ts` - Extended in-memory `GatewayRecord` contract.
- `apps/server/app/service/gatewayRepository.ts` - Added device-key upsert/list methods and row mapping.
- `apps/server/app/service/gateway.ts` - Reworked `bindGatewayForUser` around validated `deviceKey`.
- `apps/server/app/controller/gateway-auth.ts` - Reads `deviceKey`, `hostname`, and `port` from bind request.
- `apps/server/app/controller/gateway.ts` - Adds normal-user Gateway list response.
- `apps/server/app/router.ts` - Registers `GET /api/server/gateways`.

## Decisions Made

- Kept legacy `saveGateway`, `loadGatewayByUserId`, and `loadGatewayById` in place for existing refresh/admin call sites.
- Used `row.local_port != null` when mapping `localPort`, so port `0` is not dropped.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- `pnpm --filter @tether/server exec tsc -p tsconfig.json --noEmit` passed.
- `pnpm --filter @tether/server test` ran after `pnpm --filter @tether/server run clean`; 19 tests passed and 1 pre-existing auth route test failed. The failing test posts `/api/token/validate`, while the router currently registers `/api/server/token/validate`. This is outside the Phase 14 Gateway path and was not changed here.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can now pass `deviceKey`, `hostname`, and local port through the browser Gateway auth flow and rely on the server response to return a stable Gateway identity.

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
