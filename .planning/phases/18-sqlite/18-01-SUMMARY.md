---
phase: 18-sqlite
plan: 01
subsystem: gateway
tags: [gateway, sqlite, pty, relay, session-runner]
requires:
  - phase: 11-chat
    provides: chat-side timestamp event id pattern reused for PTY events
provides:
  - shared gateway session event factory with timestamp-based ids
  - PTY/session-runner event publishing without SQLite writes
  - daemon and relay session lookup paths that read PTY metadata from memory
affects: [18-02, 18-03, gateway-relay-runtime]
tech-stack:
  added: []
  patterns: [shared createSessionEvent, runner frame carries full event payload, memory-first PTY session lookup]
key-files:
  created: [apps/gateway/src/events.ts]
  modified:
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/pty.ts
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/session-runner.ts
    - apps/gateway/src/session-runner-process.ts
    - apps/gateway/src/session-runner-spawn.ts
    - apps/gateway/src/session-status-deriver.ts
    - apps/gateway/test/daemon.test.ts
    - apps/gateway/test/pty.test.ts
    - apps/gateway/test/relay-client.test.ts
    - apps/gateway/test/session-runner.test.ts
    - apps/gateway/test/session-status-deriver.test.ts
key-decisions:
  - "Shared PTY events now come from apps/gateway/src/events.ts so pty, relay-client, and session-runner share one timestamp-based id generator."
  - "SessionRunner event frames now include the full SessionEvent payload because SQLite-backed event lookups are no longer available on live runner paths."
  - "Daemon session lookup now prefers PtySessionManager memory state and falls back to Store only for non-PTY-backed sessions."
patterns-established:
  - "Use createSessionEvent(...) instead of store.appendEvent(...) for live PTY/session-runner events."
  - "When removing persistence from a live event path, propagate full event payloads over internal sockets instead of ids that require DB lookups."
requirements-completed: [SQLITE-01]
duration: 22min
completed: 2026-05-12
---

# Phase 18 Plan 01: Gateway PTY live events without SQLite writes Summary

**Shared PTY event ids, in-memory PTY session metadata, and runner/relay live event delivery now work without local SQLite writes.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-05-12T15:22:39+08:00
- **Completed:** 2026-05-12T07:44:26Z
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- Added `apps/gateway/src/events.ts` and moved PTY/session-runner live event creation onto the shared timestamp-based id pattern.
- Removed SQLite write paths from `pty.ts`, `session-runner.ts`, and `session-status-deriver.ts`.
- Updated relay and daemon runtime paths to consume in-memory PTY metadata and full runner event payloads, then refreshed affected gateway tests.

## Task Commits

1. **Task 1: 新建 events.ts 公共模块（D-02），提供 createSessionEvent** - `e3d45df` (feat)
2. **Task 2 RED: 修改 pty.ts 前先补失败测试** - `1b9b2ff` (test)
3. **Task 2 GREEN: 修改 pty.ts，替换 store 调用** - `7e40eb2` (feat)
4. **Task 3: 修改 runner / relay-client / status deriver / spawn paths** - `7e585db` (feat)
5. **Task 3 auto-fix: 修复 daemon 对 PTY 内存 session 的读取路径** - `d030daf` (fix)

## Files Created/Modified

- `apps/gateway/src/events.ts` - shared `createSessionEvent` factory
- `apps/gateway/src/pty.ts` - removed PTY store writes and exposed in-memory session helpers
- `apps/gateway/src/session-runner.ts` - removed runner store writes and published full live events
- `apps/gateway/src/session-status-deriver.ts` - switched to injected append callback
- `apps/gateway/src/relay-client.ts` - replaced PTY store writes with memory updates and shared events
- `apps/gateway/src/session-runner-process.ts` - removed `Store` construction from detached runner entry
- `apps/gateway/src/session-runner-spawn.ts` - removed `dbPath/store` serialization and returned runner metadata from ping
- `apps/gateway/src/daemon.ts` - resolved PTY sessions through `PtySessionManager` memory state
- `apps/gateway/test/*.test.ts` - updated PTY/runner/relay/daemon tests for non-persistent live events

## Decisions Made

- Used a gateway-local `events.ts` helper instead of duplicating PTY event id logic in each runtime file.
- Kept runner `ping` returning session metadata so the parent process can recover detached runner session state without Store.
- Preserved Store for replay/history paths in plan 01, but stopped using it as the source of truth for live PTY session lookup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Runner live events could no longer be dereferenced after SQLite writes were removed**
- **Found during:** Task 3
- **Issue:** `SessionRunner` only sent `eventId`; relay/daemon then loaded event bodies from Store, which breaks once runner events stop writing to SQLite.
- **Fix:** Added full `event` payloads to runner socket frames and updated relay/daemon consumers plus tests.
- **Files modified:** `apps/gateway/src/session-runner.ts`, `apps/gateway/src/relay-client.ts`, `apps/gateway/src/daemon.ts`, `apps/gateway/test/session-runner.test.ts`, `apps/gateway/test/relay-client.test.ts`
- **Verification:** `pnpm --filter @tether/gateway typecheck`, `pnpm --filter @tether/gateway test`
- **Committed in:** `7e585db`

**2. [Rule 3 - Blocking] Daemon HTTP/WS routes lost PTY sessions after PtySessionManager stopped mirroring Store**
- **Found during:** Final validation
- **Issue:** Daemon endpoints and WS ticket checks still read `options.store.getSession/listSessions`, so direct PTY sessions disappeared from list/read/resize/stop flows.
- **Fix:** Added daemon helpers that prefer `PtySessionManager` memory state and fall back to Store, then updated daemon tests to assert runtime behavior instead of SQLite event persistence.
- **Files modified:** `apps/gateway/src/daemon.ts`, `apps/gateway/test/daemon.test.ts`
- **Verification:** `pnpm --filter @tether/gateway typecheck`, `pnpm --filter @tether/gateway test`
- **Committed in:** `d030daf`

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were required to keep live PTY/runner paths functional after removing SQLite-backed writes. No out-of-scope feature work was added.

## Issues Encountered

- The first full gateway test run exposed daemon routes that still depended on Store-backed PTY lookup; fixing that completed the intended plan 01 behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `PtySessionManager` now exposes the in-memory lookup/update surface required for phase 18 plan 02.
- Relay and daemon can already consume live runner events without Store-backed event lookups.

## Self-Check: PASSED

---
*Phase: 18-sqlite*
*Completed: 2026-05-12*
