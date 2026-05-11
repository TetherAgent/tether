---
phase: 14-multi-device-gateway-routing
plan: 05
subsystem: relay
tags: [relay-routing, gateway-selection, multi-account-isolation]
requires:
  - phase: 14-multi-device-gateway-routing
    plan: 04
    provides: GatewayId-bearing client frames
provides:
  - Explicit Gateway routing for new chat/provider/cwd frames
  - No fallback Gateway binding for client auth or Gateway status broadcast
  - Multi-account and multi-user isolation tests for Gateway routing
affects: [apps-relay]
tech-stack:
  added: []
  patterns: [explicit gatewayId routing, cached session listing, account-user gateway authorization]
key-files:
  created: []
  modified:
    - apps/relay/src/relay.ts
    - apps/relay/test/relay.test.ts
key-decisions:
  - "Relay no longer selects a fallback Gateway for normal client auth or Gateway-scoped discovery frames."
  - "client.list now returns Relay's filtered cached sessions instead of forwarding a list request to an arbitrary Gateway."
requirements-completed: [GATEWAY-MULTI-05]
duration: 45min
completed: 2026-05-11
---

# Phase 14 Plan 05: Relay Strict Gateway Routing Summary

Relay routing now requires explicit `gatewayId` for new-session chat, provider listing, and cwd suggestion frames.

## Performance

- **Duration:** 45 min
- **Started:** 2026-05-11T06:47:00Z
- **Completed:** 2026-05-11T07:32:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Removed the client-auth fallback from `clientScope.gatewayId ?? firstGatewayForScope(...)` to `clientScope.gatewayId`.
- Removed fallback binding from `ensureClientGatewayId`; it now only returns an already-bound client Gateway or a Gateway-scoped token value.
- Removed the `broadcastGatewayStatus` side effect that wrote a connected Gateway into `client.gatewayId`.
- Added `forwardFrameToGateway`, which returns `gateway_required` when `frame.gatewayId` is missing and `gateway_unauthorized` when `clientCanUseGateway(clientScope, gateway.scope)` fails.
- Routed new-session `client.chat`, `client.list-providers`, and `client.cwd-suggest` through `forwardFrameToGateway`.
- Kept the existing `client.chat` continuation branch untouched; it still uses session metadata routing.
- Changed `client.list` to return Relay cached sessions filtered by client scope instead of forwarding to a selected/fallback Gateway.
- Fixed subscribe authorization order so an existing but out-of-scope session returns `forbidden` rather than `gateway_unavailable`.

## Tests Added Or Updated

- Added `phase14: client.chat without gatewayId returns gateway_required and does not route to first gateway`.
- Added `phase14: client.chat with another account gatewayId returns gateway_unauthorized`.
- Added `phase14: client.list-providers with matching gatewayId routes only to that gateway`.
- Added `phase14: client auth does not implicitly bind to connected gateway status`.
- Updated existing relay tests that assumed `client.list` forwards to the first Gateway; the expected behavior is now cached Relay session listing.

## Task Commits

1. **Tasks 1-2: Relay strict routing and isolation tests** - `d40a663` (feat)

## Files Created/Modified

- `apps/relay/src/relay.ts` - Explicit gateway routing, fallback removal, cached list behavior, subscribe authorization order.
- `apps/relay/test/relay.test.ts` - Phase 14 isolation tests and updated existing expectations.

## Decisions Made

- A missing `gatewayId` is different from a disconnected known Gateway:
  - missing frame value returns `gateway_required`
  - known but unavailable Gateway still flows through `forwardToGateway` and returns `gateway_unavailable`
- Session list visibility is not the same as command routing. Clients may see all sessions within their account/user scope without being implicitly bound to one Gateway.

## Deviations from Plan

- `broadcastSessionList()` also had an implicit binding path through `ensureClientGatewayId(client.clientId)`. This was removed because it had the same fallback effect as `broadcastGatewayStatus`.
- `client.list` changed from Gateway forwarding to cached Relay listing. Keeping Gateway forwarding would require selecting a Gateway implicitly, which conflicts with the phase goal.

**Total deviations:** 2 auto-fixed.
**Impact on plan:** Both deviations reinforce the explicit Gateway selection contract.

## Issues Encountered

- `pnpm --filter @tether/relay typecheck` passed.
- `pnpm --filter @tether/relay test` currently passes 33/35 tests.
- The 2 remaining failures are pre-existing HTTP RPC proxy expectations in `relay.test.ts`; current `apps/relay/src/relay.ts` HTTP server only handles `/healthz`, so `/api/sessions...` requests return 404 or never emit `gateway.http.request`. This is outside Plan 05's explicit Gateway routing scope and should be handled by a separate relay HTTP proxy plan/fix.

## User Setup Required

None.

## Next Phase Readiness

Plan 06 can build the full Gateway selector UI on top of the strict Relay contract:

- new chat, providers, and cwd requests must carry `gatewayId`
- Relay will not silently choose a Gateway
- missing or unauthorized Gateway selection returns explicit user-facing error codes

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
