---
phase: 14-multi-device-gateway-routing
plan: 03
subsystem: gateway-auth
tags: [cli, gateway, auth-json, device-json, jwt]
requires:
  - phase: 14-multi-device-gateway-routing
    provides: device-key bind endpoint from Plan 02
provides:
  - Stable local device identity file for Gateway login
  - Simplified Gateway auth state file format
  - Gateway runtime JWT payload decoding for identity
affects: [apps-cli, apps-web, apps-gateway, relay-client]
tech-stack:
  added: []
  patterns: [local 0600 auth files, base64url JWT payload decode for local identity extraction]
key-files:
  created: []
  modified:
    - apps/cli/src/main.ts
    - apps/web/src/pages/gateway-auth-page.tsx
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/relay-client.ts
key-decisions:
  - "auth.json now persists only serverUrl, accessToken, refreshToken, and expiresAt; legacy extra fields remain tolerated for compatibility."
  - "device.json stores the stable per-machine dev_* key used by browser Gateway authorization."
patterns-established:
  - "Runtime Gateway identity should be decoded from the gateway access token, with legacy auth.json fields used only as compatibility fallback."
requirements-completed: [GATEWAY-MULTI-03]
duration: 24min
completed: 2026-05-11
---

# Phase 14 Plan 03: CLI And Gateway Auth Summary

**Gateway login now uses a stable local `dev_*` device key and trims `auth.json` down to token state while Gateway runtime derives identity from JWT payloads.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-05-11T06:06:00Z
- **Completed:** 2026-05-11T06:30:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added `TETHER_DEVICE_PATH ?? ~/.tether/device.json` with `{ deviceKey, deviceName }`, generated as `dev_` plus 12 random bytes in hex.
- Updated `tether gateway login` browser URL to include `deviceKey`, `hostname`, and callback `port`.
- Updated the Web Gateway auth page to require and forward `deviceKey`.
- Simplified CLI/Gateway `GatewayAuthState` validation to the four persisted auth fields.
- Added Gateway-side token payload decoding helpers for `gatewayId/accountId/userId`.

## Task Commits

1. **Tasks 1-3: device.json, gateway-auth forwarding, auth.json simplification, JWT identity decode** - `63a5276` (feat)

## Files Created/Modified

- `apps/cli/src/main.ts` - Adds device state helpers and writes simplified auth state.
- `apps/web/src/pages/gateway-auth-page.tsx` - Reads `deviceKey` from URL and posts it to `/api/server/gateway-auth/bind`.
- `apps/gateway/src/daemon.ts` - Adds `decodeGatewayToken` / `getGatewayIdentity` and removes direct callsite reads of `authState.value.gatewayId`.
- `apps/gateway/src/relay-client.ts` - Resolves Relay auth identity from token payload, with legacy auth.json fallback.

## Decisions Made

- Kept callback `gatewayId/accountId` parsing in CLI for current callback contract, but no longer writes those fields into `auth.json`.
- Added legacy fallback inside identity helpers so old auth fixtures/files with extra fields remain usable when their token is not a decodable JWT.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Compatibility] Legacy auth.json fallback retained inside helpers**
- **Found during:** Gateway tests
- **Issue:** Existing test fixtures and old auth files may contain `gatewayId/accountId` but use non-JWT placeholder tokens.
- **Fix:** `getGatewayIdentity` and `resolveRelayAuth` use JWT payload first, then fall back to legacy extra fields without keeping direct callsite reads.
- **Files modified:** `apps/gateway/src/daemon.ts`, `apps/gateway/src/relay-client.ts`
- **Verification:** `pnpm --filter @tether/gateway typecheck` passed; targeted gateway tests improved daemon ownership check but relay-client suite still has unrelated legacy visibility failures.
- **Committed in:** `63a5276`

---

**Total deviations:** 1 auto-fixed (compatibility).
**Impact on plan:** Preserves old auth compatibility while keeping the new persisted auth.json contract.

## Issues Encountered

- `pnpm --filter @tether-labs/cli typecheck` passed.
- `pnpm --filter @tether/web typecheck` passed.
- `pnpm --filter @tether/gateway typecheck` passed.
- Targeted `daemon.test.ts` ownership regression passed after compatibility fallback.
- `relay-client.test.ts` still has existing visibility/time-out failures in relay session listing/control tests. They are not introduced by type errors, but the full gateway test suite is not clean yet.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can update protocol/Web frame contracts to carry the selected `gatewayId`; the Gateway login side now supplies a stable device key and no longer relies on persisted `gatewayId/accountId` fields.

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
