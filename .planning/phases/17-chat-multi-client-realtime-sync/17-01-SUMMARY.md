---
phase: 17-chat-multi-client-realtime-sync
plan: 01
subsystem: relay
tags: [relay, websocket, chat, multi-client, authz]
requires:
  - phase: 16-chat-runtime-raw-events
    provides: chat raw event sync and catch-up transport
provides:
  - Relay chat session 1:N subscriber routing
  - Per-subscriber account filtering for chat event delivery
  - Permission response access and subscription checks
affects: [chat-runtime, relay-routing, multi-client-sync]
tech-stack:
  added: []
  patterns: [Map sessionId to Set clientId, per-subscriber clientCanAccessSession filtering]
key-files:
  created:
    - .planning/phases/17-chat-multi-client-realtime-sync/17-01-SUMMARY.md
  modified:
    - apps/relay/src/relay.ts
key-decisions:
  - "Chat realtime delivery is now routed by session subscribers, not by stale payload clientId."
  - "client.permission_response requires both account access and active chat subscription before forwarding."
patterns-established:
  - "sendChatEventToSubscribers centralizes chat event broadcast and account filtering."
  - "removeChatSubscriber cleans chat subscriber Sets on close, unsubscribe, and detach."
requirements-completed: [D-01, D-02, D-03, D-04, D-06, D-07]
duration: 20min
completed: 2026-05-12
---

# Phase 17-01: Relay Chat Subscriber Broadcast Summary

**Relay chat events now broadcast to all authorized subscribers of a chat session, with permission responses protected by account and subscription checks**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-12T00:00:00Z
- **Completed:** 2026-05-12T00:20:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Replaced `chatSessionOwners` with `chatSessionSubscribers: Map<string, Set<string>>`.
- Added `sendChatEventToSubscribers()` so `agent.delta`, `agent.result`, `agent.permission_request`, `session.error`, and `agent.tool` all broadcast to every authorized subscriber.
- Added cleanup for subscriber Sets on socket close, `client.unsubscribe`, and `client.detach`.
- Hardened `client.permission_response` with `clientCanAccessSession` and active subscriber checks before forwarding to Gateway.

## Task Commits

1. **Task 1-2: Relay broadcast and permission response authorization** - `f1fc8a9`

## Files Created/Modified

- `apps/relay/src/relay.ts` - Chat routing changed from 1:1 owner to 1:N subscribers, with per-client account checks.
- `.planning/phases/17-chat-multi-client-realtime-sync/17-01-SUMMARY.md` - Execution summary.

## Decisions Made

- Used a small `removeChatSubscriber()` helper for repeated Set cleanup. This follows the review recommendation and keeps close/unsubscribe/detach cleanup consistent.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed as written, with the review-recommended cleanup helper added inside the same planned behavior.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

- Initial patch context did not match around the unsubscribe block, so the edit was split into smaller targeted patches. No code behavior was affected.

## Verification

- `grep -v '^[[:space:]]*//' apps/relay/src/relay.ts | grep -c "chatSessionOwners"` -> `0`
- `grep -c "chatSessionSubscribers" apps/relay/src/relay.ts` -> `10`
- `grep -c "sendChatEventToSubscribers" apps/relay/src/relay.ts` -> `6`
- `grep -A 30 "case 'client.permission_response'" apps/relay/src/relay.ts | grep -c "clientCanAccessSession"` -> `2`
- `grep -A 30 "case 'client.permission_response'" apps/relay/src/relay.ts | grep -c "chatSessionSubscribers"` -> `1`
- `pnpm --filter @tether/relay typecheck` -> pass

## Self-Check: PASSED

All required Relay routing, cleanup, and permission response checks are present and typecheck passes.

## User Setup Required

None.

## Next Phase Readiness

Gateway-side in-flight locking is ready to pair with Relay-side multi-subscriber broadcast.

---
*Phase: 17-chat-multi-client-realtime-sync*
*Completed: 2026-05-12*
