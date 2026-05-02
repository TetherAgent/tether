---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 05
subsystem: relay-token-auth
tags: [apps-relay, apps-gateway, token-auth, ws-ticket, routing-boundary]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 03
    provides: Server token validation endpoint and gateway token classes
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 04
    provides: Local auth.json, signed ws tickets, and gateway ownership metadata
provides:
  - Relay token auth as the default path
  - Legacy secret fallback behind explicit opt-in only
  - Gateway relay client identity publishing from auth.json-backed state
affects: [RELAY-AUTH-01, RELAY-AUTH-02, RELAY-AUTH-03, AUTH-03, AUTH-04, AUTH-06]
tech-stack:
  added: [relay token validator hook, relay auth scope enforcement, auth_failed relay-client path]
  patterns: [server-side token validation callback, relay scope filtering by account/workspace/gateway/session, gateway.auth.ok gated session publication]
key-files:
  created:
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-05-SUMMARY.md
  modified:
    - apps/relay/src/relay.ts
    - apps/relay/src/main.ts
    - apps/relay/src/relay.test.ts
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/relay-client.test.ts
    - packages/protocol/src/index.ts
key-decisions:
  - "Relay now defaults to token validation via Server `/api/token/validate` instead of sharing JWT secret locally."
  - "Legacy shared-secret bootstrap is retained only behind `TETHER_RELAY_ALLOW_LEGACY_SECRET=1`."
  - "Gateway relay client sends `gateway.sessions` only after `gateway.auth.ok` to avoid async auth/message races."
patterns-established:
  - "Relay session routing is now filtered by `accountId`, `workspaceId`, optional `gatewayId`, and `sessionId` ticket scope."
  - "Gateway relay auth can be sourced from explicit test token/scope overrides or from local `~/.tether/auth.json`."
requirements-completed: [RELAY-AUTH-01, RELAY-AUTH-02, RELAY-AUTH-03, AUTH-03, AUTH-04, AUTH-06]
duration: ~120min
completed: 2026-05-02
---

# Phase 5 Plan 05: Relay Token Auth and Boundary Enforcement Summary

**Relay no longer defaults to blind shared-secret routing. Gateway and client sockets now authenticate with scoped tokens, and Relay enforces account/workspace/gateway/session boundaries before routing frames.**

## Accomplishments

- Reworked `apps/relay/src/relay.ts` so token auth is the default path for both `/gateway` and `/client`.
- Added legacy-secret compatibility only behind `TETHER_RELAY_ALLOW_LEGACY_SECRET=1`.
- Added Relay-side scope enforcement for:
  - account boundary
  - workspace boundary
  - optional gateway boundary
  - ws-ticket session/mode boundary
- Updated `RelaySession` payloads to carry ownership metadata needed for filtering.
- Updated `apps/gateway/src/relay-client.ts` to:
  - read Gateway auth state from `~/.tether/auth.json` when explicit token/scope is not injected
  - authenticate with Gateway token + scope
  - publish sessions only after `gateway.auth.ok`
  - surface `auth_failed` when token auth is invalid and point operators back to `tether gateway login`

## Verification

- `pnpm --filter @tether/relay typecheck` - passed
- `pnpm --filter @tether/relay test` - passed (`8/8`)
- `pnpm --filter @tether/gateway typecheck` - passed
- `pnpm --filter @tether/gateway test` - passed (`28/28`)
- `pnpm --filter @tether/cli typecheck` - passed
- `pnpm --filter @tether/cli test` - passed (`7/7`)
- `pnpm --filter @tether/server typecheck` - passed
- `pnpm --filter @tether/server test` - passed (`8/8`)
- `pnpm --filter @tether/protocol typecheck` - passed
- `pnpm --filter @tether/web build` - passed

## Deviations from Plan

- Instead of embedding `TETHER_SERVER_JWT_SECRET` directly into Relay, token validation is delegated through a validation callback that `apps/relay/src/main.ts` backs with Server `/api/token/validate`.
- Tests use in-process validator stubs instead of booting a real Server runtime for every Relay case.

## Known Stubs

- Relay currently validates tokens through Server but does not yet cache validation or refresh tokens locally.
- Legacy secret fallback is still present for compatibility, but is no longer the default path and should be treated as migration-only.

## Uncommitted Change Policy

This run intentionally created no git commits. All changes remain in the working tree for later review or wave-level commit selection.

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
