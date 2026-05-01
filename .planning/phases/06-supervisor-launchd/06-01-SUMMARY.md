---
phase: 06-supervisor-launchd
plan: 01
subsystem: gateway-config
tags: [provider-whitelist, config-json, node-pty, pnpm]
requires:
  - phase: 01-personal-relay-mvp
    provides: Relay topology and Gateway relay configuration inputs
provides:
  - Shared provider whitelist in @tether/core
  - JSON-only ~/.tether/config.json helpers in @tether/config
  - node-pty 1.2.0-beta.12 for long-running Gateway readiness
affects: [GW-01, GW-02, supervisor, launchd, gateway-session-api]
tech-stack:
  added: [@types/node in @tether/config devDependencies, node-pty 1.2.0-beta.12]
  patterns: [CLI > env > file > defaults config resolution, provider whitelist only]
key-files:
  created:
    - .planning/phases/06-supervisor-launchd/06-01-SUMMARY.md
  modified:
    - packages/core/src/index.ts
    - packages/config/src/index.ts
    - packages/config/package.json
    - apps/gateway/package.json
    - pnpm-lock.yaml
key-decisions:
  - "Provider metadata remains a whitelist of provider names and binary commands only; no args/env/custom command API was added."
  - "Gateway config is JSON-only at ~/.tether/config.json with allowApiSessionCreate defaulting to false."
  - "Per user instruction, this execution created no commits and left all changes uncommitted."
patterns-established:
  - "Provider policy should import PROVIDERS/isProviderName from @tether/core."
  - "Gateway and Relay config should resolve in CLI > env > file > defaults order."
requirements-completed: []
duration: ~15min
completed: 2026-05-01
---

# Phase 6 Plan 01: Gateway Config and Provider Policy Foundation Summary

**Shared provider whitelist, JSON-only Gateway/Relay config helpers, and node-pty beta.12 readiness for persistent Gateway ownership**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-01T15:43:00Z
- **Completed:** 2026-05-01T15:58:35Z
- **Tasks:** 3/3
- **Files modified:** 6

## Accomplishments

- Added `ProviderDefinition`, `PROVIDERS`, and `isProviderName` to `@tether/core` without adding any custom command, args, env, shell, or binary path surface.
- Added JSON-only Tether config helpers in `@tether/config`, including `configPath`, `readTetherConfig`, `writeTetherConfig`, `resolveGatewayConfig`, and `resolveRelayConfig`.
- Preserved the safe config default: `allowApiSessionCreate` resolves to `false` unless CLI/env/file explicitly enables it.
- Upgraded `apps/gateway` from `node-pty@1.2.0-beta.2` to `node-pty@1.2.0-beta.12` and refreshed `pnpm-lock.yaml`.

## Task Commits

No commits were created. The user explicitly required this execution to leave all code, lockfile, SUMMARY, and status-document changes uncommitted for a later manual commit.

1. **06-01-T01: Move provider command metadata into shared core** - not committed by user request
2. **06-01-T02: Add JSON config helpers for Gateway and Relay** - not committed by user request
3. **06-01-T03: Upgrade node-pty for long-running Gateway readiness** - not committed by user request

## Files Created/Modified

- `packages/core/src/index.ts` - Shared provider whitelist and provider-name guard.
- `packages/config/src/index.ts` - JSON config read/write plus Gateway and Relay resolution helpers.
- `packages/config/package.json` - Added `@types/node` for Node API types used by config helpers.
- `apps/gateway/package.json` - Upgraded `node-pty` to `1.2.0-beta.12`.
- `pnpm-lock.yaml` - Recorded the package and lockfile dependency updates from `pnpm install`.
- `.planning/phases/06-supervisor-launchd/06-01-SUMMARY.md` - This execution summary.

## Decisions Made

- Kept provider definitions intentionally narrow: provider name and command only.
- Chose `TETHER_GATEWAY_HOST`, `TETHER_GATEWAY_PORT`, and `TETHER_GATEWAY_ALLOW_API_SESSION_CREATE` as environment keys for Gateway config resolution.
- Kept Relay config compatible with existing `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET` environment variables.
- Did not update `.planning/STATE.md`, `.planning/ROADMAP.md`, or `.planning/REQUIREMENTS.md` because the user requested no commits and this plan is a foundation for `GW-01`/`GW-02`, not completion of those requirements.

## Verification

- `pnpm --filter @tether/config typecheck` - passed
- `pnpm --filter @tether/gateway test` - passed, 19/19 tests
- `pnpm typecheck` - passed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added Node type dependency for @tether/config**
- **Found during:** Task 06-01-T02
- **Issue:** The config helpers import Node built-ins and use `NodeJS` types, so the package needs Node types available for package-local typechecking.
- **Fix:** Added `@types/node` to `packages/config/package.json`.
- **Files modified:** `packages/config/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @tether/config typecheck` passed.
- **Committed in:** Not committed by user request.

**Total deviations:** 1 auto-fixed blocking issue.

## Known Stubs

None. The stub-pattern scan only matched intentional default `{}` parameters in resolver functions.

## Threat Flags

None. This plan adds config and whitelist foundations only; it does not add a new network endpoint, auth path, file access at a trust boundary beyond the planned JSON config file, or schema change.

## User Setup Required

None.

## Next Phase Readiness

Wave 2 can import `PROVIDERS` / `isProviderName` for `POST /api/sessions` provider validation and use `resolveGatewayConfig` to keep remote/API session creation disabled by default.

## Uncommitted Change Policy

This run intentionally created no git commits. All modified files remain in the working tree for the user to review and commit manually.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/06-supervisor-launchd/06-01-SUMMARY.md`
- Acceptance strings are present in `packages/core/src/index.ts`, `packages/config/src/index.ts`, `apps/gateway/package.json`, and `pnpm-lock.yaml`.
- `git diff --check` passed.
- Latest git commit remains pre-existing: `85d77f3 docs: record multi-user ownership roadmap`.
- Working tree intentionally contains uncommitted changes only.

---
*Phase: 06-supervisor-launchd*
*Completed: 2026-05-01*
