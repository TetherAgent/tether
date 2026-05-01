---
phase: 01-personal-relay-mvp
plan: 01
subsystem: protocol
tags: [typescript, relay, websocket, protocol-contract]
requires: []
provides:
  - Formal shared relay session, terminal event, and directional frame contracts
  - MVP relay protocol types without process creation fields
affects: [gateway, relay, web, personal-relay-mvp]
tech-stack:
  added: []
  patterns:
    - JSON-serializable TypeScript literal-union protocol contracts
key-files:
  created:
    - .planning/phases/01-personal-relay-mvp/01-01-SUMMARY.md
  modified:
    - packages/protocol/src/index.ts
key-decisions:
  - "Relay protocol uses four directional frame unions to keep Gateway and Web client capabilities separate."
  - "Terminal input frames carry data for existing sessions only; protocol excludes command, args, and env fields."
patterns-established:
  - "Relay contracts are exported from @tether/protocol as type aliases using literal unions, not enums."
requirements-completed: [RELAY-01]
duration: 2min
completed: 2026-05-01
---

# Phase 1 Plan 01: Relay Protocol Contract Summary

**Shared TypeScript relay protocol contract with session metadata, terminal events, and four directional frame unions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T13:37:37Z
- **Completed:** 2026-05-01T13:39:13Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Replaced the placeholder `RelayFrame` with `RelaySessionStatus`, `RelayClientMode`, `RelaySession`, and `RelayTerminalEvent`.
- Added `RelayGatewayToServerFrame`, `RelayServerToGatewayFrame`, `RelayClientToServerFrame`, and `RelayServerToClientFrame`.
- Verified the protocol contract contains no `command:`, `args:`, or `env:` fields and that `@tether/protocol` typechecks.

## Task Commits

| Task | Name | Commit | Files |
| --- | --- | --- | --- |
| 01-01-T01 | Define shared relay session and stream frame types | `9eb7a65` | `packages/protocol/src/index.ts` |
| 01-01-T02 | Define directional relay frame unions | `cd6c0f7` | `packages/protocol/src/index.ts` |
| 01-01-T03 | Verify protocol package typechecks | `0530723` | Verification-only empty commit |

## Files Created/Modified

- `packages/protocol/src/index.ts` - Formal relay session, terminal event, and directional frame type source of truth.
- `packages/protocol/package.json` - Verified unchanged: `"."` exports `./src/index.ts` and `typecheck` remains `tsc -p tsconfig.json --noEmit`.
- `.planning/phases/01-personal-relay-mvp/01-01-SUMMARY.md` - Execution summary for this plan.

## Verification Results

| Command | Result |
| --- | --- |
| `rg -n "export type RelaySessionStatus =|export type RelayClientMode = 'control' \\| 'observe';|export type RelaySession = \\{|export type RelayTerminalEvent = \\{|enum " packages/protocol/src/index.ts` | Passed; required exports present and no `enum` match. |
| `rg -n "export type RelayGatewayToServerFrame =|type: 'gateway\\.auth'|type: 'client\\.subscribe'|type: 'client\\.input'|type: 'client\\.resize'|type: 'replay\\.done'" packages/protocol/src/index.ts` | Passed. |
| `if rg -n "command:|args:|env:" packages/protocol/src/index.ts; then exit 1; else echo "no forbidden process fields"; fi` | Passed; no forbidden process fields. |
| `pnpm --filter @tether/protocol typecheck` | Passed. |

## Decisions Made

- Used `string` for `RelaySession.provider` so `@tether/protocol` does not gain a new package dependency.
- Used `data` for terminal input payloads to match terminal stream terminology without introducing process execution semantics.
- Kept the contract scoped to MVP relay forwarding, auth, list, subscribe/replay, input, resize, detach, and error frames.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Gateway, Relay, and Web implementation plans can now import the shared directional protocol types from `@tether/protocol`.

## Self-Check: PASSED

- Found `packages/protocol/src/index.ts`, `packages/protocol/package.json`, and this SUMMARY file.
- Found task commits `9eb7a65`, `cd6c0f7`, and `0530723` in git history.

---
*Phase: 01-personal-relay-mvp*
*Completed: 2026-05-01*
