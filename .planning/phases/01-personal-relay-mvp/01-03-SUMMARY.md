---
phase: 01-personal-relay-mvp
plan: 03
subsystem: relay
tags: [gateway, relay, websocket, pty, cli]

requires:
  - phase: 01-personal-relay-mvp
    provides: Relay protocol types and relay server runtime from Wave 1 and Wave 2
provides:
  - Gateway outbound Relay client for session registration
  - Relay-routed replay/live event forwarding from Gateway store and PTY sessions
  - Relay-routed input/resize forwarding to existing PTY sessions with observe mode blocked
affects: [gateway, cli, relay, protocol]

tech-stack:
  added: ["@tether/protocol dependency in @tether/gateway"]
  patterns: ["optional outbound WebSocket bridge", "relay payload sanitization before forwarding"]

key-files:
  created:
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/relay-client.test.ts
  modified:
    - apps/gateway/package.json
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/index.ts
    - apps/cli/src/main.ts
    - pnpm-lock.yaml

key-decisions:
  - "Relay client starts only when relay URL and secret are provided by CLI flags or TETHER_RELAY_URL/TETHER_RELAY_SECRET."
  - "Relay-routed writes are limited to existing PtySessionManager sessions; no remote provider/command creation path was added."
  - "Relay event payloads remove relay-forbidden keys before forwarding so session.started metadata cannot trip relay command-frame policy."

patterns-established:
  - "Gateway lifecycle owns optional relay client cleanup via RunningDaemon.close()."
  - "Relay tests use a real local relay server, real WebSocket clients, and /bin/cat PTY echo."

requirements-completed: [RELAY-01]

duration: 6m10s
completed: 2026-05-01
---

# Phase 1 Plan 03: Gateway Relay Bridge Summary

**Gateway outbound Relay bridge with session registration, replay/live event forwarding, and observe-safe remote PTY writes**

## Performance

- **Duration:** 6m10s
- **Started:** 2026-05-01T13:48:59Z
- **Completed:** 2026-05-01T13:55:09Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added `startRelayClient` for outbound `/gateway` WebSocket auth, session registration, list, subscribe, replay, live event forwarding, input, resize, detach, and bounded reconnect.
- Wired relay config into `startDaemon` and CLI commands as optional flags/env vars without changing default localhost/LAN behavior.
- Added bridge tests covering registration, replay/live output, control input to `/bin/cat`, and observe-mode input blocking.

## Task Commits

| Task | Name | Commit | Type |
| --- | --- | --- | --- |
| 01-03-T01 | Implement Gateway relay client module | `4eb4ee3` | feat |
| 01-03-T02 | Hook relay client into Gateway lifecycle and CLI configuration | `b7b63f4` | feat |
| 01-03-T03 | Test Gateway relay bridge behavior | `35df98f` | test |

## Files Created/Modified

- `apps/gateway/src/relay-client.ts` - Outbound relay client, subscriptions, replay/live forwarding, observe-mode write blocking, payload sanitization, reconnect.
- `apps/gateway/src/relay-client.test.ts` - Real relay/Gateway bridge tests using WebSocket clients and `/bin/cat`.
- `apps/gateway/src/daemon.ts` - Optional relay lifecycle integration and cleanup.
- `apps/gateway/src/index.ts` - Gateway relay client exports.
- `apps/cli/src/main.ts` - `--relay-url`, `--relay-secret`, `TETHER_RELAY_URL`, and `TETHER_RELAY_SECRET` support.
- `apps/gateway/package.json` - Added `@tether/protocol` dependency.
- `pnpm-lock.yaml` - Added gateway protocol workspace link.

## Verification Results

| Command | Result |
| --- | --- |
| `pnpm --filter @tether/gateway test` | PASS - 9 tests passed |
| `pnpm --filter @tether/gateway typecheck` | PASS |
| `pnpm --filter @tether/cli typecheck` | PASS |
| `pnpm typecheck` | PASS |

## Decisions Made

- Relay is opt-in only: no relay client starts unless both URL and secret are configured.
- CLI env fallback accepts relay config from `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`, but rejects partial config.
- Relay output sanitization removes `command`, `args`, `argv`, `env`, and `providerCommand` keys before forwarding, matching relay policy while leaving local store data unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Linked `@tether/protocol` into gateway package**
- **Found during:** Task 01-03-T01
- **Issue:** `apps/gateway` needed protocol relay types but did not depend on `@tether/protocol`, causing type resolution failure.
- **Fix:** Added workspace dependency and refreshed `pnpm-lock.yaml`.
- **Files modified:** `apps/gateway/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @tether/gateway typecheck`
- **Committed in:** `4eb4ee3`

**2. [Rule 1 - Bug] Sanitized relay-forwarded event payload keys**
- **Found during:** Task 01-03-T03
- **Issue:** PTY `session.started` events include a `command` payload key, which the relay rejects as a forbidden command-execution surface.
- **Fix:** Relay client now strips relay-forbidden keys from outbound event payloads before replay/live forwarding.
- **Files modified:** `apps/gateway/src/relay-client.ts`
- **Verification:** `pnpm --filter @tether/gateway test`
- **Committed in:** `35df98f`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were required for the relay bridge to compile and operate against the existing relay policy. No remote process creation surface was added.

## Issues Encountered

- Initial relay tests needed buffered/concurrent frame waits because replay/event/done frames can arrive back-to-back over WebSocket.

## Known Stubs

None.

## User Setup Required

None for local verification. Runtime relay usage requires providing both `--relay-url` and `--relay-secret`, or `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`.

## Next Phase Readiness

- Gateway can connect outbound to a local Relay and register existing sessions.
- Relay-routed replay/live output and control input are covered by tests.
- Observe-mode input is blocked at the Gateway relay client boundary.

## Self-Check: PASSED

- Created files exist: `apps/gateway/src/relay-client.ts`, `apps/gateway/src/relay-client.test.ts`.
- Task commits exist: `4eb4ee3`, `b7b63f4`, `35df98f`.
- Verification commands passed.

---
*Phase: 01-personal-relay-mvp*
*Completed: 2026-05-01*
