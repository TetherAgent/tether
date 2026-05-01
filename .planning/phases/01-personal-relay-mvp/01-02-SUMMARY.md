---
phase: 01-personal-relay-mvp
plan: 02
subsystem: relay
tags: [node, typescript, websocket, ws, relay]
requires:
  - phase: 01-personal-relay-mvp
    provides: Relay protocol frame types from @tether/protocol
provides:
  - Independent @tether/relay Node service
  - Authenticated /gateway and /client WebSocket relay endpoints
  - /healthz endpoint without static web serving
  - In-memory relay forwarding tests
affects: [relay, gateway-relay-client, web-relay-mode]
tech-stack:
  added: [ws]
  patterns:
    - Node http.createServer plus ws.WebSocketServer
    - shared-secret first-frame authentication
    - in-memory session and subscription routing
key-files:
  created:
    - apps/relay/package.json
    - apps/relay/tsconfig.json
    - apps/relay/src/main.ts
    - apps/relay/src/relay.ts
    - apps/relay/src/relay.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
key-decisions:
  - "Relay exposes only /healthz, /gateway, and /client; it does not serve apps/web static assets."
  - "Relay closes unauthenticated, unknown, and command-shaped frames with WebSocket code 1008."
  - "Relay keeps only in-memory gateway/client/session/subscription state and does not persist terminal plaintext."
patterns-established:
  - "Relay auth: gateway/client must send auth frame with TETHER_RELAY_SECRET before any other frame."
  - "Relay safety filter: recursively reject payloads containing command, args, argv, env, or providerCommand keys."
requirements-completed: [RELAY-01]
duration: 4m16s
completed: 2026-05-01
---

# Phase 1 Plan 02: Relay Service Runtime Summary

**Standalone shared-secret WebSocket relay for authenticated Gateway and client frame forwarding without static web serving or plaintext persistence.**

## Performance

- **Duration:** 4m16s
- **Started:** 2026-05-01T13:41:42Z
- **Completed:** 2026-05-01T13:45:58Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Created `@tether/relay` workspace app with dev, test, and typecheck scripts.
- Implemented `/healthz`, `/gateway`, and `/client` only; no `apps/web` static serving.
- Added shared-secret authentication and in-memory routing between one Gateway and multiple clients.
- Rejected unknown frames and any frame containing `command`, `args`, `argv`, `env`, or `providerCommand`.
- Added real WebSocket integration tests for auth rejection, session list forwarding, input/resize forwarding, and command-shaped rejection.

## Task Commits

| Task | Name | Commit | Notes |
| ---- | ---- | ------ | ----- |
| 01-02-T01 | Scaffold relay workspace app | `0ab78b8` | Added package, tsconfig, and root `relay` script. |
| 01-02-T02 | Implement authenticated relay server | `bb18da4` | Added relay runtime, CLI entrypoint, and lockfile importer update. |
| 01-02-T03 | Add relay service integration tests | `c2cabfe` | Added four `node:test` WebSocket integration tests. |

## Files Created/Modified

- `apps/relay/package.json` - Defines `@tether/relay` scripts and dependencies.
- `apps/relay/tsconfig.json` - Extends the repo TypeScript base config.
- `apps/relay/src/main.ts` - Reads `TETHER_RELAY_SECRET`, host, and port env vars and starts the relay.
- `apps/relay/src/relay.ts` - Implements authenticated in-memory relay routing.
- `apps/relay/src/relay.test.ts` - Covers relay WebSocket behavior with real clients.
- `package.json` - Adds root `pnpm relay` script.
- `pnpm-lock.yaml` - Adds the relay workspace importer after installing/linking workspace dependencies.

## Verification Results

| Command | Result |
| ------- | ------ |
| `pnpm --filter @tether/relay test` | Passed: 4 tests, 0 failures. |
| `pnpm --filter @tether/relay typecheck` | Passed. |
| `pnpm typecheck` | Passed across workspace projects. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Linked the new relay workspace package**
- **Found during:** Task 2 (Implement authenticated relay server)
- **Issue:** `pnpm --filter @tether/relay typecheck` could not resolve `ws` or `@tether/protocol` before workspace dependencies were installed/linked.
- **Fix:** Ran `pnpm install`, which added the `apps/relay` importer to `pnpm-lock.yaml`.
- **Files modified:** `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @tether/relay typecheck` passed.
- **Committed in:** `bb18da4`

**Total deviations:** 1 auto-fixed blocking issue.
**Impact on plan:** Required for the new workspace app to typecheck and run through pnpm; no scope expansion.

## Known Stubs

None.

## Threat Flags

None. New network surfaces were the planned `/healthz`, `/gateway`, and `/client` relay endpoints covered by the plan threat model.

## Issues Encountered

- `.planning/config.json` was modified in the working tree outside this plan scope and was left uncommitted.

## User Setup Required

- Set `TETHER_RELAY_SECRET` before running the relay.
- Optional: set `TETHER_RELAY_HOST` and `TETHER_RELAY_PORT`; defaults are `127.0.0.1` and `4889`.

## Next Phase Readiness

- Relay runtime is ready for Gateway outbound relay-client integration and Web relay mode.
- Protocol types are consumed from `@tether/protocol`, so follow-on tasks can share the same frame contract.

## Self-Check: PASSED

- Confirmed all created/modified files listed in this summary exist.
- Confirmed task commits `0ab78b8`, `bb18da4`, and `c2cabfe` exist in git history.
- Confirmed plan verification commands passed.

---
*Phase: 01-personal-relay-mvp*
*Completed: 2026-05-01*
