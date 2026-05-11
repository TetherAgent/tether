---
phase: 16-chat-runtime-raw-events
plan: 02
subsystem: gateway
tags: [protocol, chat, delta-events]
requires: []
provides:
  - agent.delta eventId protocol field
  - gateway.chat-catchup lastEventId protocol field
  - Gateway per-session delta id counter
affects: [gateway, relay, web, protocol]
tech-stack:
  added: []
  patterns: [per-session chat delta cursor]
key-files:
  created: []
  modified:
    - packages/protocol/src/index.ts
    - apps/gateway/src/chat-session-runner.ts
    - apps/gateway/src/relay-client.ts
key-decisions:
  - "Delta ids are generated in Gateway per active chat subprocess and start at 1."
patterns-established:
  - "agent.result payload carries lastDeltaEventId so clients can initialize catch-up cursors from history."
requirements-completed: []
duration: 8 min
completed: 2026-05-11
---

# Phase 16 Plan 02: Gateway Delta Event IDs Summary

**Protocol and Gateway runner support for durable chat delta cursors**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-11T14:35:00Z
- **Completed:** 2026-05-11T14:43:05Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added optional `eventId` to `agent.delta` frames.
- Added optional `lastEventId` to `gateway.chat-catchup` frames.
- Added a per-session `nextDeltaId` counter in `ChatSessionRunner`.
- Changed Relay client chat delta forwarding to use the generated id instead of `0`.
- Added `lastDeltaEventId` to `agent.result` raw payload.

## Task Commits

1. **Task 1: 更新 Protocol 类型定义** - `bf01363` (`feat(16-02)`)
2. **Task 2: Gateway ChatSessionRunner 添加 delta 计数器和 lastDeltaEventId** - `bf01363` (`feat(16-02)`)

## Files Created/Modified

- `packages/protocol/src/index.ts` - Adds the new optional cursor fields.
- `apps/gateway/src/chat-session-runner.ts` - Tracks delta ids and records final `lastDeltaEventId`.
- `apps/gateway/src/relay-client.ts` - Sends `agent.delta` events with the generated delta id.

## Decisions Made

Followed the plan-specified `ActiveSubprocess.nextDeltaId` design so the counter is naturally cleaned up with the active chat process.

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## Verification

- `grep -c "eventId?: number" packages/protocol/src/index.ts` -> `1`
- `grep -c "nextDeltaId" apps/gateway/src/chat-session-runner.ts` -> `4`
- `pnpm --filter @tether/protocol typecheck` -> passed
- `pnpm --filter @tether/gateway typecheck` -> passed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Relay and Web can now consume stable chat delta ids for raw event sync and reconnect catch-up.

## Self-Check: PASSED

---
*Phase: 16-chat-runtime-raw-events*
*Completed: 2026-05-11*
