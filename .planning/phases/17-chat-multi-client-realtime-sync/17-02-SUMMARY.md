---
phase: 17-chat-multi-client-realtime-sync
plan: 02
subsystem: gateway
tags: [gateway, relay-client, chat, concurrency, runner]
requires:
  - phase: 17-chat-multi-client-realtime-sync
    provides: Relay-side multi-subscriber routing
provides:
  - Gateway chat session in-flight lock
  - runner.run reject cleanup path
  - removal of chatClientBindings routing state
affects: [chat-runtime, gateway-runner, multi-client-sync]
tech-stack:
  added: []
  patterns: [Set based in-flight lock, release on result error and runner reject]
key-files:
  created:
    - .planning/phases/17-chat-multi-client-realtime-sync/17-02-SUMMARY.md
  modified:
    - apps/gateway/src/relay-client.ts
key-decisions:
  - "Existing chat session sends are rejected with chat_in_progress while a run is active."
  - "The lock is acquired only after session metadata and provider checks pass."
patterns-established:
  - "chatInFlight guards existing-session runner starts and releases on result, error, and runner.run rejection."
requirements-completed: [D-05, D-06, D-08, D-09, D-10, D-11]
duration: 15min
completed: 2026-05-12
---

# Phase 17-02: Gateway Chat In-Flight Lock Summary

**Gateway now rejects concurrent sends to the same chat session and no longer uses chatClientBindings to route realtime chat events**

## Performance

- **Duration:** 15 min
- **Started:** 2026-05-12T00:20:00Z
- **Completed:** 2026-05-12T00:35:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Removed all `chatClientBindings` references from `relay-client.ts`.
- Added `chatInFlight` and rejected a second existing-session `client.chat` with `chat_in_progress`.
- Placed `chatInFlight.add()` after `frame.session` and provider validation, avoiding lock leakage on early validation failures.
- Released the lock on `onResult`, `onError`, and `runner.run(...).catch(...)`.

## Task Commits

1. **Task 1: chatClientBindings removal and in-flight lock** - `420abf6`

## Files Created/Modified

- `apps/gateway/src/relay-client.ts` - Adds session-level chat in-flight locking and removes client binding routing.
- `.planning/phases/17-chat-multi-client-realtime-sync/17-02-SUMMARY.md` - Execution summary.

## Decisions Made

None - followed the reviewed plan and HIGH issue fixes.

## Deviations from Plan

None - plan executed exactly as written.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No scope change.

## Issues Encountered

None.

## Verification

- `grep -c "chatClientBindings" apps/gateway/src/relay-client.ts` -> `0`
- `grep -c "chatInFlight" apps/gateway/src/relay-client.ts` -> `6`
- `grep -c "chat_runner_failed" apps/gateway/src/relay-client.ts` -> `1`
- `grep -c "chat_in_progress" apps/gateway/src/relay-client.ts` -> `1`
- `pnpm --filter @tether/gateway typecheck` -> pass

## Self-Check: PASSED

`chatInFlight.has()` is before `!frame.session`; `chatInFlight.add()` is after metadata and provider checks; runner rejection releases the lock.

## User Setup Required

None.

## Next Phase Readiness

Ready for Phase 17-03 tests covering Relay multi-client broadcast and Gateway in-flight behavior.

---
*Phase: 17-chat-multi-client-realtime-sync*
*Completed: 2026-05-12*
