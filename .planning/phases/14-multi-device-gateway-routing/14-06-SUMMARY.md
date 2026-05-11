---
phase: 14-multi-device-gateway-routing
plan: 06
subsystem: web
tags: [gateway-selector, chat-panel, i18n]
requires:
  - phase: 14-multi-device-gateway-routing
    plan: 05
    provides: Strict Relay gatewayId routing
provides:
  - Gateway selector UI in chat panel
  - Online/offline Gateway state driven by Relay status frames
  - Input disable states for no Gateway selection and offline Gateway
affects: [apps-web]
tech-stack:
  added: []
  patterns: [gateway list fetch, relay status overlay, explicit selected gateway]
key-files:
  created:
    - apps/web/src/components/chats/gateway-selector.tsx
  modified:
    - apps/web/src/components/chats/chat-panel.tsx
    - apps/web/src/i18n/messages.ts
key-decisions:
  - "GatewaySelector loads persisted Gateways from GET /api/server/gateways and filters revoked records."
  - "Relay gateway.status frames maintain onlineGatewayIds; selected Gateway remains selected when it disconnects so the UI can show offline state."
requirements-completed: [GATEWAY-MULTI-06]
duration: 30min
completed: 2026-05-11
human_verify: pending
---

# Phase 14 Plan 06: Gateway Selector UI Summary

The chat surface now exposes the selected Gateway and blocks new input when no Gateway is selected or the selected Gateway is offline.

## Performance

- **Duration:** 30 min
- **Started:** 2026-05-11T07:33:00Z
- **Completed:** 2026-05-11T08:03:00Z
- **Tasks:** 2
- **Files modified:** 3
- **Files created:** 1

## Accomplishments

- Added `apps/web/src/components/chats/gateway-selector.tsx`.
- GatewaySelector fetches `GET /api/server/gateways` with `gatewayAuthHeaders()` and reads `{ code, data }` responses through `readGatewayData`.
- Revoked Gateways are filtered out of the selector.
- Gateway display name priority is `name`, then `hostname`, then the first 8 chars of `gatewayId`.
- Single Gateway renders as a compact status chip; multiple Gateways render a dropdown with status dots.
- `chat-panel.tsx` now maintains `onlineGatewayIds` from Relay `gateway.status` frames.
- `selectedGatewayId` is no longer cleared on Gateway disconnect, so the UI can show the selected Gateway as offline.
- Input is disabled when there is no effective Gateway or the effective Gateway is offline.
- Newly created sessions record the selected Gateway id as `activeSessionGatewayId`.

## I18n Keys Added

All keys were added as flat entries in both `WEB_MESSAGES.zh` and `WEB_MESSAGES.en`:

- `gatewaySelectorOffline`
- `gatewaySelectorSelect`
- `gatewaySelectorEmpty`
- `gatewaySelectorNoSelection`

## Task Commits

1. **Tasks 1-2: Gateway selector component and chat-panel integration** - `8b66f42` (feat)

## Files Created/Modified

- `apps/web/src/components/chats/gateway-selector.tsx` - Gateway list loading, status dots, single/multi Gateway rendering, dropdown selection.
- `apps/web/src/components/chats/chat-panel.tsx` - Online Gateway state, selector placement, selected/offline input blocking.
- `apps/web/src/i18n/messages.ts` - Flat zh/en Gateway selector copy.

## Decisions Made

- The selector uses Relay real-time status as the source for online state.
- Session continuation uses the active session Gateway id for input availability; new sessions use `selectedGatewayId`.
- No local machine auto-detection was added; D-17 remains deferred.

## Deviations from Plan

- New session and existing session input blocking both use an `effectiveGatewayId`, so existing sessions also show offline/no-selection disabled states when their Gateway is not online.

**Total deviations:** 1 auto-fixed.
**Impact on plan:** This broadens D-16 to existing chat sessions, which matches the user-visible safety expectation.

## Verification

- `pnpm --filter @tether/web typecheck` passed.
- `pnpm --filter @tether/web build` passed.
- Build still emits the existing Vite chunk-size warning for the large app bundle.

## Human Verify

Pending. Manual checks still needed:

1. `tether gateway login` creates `~/.tether/device.json` with `deviceKey` and writes simplified `~/.tether/auth.json`.
2. `/chats` shows the Gateway selector with online/offline status.
3. New `client.chat` WebSocket frame includes `gatewayId`.
4. Existing session continuation frame does not include `gatewayId`.
5. Multiple Gateways can be selected from the dropdown.
6. Offline or missing Gateway disables input with the expected prompt.

## User Setup Required

Manual UAT requires at least one logged-in Gateway. Multiple-Gateway switching requires a second device or a second Gateway identity.

## Next Phase Readiness

After human verification is approved, Phase 14 can run final verification and closeout.

---
*Phase: 14-multi-device-gateway-routing*
*Completed: 2026-05-11*
