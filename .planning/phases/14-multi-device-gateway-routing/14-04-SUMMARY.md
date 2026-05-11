---
phase: 14-multi-device-gateway-routing
plan: 04
subsystem: protocol-web
tags: [relay-protocol, react, chat, gateway-routing]
requires:
  - phase: 14-multi-device-gateway-routing
    provides: Gateway list and device-key auth groundwork
provides:
  - GatewayId-bearing client frames for new chat/provider/cwd routing
  - Web handling for gateway_required and gateway_unauthorized errors
affects: [packages-protocol, apps-web, apps-relay, apps-gateway]
tech-stack:
  added: []
  patterns: [selected gateway state, frame-level gateway routing]
key-files:
  created: []
  modified:
    - packages/protocol/src/index.ts
    - apps/web/src/components/chats/chat-panel.tsx
key-decisions:
  - "New chat creation requires gatewayId on the frame; existing chat continuation remains sessionId/metadata routed and does not add gatewayId."
patterns-established:
  - "Provider list and cwd suggestion requests are gateway-scoped client frames."
requirements-completed: [GATEWAY-MULTI-04]
duration: 15min
completed: 2026-05-11
---

# Phase 14 Plan 04: Protocol And Web Frame Summary

**New chat, provider-list, and cwd-suggestion frames now carry a selected Gateway id while existing chat continuations keep Phase 15 metadata routing.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-11T06:31:00Z
- **Completed:** 2026-05-11T06:46:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `gatewayId: string` to `client.chat` new-session, `client.cwd-suggest`, and `client.list-providers` client frames.
- Kept `client.chat` continuation frames unchanged: `{ sessionId: string, message, model? }`.
- Added `selectedGatewayId` and `showGatewaySelector` state in `chat-panel`.
- Moved provider-list request to `gateway.status connected`, so it sends the connected `gatewayId`.
- Added Web handling for `gateway_required` and `gateway_unauthorized`.

## Task Commits

1. **Tasks 1-2: protocol frame types and Web chat-panel gatewayId injection** - `49e080f` (feat)

## Files Created/Modified

- `packages/protocol/src/index.ts` - Gateway-scoped client frame types.
- `apps/web/src/components/chats/chat-panel.tsx` - Selected Gateway state, frame injection, and error handling.

## Decisions Made

- `client.auth.ok` no longer sends `client.list-providers`; it waits for `gateway.status connected` to avoid sending a frame without a Gateway id.
- Temporary Gateway selection state uses the connected Relay Gateway until Plan 06 adds the full selector.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- `pnpm --filter @tether/protocol typecheck` passed.
- `pnpm --filter @tether/relay typecheck` passed.
- `pnpm --filter @tether/gateway typecheck` passed.
- `pnpm --filter @tether/web typecheck` passed.
- `pnpm --filter @tether/web build` passed with the existing Vite chunk-size warning.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05 can remove Relay fallback routing because Web now sends a `gatewayId` for new-session chat, provider listing, and cwd suggestions.

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
