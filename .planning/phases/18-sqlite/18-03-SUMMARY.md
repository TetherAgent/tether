---
phase: 18-sqlite
plan: 03
subsystem: gateway
tags: [gateway, cli, relay, sqlite, types, testing]
requires:
  - phase: 18-sqlite
    provides: plan 02 restored PTY metadata in memory and routed PTY creation through relay websocket frames
provides:
  - complete removal of gateway-local Store/SQLite runtime usage from gateway and CLI
  - shared gateway session/chat types in apps/gateway/src/types.ts
  - gateway/CLI behavior aligned to in-memory PTY state plus gateway HTTP only
affects: [phase-18-closeout, gateway-runtime, cli-runtime, replay-followup]
tech-stack:
  added: []
  patterns: [shared pure type module, in-memory PTY session source of truth, gateway-only CLI control path, deferred replay stub]
key-files:
  created:
    - apps/gateway/src/types.ts
    - apps/gateway/test/helpers/test-session-state.ts
  modified:
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/replay.ts
    - apps/gateway/src/index.ts
    - apps/cli/src/main.ts
    - apps/cli/test/main.test.ts
  deleted:
    - apps/gateway/src/store.ts
    - apps/gateway/test/store.test.ts
key-decisions:
  - "Gateway daemon and CLI now rely on PtySessionManager memory state and gateway HTTP only; no local SQLite fallback remains."
  - "Replay/history remain intentional stubs after Store removal until a later MySQL-backed replay phase."
patterns-established:
  - "Shared gateway runtime types live in types.ts so runtime modules can drop Store imports without creating circular dependencies."
  - "CLI commands that act on sessions must fail clearly on gateway unavailability instead of silently reading stale local state."
requirements-completed: [SQLITE-03]
duration: 16min
completed: 2026-05-12
---

# Phase 18 Plan 03: SQLite removal closeout Summary

**Gateway and CLI now run without local Store/SQLite, with shared session types in `types.ts`, gateway-only control paths, and replay/history deferred as explicit stubs.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-12T08:03:05Z
- **Completed:** 2026-05-12T08:19:26Z
- **Tasks:** 2
- **Files modified:** 23

## Accomplishments

- Moved gateway session/chat type definitions out of `store.ts` into `apps/gateway/src/types.ts` and rewired gateway runtime modules to import from the new pure type file.
- Removed Store from daemon, relay-client, and CLI runtime flows; `tether attach`, SQLite fallbacks, and Store-based session lookup paths are gone.
- Deleted `apps/gateway/src/store.ts` and `apps/gateway/test/store.test.ts`, updated gateway/CLI tests, and passed the required typecheck/test matrix plus D-09 grep acceptance.

## Task Commits

1. **Task 1: 新建 types.ts（含 ChatEvent/ChatEventType 迁移）；清理 replay.ts/chat-session-runner.ts/index.ts/session-runner-spawn.ts；然后清理 daemon.ts 并删除 store.ts 前的所有阻塞依赖** - `d3d261c` (feat)
2. **Task 2: 清理 session-runner-detach-fixture.ts；删除 test/store.test.ts 和 store.ts；清理 relay-client.ts store 字段；清理 CLI；运行 D-09 验收** - `e7917a5` (feat)

## Files Created/Modified

- `apps/gateway/src/types.ts` - new shared home for session/chat types previously trapped in Store.
- `apps/gateway/src/daemon.ts` - removed Store from daemon options and handler flows; uses `PtySessionManager` plus empty replay/history responses.
- `apps/gateway/src/relay-client.ts` - removed Store option and keeps chat metadata in memory.
- `apps/gateway/src/replay.ts` - explicit no-op replay stub.
- `apps/gateway/src/index.ts` - re-exports types from `types.ts` and no longer exports `Store`.
- `apps/cli/src/main.ts` - removes `tether attach`, SQLite diagnostics, `delete-db`, and all Store fallbacks.
- `apps/cli/test/main.test.ts` - locks in the removed SQLite command paths and gateway-only stop behavior.
- `apps/gateway/test/helpers/test-session-state.ts` - in-memory helper for daemon/chat/relay tests without SQLite.
- `apps/gateway/src/store.ts` - deleted.
- `apps/gateway/test/store.test.ts` - deleted.

## Decisions Made

- Used `apps/gateway/src/types.ts` as the sole shared type module instead of moving types into `pty.ts`, avoiding a new dependency hub.
- Kept replay/history endpoints present but empty so Store deletion does not block current runtime while later MySQL-backed replay remains deferred.
- Made CLI session actions depend only on gateway HTTP/runtime truth rather than any local fallback, matching the plan’s trust-boundary cleanup.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `@tether-labs/cli` tests still asserted removed `delete-db` and runner-socket fallback behavior; updated those expectations to the new gateway-only behavior.
- One `@tether/relay` test (`relay unsubscribe removes only current client subscription`) timed out on a full-suite rerun, then passed on immediate rerun without code changes; treated as a transient test flake because relay code was untouched in this plan.

## Known Stubs

- `apps/gateway/src/replay.ts:1` - `replayEvents()` is an intentional no-op stub; event replay is deferred to a later MySQL-backed phase.
- `apps/gateway/src/daemon.ts` - history/snapshot responses return empty data because local persisted replay was removed with Store.
- `apps/gateway/src/relay-client.ts` - replay frames return an empty done response until server-backed replay is implemented.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 18 code path no longer depends on local SQLite in gateway or CLI.
- Remaining follow-up is product-level replay/history restoration on top of Server/MySQL, not local persistence.

## Self-Check: PASSED

- Found summary file: `.planning/phases/18-sqlite/18-03-SUMMARY.md`
- Found task commit `d3d261c`
- Found task commit `e7917a5`

---
*Phase: 18-sqlite*
*Completed: 2026-05-12*
