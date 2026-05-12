---
phase: 18-sqlite
plan: 02
subsystem: relay
tags: [relay, gateway, cli, server, protocol, websocket, runtime-sync]
requires:
  - phase: 18-sqlite
    provides: plan 01 removed live PTY SQLite writes and exposed in-memory PTY session lookup helpers
provides:
  - gateway-scoped session restore frames and relay restore fetch on auth
  - client.new-pty-session relay forwarding and gateway runner creation flow
  - CLI PTY creation over relay websocket instead of local gateway POST
affects: [18-03, relay-runtime, gateway-restart-recovery, cli-provider-launch]
tech-stack:
  added: []
  patterns: [gateway-auth restore fetch, restored PTY metadata map, relay PTY creation via client.new-pty-session]
key-files:
  created: []
  modified:
    - packages/protocol/src/index.ts
    - apps/relay/src/relay.ts
    - apps/relay/test/relay.test.ts
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/pty.ts
    - apps/gateway/src/daemon.ts
    - apps/gateway/test/relay-client.test.ts
    - apps/cli/src/main.ts
    - apps/cli/test/main.test.ts
    - apps/server/app/router.ts
    - apps/server/app/controller/runtime-sync.ts
    - apps/server/app/service/runtimeSyncRepository.ts
    - apps/server/config/config.default.ts
    - apps/server/test/runtime-sync.test.ts
key-decisions:
  - "Restored PTY sessions live in a separate restoredSessions map so relay recovery can repopulate metadata without pretending a live local PTY exists."
  - "CLI provider launches authenticate to relay with the bound gateway token so local session creation reuses the authenticated gatewayId route."
  - "client.new-pty-session carries optional title/providerArgs so the relay path preserves existing CLI launch behavior."
patterns-established:
  - "Relay auth success may trigger a follow-up server fetch that replies only to the authenticated gateway socket."
  - "New client→gateway relay routes must ignore frame.gatewayId and route only from client.gatewayId plus clientCanUseGateway scope checks."
requirements-completed: [SQLITE-02]
duration: 9min
completed: 2026-05-12
---

# Phase 18 Plan 02: Relay restore and PTY creation Summary

**Gateway-scoped session restore, relay-routed PTY creation, and CLI provider launch now work through authenticated websocket frames instead of the old local POST path.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-12T15:51:51+08:00
- **Completed:** 2026-05-12T08:00:39Z
- **Tasks:** 4
- **Files modified:** 14

## Accomplishments

- Added `gateway.sessions-restore` and `client.new-pty-session` protocol frames, then wired relay auth to fetch gateway-only restore data from Server.
- Extended Gateway relay runtime with restored PTY metadata storage and relay-driven PTY session creation callbacks into detached runner spawn flow.
- Switched CLI provider launch to relay websocket creation, while preserving title/providerArgs and adding relay/gateway/server/cli regression tests.

## Task Commits

1. **Task 1: 在 protocol/index.ts 中新增 gateway.sessions-restore 和 client.new-pty-session 帧类型** - `c1bf532` (feat)
2. **Task 2: relay.ts 新增 sendSessionsRestoreToGateway + server 新增 gateway-sessions-restore 接口** - `bfc6365` (feat)
3. **Task 3a: pty.ts 分层 Map + relay-client.ts sessions-restore handler / listRelaySessions** - `d7e49b8` (feat)
4. **Task 3b: daemon relay 创建回调 + CLI relay WS 创建 PTY + relay 隔离测试** - `76f39c3` (feat)

## Files Created/Modified

- `packages/protocol/src/index.ts` - added restore and PTY-create relay frame contracts
- `apps/relay/src/relay.ts` - fetches restore payloads, forwards PTY-create frames by bound gateway, and accepts gateway token auth for local CLI relay creation
- `apps/relay/test/relay.test.ts` - added multi-account isolation coverage for `client.new-pty-session`
- `apps/gateway/src/pty.ts` - stores restored PTY metadata separately from live PTY handles
- `apps/gateway/src/relay-client.ts` - restores sessions, filters lost PTY entries, and creates PTY sessions from relay frames
- `apps/gateway/src/daemon.ts` - spawns runner-backed PTY sessions from relay callback
- `apps/gateway/test/relay-client.test.ts` - verifies restore loading and relay PTY creation callback behavior
- `apps/cli/src/main.ts` - creates provider sessions through relay websocket auth + `client.new-pty-session`
- `apps/cli/test/main.test.ts` - locks in relay websocket creation wiring
- `apps/server/app/router.ts` - exposes restore endpoint
- `apps/server/app/controller/runtime-sync.ts` - returns gateway restore payloads
- `apps/server/app/service/runtimeSyncRepository.ts` - lists restorable sessions for one gateway
- `apps/server/config/config.default.ts` - whitelists the new runtime-sync restore path
- `apps/server/test/runtime-sync.test.ts` - covers whitelist and repository behavior for restore path

## Decisions Made

- Used the authenticated gateway token for CLI relay creation instead of inventing a second local auth bootstrap.
- Kept restore payloads gateway-scoped and one-socket-only rather than broadcasting restore state.
- Preserved CLI `title` and `providerArgs` on the new websocket path so provider launches do not regress.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Relay rejected the new PTY create frame because `command` was still treated as a forbidden key**
- **Found during:** Task 3b
- **Issue:** Generic command-shaped frame filtering closed `client.new-pty-session` before routing, so the new relay path never reached the gateway.
- **Fix:** Allowed sanctioned top-level `command` / `title` / `providerArgs` fields specifically for `client.new-pty-session` while keeping the general forbidden-key guard for all other frames.
- **Files modified:** `apps/relay/src/relay.ts`
- **Verification:** `pnpm --filter @tether/relay test`
- **Committed in:** `76f39c3`

**2. [Rule 3 - Blocking] CLI relay creation could not authenticate because relay client auth rejected gateway-scoped tokens**
- **Found during:** Task 3b
- **Issue:** Local CLI only had the bound gateway token available, but relay client auth only accepted `normal_client_access` / `ws_ticket`, so the websocket create path could not log in.
- **Fix:** Allowed `gateway_access` on relay client auth for this gateway-local creation path and bound routing to `client.gatewayId`.
- **Files modified:** `apps/relay/src/relay.ts`, `apps/cli/src/main.ts`, `apps/relay/test/relay.test.ts`
- **Verification:** `pnpm --filter @tether/relay test`, `pnpm --filter @tether-labs/cli typecheck`
- **Committed in:** `76f39c3`

**3. [Rule 2 - Missing Critical] New relay PTY creation initially dropped CLI `title` and `providerArgs`**
- **Found during:** Task 3b
- **Issue:** The planned frame shape only covered provider/cwd/size, which would silently remove existing provider launch arguments and user-visible titles.
- **Fix:** Added optional `title` and `providerArgs` fields to `client.new-pty-session` on both client→relay and relay→gateway hops, then passed them into runner creation.
- **Files modified:** `packages/protocol/src/index.ts`, `apps/relay/src/relay.ts`, `apps/gateway/src/relay-client.ts`, `apps/gateway/src/daemon.ts`, `apps/cli/src/main.ts`
- **Verification:** `pnpm --filter @tether/protocol typecheck`, `pnpm --filter @tether/gateway typecheck`, `pnpm --filter @tether-labs/cli test`
- **Committed in:** `76f39c3`

**4. [Rule 3 - Blocking] Server restore payloads do not persist PID metadata, so forced PID-only validation would have hidden all restored sessions**
- **Found during:** Task 3a
- **Issue:** The plan expected PID liveness checks, but the current runtime-sync schema only stores session metadata/status, not PID values.
- **Fix:** Gateway restore uses PID checks when available, otherwise preserves the server-reported session status and stores it in `restoredSessions`.
- **Files modified:** `apps/gateway/src/relay-client.ts`, `apps/gateway/src/pty.ts`
- **Verification:** `pnpm --filter @tether/gateway test`
- **Committed in:** `d7e49b8`

---

**Total deviations:** 4 auto-fixed (1 missing critical, 3 blocking)
**Impact on plan:** All deviations were required to make the planned relay restore / PTY creation flow actually usable without regressing existing CLI behavior.

## Issues Encountered

- `@tether/server` does not depend on `@tether/protocol`, so the restore repository used a local session shape to keep server typecheck green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Relay, Gateway, Server, and CLI now share the restore/create protocol needed for Phase 18 plan 03 cleanup.
- `client.new-pty-session` now has the isolation test required by CLAUDE.md R4.
- Remaining concern: restore payloads still rely on server-side session status when PID metadata is unavailable; full live runner resurrection still depends on later cleanup/removal work.

## Self-Check: PASSED

---
*Phase: 18-sqlite*
*Completed: 2026-05-12*
