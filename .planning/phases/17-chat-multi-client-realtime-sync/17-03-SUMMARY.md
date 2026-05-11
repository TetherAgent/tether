---
phase: 17-chat-multi-client-realtime-sync
plan: 03
subsystem: tests
tags: [relay, gateway, tests, chat, multi-client, concurrency]
requires:
  - phase: 17-chat-multi-client-realtime-sync
    plans: [17-01, 17-02]
provides:
  - Relay multi-client chat broadcast tests
  - Relay cross-account isolation and permission_response write-path tests
  - Gateway chat in-flight lock tests
  - runner.run reject lock-release coverage
affects: [relay-tests, gateway-tests, chat-runtime]
tech-stack:
  added: []
  patterns: [metadata-backed relay harness, CodexChatRunner.run monkey patch for deterministic relay-client tests]
key-files:
  created:
    - .planning/phases/17-chat-multi-client-realtime-sync/17-03-SUMMARY.md
  modified:
    - apps/relay/test/relay.test.ts
    - apps/gateway/test/relay-client.test.ts
    - apps/relay/src/relay.ts
key-decisions:
  - "Phase 17 relay tests use metadata hydration rather than direct private state injection."
  - "Gateway tests monkey-patch CodexChatRunner.prototype.run to avoid spawning real provider processes."
patterns-established:
  - "Phase17-T1~T7 cover broadcast, account isolation, cleanup, and permission_response isolation."
  - "Phase17-GW-T1~T5 cover in-flight rejection and all current lock-release paths."
requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-07, D-08, D-09, D-10, D-11]
duration: 35min
completed: 2026-05-12
---

# Phase 17-03: Chat Multi-client Realtime Tests Summary

**Phase 17 now has relay and gateway regression coverage for chat multi-client realtime sync and session-level in-flight locking**

## Performance

- **Duration:** 35 min
- **Started:** 2026-05-12T00:35:00Z
- **Completed:** 2026-05-12T01:10:00Z
- **Tasks:** 2 planned, 1 small regression fix discovered during tests
- **Files modified:** 3

## Accomplishments

- Added Relay Phase17-T1~T7 tests:
  - same-account `agent.delta` broadcast to two chat subscribers
  - cross-account delta non-leak
  - `agent.result` broadcast
  - `agent.permission_request` broadcast
  - disconnected chat subscriber cleanup
  - unsubscribed chat subscriber cleanup
  - cross-account `client.permission_response` rejection
- Added Gateway Phase17-GW-T1~T5 tests:
  - concurrent same-session chat rejected with `chat_in_progress`
  - lock released after `agent.result`
  - lock released after `session.error`
  - lock released after `runner.run` rejection
  - missing trusted session metadata does not leak a lock
- Preserved non-chat unsubscribe forwarding after chat subscriber cleanup changed. This keeps existing PTY subscription cleanup behavior intact.

## Task Commits

Pending at summary creation time; commit will include this summary and tests.

## Files Created/Modified

- `apps/relay/test/relay.test.ts` - Adds Phase17 relay harness and T1~T7 coverage.
- `apps/gateway/test/relay-client.test.ts` - Adds Phase17 gateway relay-client lock tests.
- `apps/relay/src/relay.ts` - Adjusts `client.unsubscribe` so non-chat subscriptions still forward cleanup to Gateway after removing chat subscriber state.
- `.planning/phases/17-chat-multi-client-realtime-sync/17-03-SUMMARY.md` - Execution summary.

## Decisions Made

- Kept relay tests on the public WebSocket + metadata-sync path, so tests verify the same hydration path real clients use.
- Added GW-T5 beyond the original four gateway tests because the reviewed plan called out early-return lock leakage risk.
- Changed the permission request fixture from `input.command` to `input.path`; Relay intentionally rejects nested `command` keys as command-shaped frames.

## Deviations from Plan

### Auto-fixed Issues

1. **Existing PTY unsubscribe regression**
   - **Issue:** Replacing chat owner cleanup with chat subscriber cleanup initially risked suppressing non-chat `client.unsubscribe` forwarding.
   - **Fix:** `client.unsubscribe` now always removes local chat subscriber state, then forwards to Gateway when the cached session is absent or not `chat`.
   - **Impact:** Chat unsubscribe remains local-only; PTY unsubscribe still reaches Gateway.

2. **Extra gateway lock-leak test**
   - **Issue:** Original plan listed GW-T1~GW-T4. The review also identified missing-session early-return lock leakage risk.
   - **Fix:** Added Phase17-GW-T5 for missing trusted metadata.
   - **Impact:** Broader coverage, no product scope change.

---

**Total deviations:** 2 auto-fixed.
**Impact on plan:** No feature scope change; tests are stronger than planned.

## Issues Encountered

- One full Relay test run timed out once on the existing `relay unsubscribe removes only current client subscription` test, then passed on rerun. The targeted unsubscribe test and subsequent full Relay suite both passed.
- A first T4 fixture used a nested `command` key and correctly triggered Relay's command-shaped frame rejection. The fixture now uses `path` so the test covers permission request broadcast instead of the security filter.

## Verification

- `cd apps/relay && pnpm exec tsx --test --test-name-pattern "Phase17-T4" test/*.test.ts` -> pass
- `cd apps/relay && pnpm exec tsx --test --test-name-pattern "relay unsubscribe removes only current client subscription" test/*.test.ts` -> pass
- `pnpm --filter @tether/relay test` -> pass, 47/47
- `pnpm --filter @tether/relay typecheck` -> pass
- `pnpm --filter @tether/gateway test` -> pass, 76/76
- `pnpm --filter @tether/gateway typecheck` -> pass
- `pnpm --filter @tether/web typecheck` -> pass

## Self-Check: PASSED

Relay broadcast, isolation, cleanup, permission response write-path checks, Gateway in-flight lock rejection, and lock-release paths all have tests and pass.

## User Setup Required

None.

## Next Phase Readiness

Phase 17 code-level verification is complete. Manual UAT should validate two live clients viewing the same chat session, second-device send rejection while a reply is streaming, and next-turn send after completion.

---
*Phase: 17-chat-multi-client-realtime-sync*
*Completed: 2026-05-12*
