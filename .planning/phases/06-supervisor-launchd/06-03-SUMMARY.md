---
phase: 06-supervisor-launchd
plan: 03
subsystem: cli-forwarding
tags: [cli, gateway-probing, inline-fallback, provider-whitelist]
requires:
  - phase: 06-supervisor-launchd
    plan: 01
    provides: Shared provider whitelist and Gateway config helpers
  - phase: 06-supervisor-launchd
    plan: 02
    provides: GET /api/status and config-gated POST /api/sessions
provides:
  - Provider commands default to verified persistent Gateway forwarding
  - --inline fallback path for existing inline PTY/tmux behavior
  - CLI create-session payload helper covered by node:test
affects: [GW-01, cli-provider-start, gateway-session-api]
tech-stack:
  added: [@tether/config dependency in @tether/cli]
  patterns: [registry-as-hint with HTTP verification, whitelist provider forwarding, command-shaped payload exclusion]
key-files:
  created:
    - apps/cli/src/forwarding.ts
    - apps/cli/src/main.test.ts
    - .planning/phases/06-supervisor-launchd/06-03-SUMMARY.md
  modified:
    - apps/cli/src/main.ts
    - apps/cli/package.json
    - apps/gateway/src/index.ts
    - pnpm-lock.yaml
key-decisions:
  - "Persistent Gateway discovery uses registry records and config host/port only as hints; every candidate must pass GET /api/status before use."
  - "CLI forwarding sends only provider, projectPath, cols, and rows to POST /api/sessions."
  - "Per user instruction, this execution created no commits and did not update STATE.md or ROADMAP.md."
patterns-established:
  - "Provider commands should use @tether/core PROVIDERS/isProviderName instead of local provider metadata."
  - "CLI tests can cover forwarding payload construction through a small helper module without importing the commander entrypoint."
requirements-completed: []
duration: ~45min
completed: 2026-05-02
---

# Phase 6 Plan 03: CLI Forwarding and Inline Fallback Summary

**Verified persistent Gateway session forwarding with safe inline fallback and command-shaped payload exclusion**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-05-02
- **Tasks:** 4/4
- **Files modified:** 4 source/config files plus this summary

## Accomplishments

- Replaced CLI-local provider metadata with `PROVIDERS`, `ProviderDefinition`, and `isProviderName` from `@tether/core`.
- Added `--inline` to provider commands and `tether run`, preserving the old inline PTY/tmux behavior when forced or when Gateway forwarding cannot be used.
- Added persistent Gateway discovery with 3 attempts and 500 ms spacing.
- Used registry records and resolved config host/port as hints only; every candidate must verify through `GET /api/status`.
- Added `createSessionViaGateway` for `POST /api/sessions` and restricted the forwarded payload to `provider`, `projectPath`, `cols`, and `rows`.
- Added Chinese CLI output for Gateway restart probing, no-Gateway inline fallback, API session creation disabled fallback, session id, remote URL, and inline mode.
- Added a CLI helper test ensuring forwarded create payloads do not include `command`, `args`, `argv`, `env`, `shell`, or `providerCommand`.
- Exported `listGateways` from `@tether/gateway` so CLI probing can consume registry hints through the package boundary.

## Task Commits

No commits were created. The user explicitly required this execution to leave all code, tests, SUMMARY, and planning-state changes uncommitted for a later manual commit.

1. **06-03-T01: Use shared provider metadata and add inline option** - not committed by user request
2. **06-03-T02: Add Gateway probing and create-session forwarding** - not committed by user request
3. **06-03-T03: Attach to sessions created by persistent Gateway** - not committed by user request
4. **06-03-T04: Add CLI forwarding tests or type-level coverage** - not committed by user request

## Files Created/Modified

- `apps/cli/src/main.ts` - Provider metadata import, `--inline`, Gateway probing, session creation forwarding, attach/no-attach handling, and Chinese fallback output.
- `apps/cli/src/forwarding.ts` - Payload builder for safe Gateway session creation requests.
- `apps/cli/src/main.test.ts` - `node:test` coverage for excluding command-shaped fields from forwarded payloads.
- `apps/cli/package.json` - Added `test` script and `@tether/config` dependency.
- `apps/gateway/src/index.ts` - Exported registry hint APIs for CLI discovery.
- `pnpm-lock.yaml` - Refreshed workspace dependency metadata for the new CLI dependency.
- `.planning/phases/06-supervisor-launchd/06-03-SUMMARY.md` - This execution summary.

## Decisions Made

- Kept `--transport tmux` as inline-only behavior. The persistent Gateway path always creates PTY sessions through the Gateway API.
- Treated an HTTP service on the candidate port that is not a Tether `/api/status` endpoint as a Chinese hard error instead of silently falling back or switching ports.
- Passed `allowApiSessionCreate` from resolved config into the foreground `tether gateway` command so an enabled local config can actually support CLI forwarding.
- Did not update `.planning/STATE.md`, `.planning/ROADMAP.md`, or `.planning/REQUIREMENTS.md` because the user directed this executor not to update planning state in this run.

## Verification

- `pnpm --filter @tether/cli test` - passed, 1/1 test
- `pnpm --filter @tether/cli typecheck` - passed
- `pnpm --filter @tether/gateway typecheck` - passed
- `pnpm typecheck` - passed
- `git diff --check` - passed
- Manual E2E smoke - passed: with temporary `HOME`, fake `codex`, and `TETHER_GATEWAY_ALLOW_API_SESSION_CREATE=true`, `pnpm tether codex --port 4911 --project /tmp/tether-cli-e2e/project --no-attach` created a session through the foreground Gateway and printed session id plus remote URL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Foreground Gateway did not consume the API session creation config switch**
- **Found during:** Task 06-03-T03
- **Issue:** The Gateway API from Plan 02 was config-gated, but `tether gateway` was not passing `allowApiSessionCreate` into `startDaemon`, so an enabled config could not make CLI forwarding succeed.
- **Fix:** Resolved Gateway config in the foreground `gateway` command and passed `allowApiSessionCreate` to `startDaemon`.
- **Files modified:** `apps/cli/src/main.ts`
- **Verification:** CLI typecheck passed and manual E2E smoke created a session through persistent Gateway.
- **Committed in:** Not committed by user request.

**2. [Rule 2 - Missing critical functionality] Registry hints were not available through the Gateway package boundary**
- **Found during:** Task 06-03-T02
- **Issue:** CLI probing needed registry records as hints while still verifying HTTP status, but `listGateways` was not exported from `@tether/gateway`.
- **Fix:** Exported `listGateways` and `GatewayRecord`, then used registry URLs as discovery hints before config host/port.
- **Files modified:** `apps/gateway/src/index.ts`, `apps/cli/src/main.ts`
- **Verification:** CLI and Gateway typechecks passed; manual E2E smoke passed.
- **Committed in:** Not committed by user request.

## Known Stubs

None. Stub-pattern scan found no placeholder, TODO/FIXME, or hardcoded empty UI data in files created or modified by this plan.

## Threat Flags

None beyond the planned CLI-to-Gateway session creation surface. The forwarded request body is constrained to provider whitelist name, project path, and terminal size.

## User Setup Required

To make persistent forwarding succeed outside the E2E smoke, the running Gateway must have `gateway.allowApiSessionCreate` enabled through `~/.tether/config.json` or `TETHER_GATEWAY_ALLOW_API_SESSION_CREATE=true`; otherwise the CLI prints the Chinese disabled message and falls back inline.

## Uncommitted Change Policy

This run intentionally created no git commits and did not update `.planning/STATE.md` or `.planning/ROADMAP.md`. All modified files remain in the working tree for the user to review and commit manually.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/06-supervisor-launchd/06-03-SUMMARY.md`
- Required strings are present in `apps/cli/src/main.ts`, `apps/cli/src/main.test.ts`, and `apps/cli/package.json`.
- All required verification commands passed.
- `git diff --check` passed.
- Working tree intentionally contains uncommitted changes only.

---
*Phase: 06-supervisor-launchd*
*Completed: 2026-05-02*
