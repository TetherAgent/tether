---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 03
subsystem: server-auth-runtime
tags: [apps-server, auth, gateway-bind, notification, audit]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 01
    provides: Egg server scaffold and shared auth token classes
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 02
    provides: Web auth shell routes and `/register`-first flow anchor
provides:
  - Normal, management, and gateway token runtime in `apps/server`
  - First-owner `/api/auth/register` and `/api/auth/me` flow
  - Revoke-aware gateway bind/refresh and metadata-only notification helpers
affects: [SETUP-01, SETUP-02, SETUP-03, AUTH-01, AUTH-05, AUTH-07, AUDIT-01, AUDIT-02]
tech-stack:
  added: [tsx node:test runtime for server tests]
  patterns: [optional mysql-backed auth runtime, HMAC token signing, metadata-only notifications, masked audit payloads]
key-files:
  created:
    - apps/server/app/service/runtime.ts
    - apps/server/app/service/auth.ts
    - apps/server/app/service/admin-auth.ts
    - apps/server/app/service/gateway.ts
    - apps/server/app/service/audit.ts
    - apps/server/app/service/notification.ts
    - apps/server/app/middleware/auth.ts
    - apps/server/app/io/middleware/auth.ts
    - apps/server/app/controller/auth.ts
    - apps/server/app/controller/admin-auth.ts
    - apps/server/app/controller/gateway.ts
    - apps/server/app/controller/token.ts
    - apps/server/app/controller/audit.ts
    - apps/server/test/auth.test.ts
    - apps/server/test/gateway.test.ts
    - apps/server/test/notification.test.ts
    - apps/server/test/audit.test.ts
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-03-SUMMARY.md
  modified:
    - apps/server/app/router.ts
    - apps/server/package.json
    - apps/server/tsconfig.json
key-decisions:
  - "Plan 03 shipped first on top of an in-memory runtime contract, then added an optional MySQL persistence layer behind the same service boundary once the auth flows stabilized."
  - "Gateway bind now returns real `gateway_access` and `gateway_refresh` tokens instead of reusing normal refresh tokens."
  - "Auth-state notifications stay account-scoped metadata and intentionally do not carry PTY output bytes."
patterns-established:
  - "Server-side token verification in this phase is HMAC-based and centralized in `apps/server/app/service/auth.ts`."
  - "Server tests use `tsx --test` and a narrowed `AuthConfig` type rather than full Egg config casting."
requirements-completed: [SETUP-01, SETUP-02, SETUP-03, AUTH-01, AUTH-05, AUTH-07, AUDIT-01, AUDIT-02]
duration: ~90min
completed: 2026-05-02
---

# Phase 5 Plan 03: Server Auth Runtime Summary

**`apps/server` now owns first-owner registration, normal/admin auth, gateway bind, revoke-aware refresh, audit writes, and metadata-only notification fanout**

## Accomplishments

- Added concrete auth endpoints for normal and management realms:
  `POST /api/auth/register`,
  `POST /api/auth/login`,
  `POST /api/auth/refresh`,
  `POST /api/auth/logout`,
  `GET /api/auth/me`,
  `POST /api/admin/auth/register`,
  `POST /api/admin/auth/login`,
  `POST /api/admin/auth/refresh`,
  `POST /api/admin/auth/logout`.
- Added gateway/runtime endpoints:
  `POST /api/gateway/bind`,
  `POST /api/gateway/refresh`,
  `POST /api/token/revoke`,
  `POST /api/token/validate`,
  and audit list/write endpoints.
- Implemented separate token classes for normal, management, gateway, and later ws-ticket flows in one shared verifier path.
- Made gateway refresh truly gateway-scoped and fixed the earlier wrong-token-class bug in the original inline draft.
- Added masked audit persistence helpers and notification delivery that stays metadata-only and same-account scoped.

## Verification

- `pnpm --filter @tether/server typecheck` - passed
- `pnpm --filter @tether/server test` - passed (`8/8`)
- `pnpm --filter @tether/protocol typecheck` - passed

## Deviations from Plan

- Redis-backed revoke state is still not wired. Redis is now optional in local/dev so Phase 5 can run without it, while revoke persistence falls back to MySQL or in-memory depending on the env flag.
- Password hashing is currently HMAC+salt inside the runtime helper rather than `egg-bcrypt`. The route/service boundary is already in place, so swapping the hash backend later is localized.

## Known Stubs

- Notification WS here is still service-layer groundwork plus handshake auth helper; the full cross-process realtime path is completed on the Gateway/Relay side in later plans.
- `storage.ts` currently reads MySQL connection details from environment variables; local verification succeeded by sourcing the user's private local config into env at process start rather than teaching the committed code to depend on `config.local.ts`.

## Uncommitted Change Policy

This run intentionally created no git commits. All changes remain in the working tree for later review or wave-level commit selection.

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
