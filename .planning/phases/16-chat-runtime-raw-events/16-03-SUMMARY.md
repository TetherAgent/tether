---
phase: 16-chat-runtime-raw-events
plan: 03
subsystem: server
tags: [egg, mysql, runtime-sync, chat-events]
requires:
  - phase: 16-01
    provides: chat runtime event schema
provides:
  - chat runtime event write path
  - relay chat delta catch-up read API
  - messages API lastEventId metadata
affects: [server, relay, web]
tech-stack:
  added: []
  patterns: [runtimeSyncSecret protected internal read API]
key-files:
  created:
    - apps/server/app/controller/chat-events.ts
    - apps/server/app/service/chatEventsRepository.ts
  modified:
    - apps/server/app/service/runtimeSyncRepository.ts
    - apps/server/app/controller/runtime-sync.ts
    - apps/server/app/router.ts
    - apps/server/config/config.default.ts
    - apps/server/app/controller/chat.ts
    - apps/server/app/service/chatRepository.ts
    - apps/server/typings/app/controller/index.d.ts
    - apps/server/typings/app/service/index.d.ts
key-decisions:
  - "runtime-sync dispatches chat transport events into a separate repository path."
patterns-established:
  - "Chat catch-up reads only agent.delta rows from gateway_runtime_chats_events."
requirements-completed: []
duration: 14 min
completed: 2026-05-11
---

# Phase 16 Plan 03: Server Chat Runtime Paths Summary

**Egg Server write/read paths for chat raw events, delta catch-up, and message cursor metadata**

## Performance

- **Duration:** 14 min
- **Started:** 2026-05-11T14:43:05Z
- **Completed:** 2026-05-11T14:57:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added `upsertChatRuntimeEvent` to write full masked raw event JSON into `gateway_runtime_chats_events`.
- Added `raw_json` update for `user.message` and `agent.result` chat message rows.
- Added `/api/relay/chat-events/:sessionId?after=N` protected by runtime sync secret.
- Added `lastEventId` to chat messages API responses.
- Regenerated tracked Egg controller/service typings for the new controller and service.

## Task Commits

1. **Task 1: runtimeSyncRepository 新增 upsertChatRuntimeEvent + RuntimeSyncScope 扩展** - `4de9830` (`feat(16-03)`)
2. **Task 2: runtime-sync controller 分支 + chatEventsRepository + chat-events controller + 路由 + messages API lastEventId** - `4de9830` (`feat(16-03)`)

## Files Created/Modified

- `apps/server/app/service/runtimeSyncRepository.ts` - Adds chat transport raw event write path.
- `apps/server/app/controller/runtime-sync.ts` - Dispatches `transport === 'chat'` to the new path.
- `apps/server/app/service/chatEventsRepository.ts` - Lists delta events after a cursor.
- `apps/server/app/controller/chat-events.ts` - Exposes the internal catch-up read controller.
- `apps/server/app/router.ts` - Registers `/api/relay/chat-events/:sessionId`.
- `apps/server/config/config.default.ts` - Adds the route to `verifyLoginWhitelist`.
- `apps/server/app/service/chatRepository.ts` - Returns message rows plus `lastEventId`.
- `apps/server/app/controller/chat.ts` - Returns `{ messages, lastEventId }`.

## Decisions Made

Followed the plan-specified separation: terminal/runtime events still use `upsertRuntimeEvent`; chat events use `upsertChatRuntimeEvent`.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

The first server test run failed because previous `tsc` output left `.js` files beside `.ts` sources, causing Egg to load duplicates. Running `pnpm --filter @tether/server clean` removed those generated files; the second test run passed.

## Verification

- `pnpm --filter @tether/server typecheck` -> passed
- `pnpm --filter @tether/server test` -> passed after clean; 22 tests passing

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Relay can now POST chat runtime events with `transport: 'chat'` and GET delta catch-up rows by cursor.

## Self-Check: PASSED

---
*Phase: 16-chat-runtime-raw-events*
*Completed: 2026-05-11*
