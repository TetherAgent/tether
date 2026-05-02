---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 01
subsystem: server-foundation
tags: [apps-server, egg, mysql-schema, auth-contract, shared-types]
requires:
  - phase: 04-account-auth-contract
    plan: 01
    provides: Canonical ownership graph, token classes, and trust boundaries
provides:
  - Bootable `@tether/server` workspace scaffold
  - Manual SQL bootstrap under `apps/server/sql/001_init.sql`
  - Shared auth token/scope contracts in `@tether/core` and `@tether/protocol`
affects: [SERVER-01, SERVER-02, AUTH-04]
tech-stack:
  added: [egg, egg-bin, egg-cors, egg-jwt, egg-redis, egg-socket.io, egg-mysql, egg-bcrypt, egg-console]
  patterns: [Egg CommonJS service boundary, manual SQL bootstrap, token scope encoded in shared packages]
key-files:
  created:
    - apps/server/package.json
    - apps/server/tsconfig.json
    - apps/server/app.ts
    - apps/server/config/config.default.ts
    - apps/server/config/plugin.ts
    - apps/server/app/router.ts
    - apps/server/app/controller/health.ts
    - apps/server/sql/001_init.sql
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-01-SUMMARY.md
  modified:
    - packages/core/src/index.ts
    - packages/protocol/src/index.ts
    - pnpm-lock.yaml
key-decisions:
  - "apps/server stays Egg + TypeScript + CommonJS; no Hono parallel stack was introduced."
  - "Schema bootstrap remains manual under apps/server/sql/, with no migration framework."
  - "This execution created no git commits and leaves all changes uncommitted for later review."
patterns-established:
  - "Phase 5 auth scope types must be shared through @tether/core and @tether/protocol rather than re-declared per app."
  - "Server config keys follow the TETHER_SERVER_* namespace with strict JWT secret enforcement outside test."
requirements-completed: [SERVER-01, SERVER-02, AUTH-04]
duration: ~40min
completed: 2026-05-02
---

# Phase 5 Plan 01: Server Scaffold, SQL Bootstrap, and Shared Auth Contract Summary

**Egg-based `apps/server` foundation, manual MySQL bootstrap, and shared token/scope contracts for the rest of Phase 5**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-05-02
- **Tasks:** 3/3
- **Files modified:** 11 source/config files plus lockfile and this summary

## Accomplishments

- Added `@tether/server` as a new workspace package with Egg + TypeScript + CommonJS scaffolding.
- Enabled `cors`, `jwt`, `redis`, `socketIO`, `mysql`, `bcrypt`, and `console` plugins in `apps/server/config/plugin.ts`.
- Added strict env-driven server config with `TETHER_SERVER_*` keys, default port `4800`, and a non-test JWT secret requirement.
- Added a deterministic `GET /healthz` route/controller pair for later runtime and verification plans.
- Created `apps/server/sql/001_init.sql` covering `accounts`, `workspaces`, `users`, `admin_users`, `devices`, `gateways`, `refresh_tokens`, `gateway_refresh_tokens`, and `audit_events`.
- Extended `@tether/core` and `@tether/protocol` with Phase 5 token classes, auth scope payloads, and Relay auth frame shape updates.
- Installed new dependencies and refreshed `pnpm-lock.yaml`.

## Task Commits

No commits were created. This execution leaves all source, lockfile, SUMMARY, and planning-state changes uncommitted for later review.

1. **05-01-T01: Scaffold the Egg TypeScript server workspace** - not committed
2. **05-01-T02: Define the Phase 5 SQL bootstrap schema** - not committed
3. **05-01-T03: Publish shared token and scope contracts for later plans** - not committed

## Files Created/Modified

- `apps/server/package.json` - New workspace package and server dependency set.
- `apps/server/tsconfig.json` - CommonJS-focused TypeScript config for Egg runtime.
- `apps/server/app.ts` - Egg application entrypoint.
- `apps/server/config/config.default.ts` - Strict `TETHER_SERVER_*` configuration and JWT secret guard.
- `apps/server/config/plugin.ts` - Enabled required Egg plugins.
- `apps/server/app/router.ts` - Added `/healthz`.
- `apps/server/app/controller/health.ts` - Health controller implementation.
- `apps/server/sql/001_init.sql` - Manual MySQL bootstrap schema for Phase 5 auth state.
- `packages/core/src/index.ts` - Shared token classes and auth scope payloads.
- `packages/protocol/src/index.ts` - Relay auth frame contract updates for token/ticket flows.
- `pnpm-lock.yaml` - Recorded the workspace dependency install.
- `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-01-SUMMARY.md` - This execution summary.

## Decisions Made

- Kept `apps/server` strictly on Egg instead of matching Gateway/Relay's Hono-style HTTP layer.
- Used the `TETHER_SERVER_WEB_ORIGIN` allowlist for CORS instead of wildcard origins.
- Preserved fallback-only `secret` support in Relay auth contracts while making token/ticket fields first-class.
- Kept all changes uncommitted so later Wave commits or manual review can decide the final git granularity.

## Verification

- `pnpm --filter @tether/server typecheck` - passed
- `pnpm --filter @tether/protocol typecheck` - passed
- `git diff --check` - not yet run at this plan boundary

## Deviations from Plan

### Auto-fixed Issues

**1. Installed dependencies before final verification**
- **Found during:** Verification
- **Issue:** Initial `@tether/server` typecheck was blocked because `node_modules` did not exist for the newly added package.
- **Fix:** Ran `pnpm install`, refreshed `pnpm-lock.yaml`, then reran typechecks successfully.
- **Files modified:** `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @tether/server typecheck` passed.

## Known Stubs

None. This plan intentionally stops at scaffold/schema/shared-contract level and does not create auth controllers or services yet.

## Threat Flags

None beyond the planned server/runtime surface. This plan adds no executable auth endpoints beyond `GET /healthz`.

## User Setup Required

- Provision MySQL and Redis before later runtime plans try to boot `apps/server`.
- Set `TETHER_SERVER_JWT_SECRET` before running the server outside test mode.

## Next Phase Readiness

Wave 2 can now implement actual auth controllers, Gateway bind/refresh endpoints, and notification/audit services against a stable schema and shared token contract.

## Uncommitted Change Policy

This run intentionally created no git commits. All modified files remain in the working tree for review and later commit selection.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-01-SUMMARY.md`
- `apps/server` scaffold files exist and include `/healthz`, `socketIO`, `TETHER_SERVER_JWT_SECRET`, and CommonJS module configuration.
- `001_init.sql` includes the required ownership and token tables.
- Shared token and scope contracts are present in `packages/core/src/index.ts` and `packages/protocol/src/index.ts`.
- Verification commands for `@tether/server` and `@tether/protocol` passed after dependency installation.

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
