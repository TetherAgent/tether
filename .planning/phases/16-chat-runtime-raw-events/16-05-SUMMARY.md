---
phase: 16-chat-runtime-raw-events
plan: 05
subsystem: web
tags: [react, chat, catch-up]
requires:
  - phase: 16-03
    provides: messages API lastEventId
  - phase: 16-04
    provides: gateway.chat-catchup lastEventId
provides:
  - Web chat delta cursor
  - client.subscribe after cursor
affects: [web, relay]
tech-stack:
  added: []
  patterns: [client-side delta cursor dedupe]
key-files:
  created: []
  modified:
    - apps/web/src/components/chats/chat-data.ts
    - apps/web/src/components/chats/chat-panel.tsx
key-decisions:
  - "Web initializes the chat delta cursor from messages API lastEventId."
patterns-established:
  - "Realtime agent.delta frames older than the current cursor are dropped."
requirements-completed: []
duration: 8 min
completed: 2026-05-11
---

# Phase 16 Plan 05: Web Chat Catch-Up Cursor Summary

**React chat client cursor tracking for reconnect catch-up and duplicate delta suppression**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-11T14:57:00Z
- **Completed:** 2026-05-11T15:05:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Changed `fetchChatMessages` to return `{ messages, lastEventId }`.
- Added `lastDeltaEventIdRef` to the chat panel.
- Initializes the cursor from history load.
- Sends `after` during `client.subscribe`.
- Updates/deduplicates cursor on `agent.delta` and `gateway.chat-catchup`.

## Task Commits

1. **Task 1: chat-data.ts 扩展 fetchChatMessages 返回结构** - `73af45a` (`feat(16-05)`)
2. **Task 2: chat-panel.tsx lastDeltaEventIdRef + 三写入点 + subscribe after + delta dedup** - `73af45a` (`feat(16-05)`)

## Files Created/Modified

- `apps/web/src/components/chats/chat-data.ts` - Adds `ChatMessagesResponse` with `lastEventId`.
- `apps/web/src/components/chats/chat-panel.tsx` - Maintains and sends the delta cursor.

## Decisions Made

Followed the plan-specified ref-based cursor so reconnect subscription can use the latest known delta id without causing render churn.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## Verification

- `pnpm --filter @tether/web typecheck` -> passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Tests can now assert end-to-end catch-up behavior against the Web/Relay cursor contract.

## Self-Check: PASSED

---
*Phase: 16-chat-runtime-raw-events*
*Completed: 2026-05-11*
