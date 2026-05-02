---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 04
subsystem: gateway-direct-auth
tags: [apps-cli, apps-gateway, auth-json, ws-ticket, ownership]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 03
    provides: Gateway bind endpoint, token validation endpoint, and gateway token classes
provides:
  - `tether gateway login` and local `~/.tether/auth.json`
  - Gateway-side bearer auth on direct write routes
  - Signed, scoped, single-use ws tickets
affects: [AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, SERVER-02]
tech-stack:
  added: [local auth.json persistence, remote token validation from Gateway to Server]
  patterns: [owner metadata on sessions, auth header passthrough from CLI, HMAC-signed ws tickets]
key-files:
  created:
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-04-SUMMARY.md
  modified:
    - apps/cli/src/main.ts
    - apps/cli/src/main.test.ts
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/daemon.test.ts
    - apps/gateway/src/pty.ts
    - apps/gateway/src/store.ts
    - packages/protocol/src/index.ts
key-decisions:
  - "Gateway validates bearer tokens by calling Server `/api/token/validate` using `serverUrl` stored in local `auth.json`."
  - "Direct Gateway writes accept both `normal_client_access` and `gateway_access` so CLI login can use the bound Gateway token while management tokens stay rejected."
  - "ws tickets are now signed with the local Gateway refresh token secret and carry session/mode scope instead of opaque UUID state."
patterns-established:
  - "Gateway-owned PTY sessions now persist ownership metadata (`accountId`, `workspaceId`, `userId`, `deviceId`, `gatewayId`) in the local store."
  - "CLI direct-Gateway flows must source auth from `~/.tether/auth.json` and forward `Authorization: Bearer ...`."
requirements-completed: [AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, SERVER-02]
duration: ~110min
completed: 2026-05-02
---

# Phase 5 Plan 04: Gateway Login, Direct Auth, and Scoped WS Ticket Summary

**Gateway is no longer LAN-trust-only for direct writes: CLI can bind/login locally, HTTP write routes require bearer auth, and ws tickets are signed + single-use**

## Accomplishments

- Added `tether gateway login` in `apps/cli/src/main.ts`.
- The CLI now reads `--server-url` or `TETHER_SERVER_URL`, prompts for email/password when flags are absent, calls `POST /api/gateway/bind`, decodes token expiry, and writes `~/.tether/auth.json` with mode `0o600`.
- Direct CLI operations now forward `Authorization` headers from `auth.json` for session create, stop, send, and ws-ticket issuance.
- Gateway direct routes now validate bearer tokens against Server `/api/token/validate` and reject missing, invalid, expired, or management-scoped tokens.
- Gateway session records now persist ownership metadata so direct writes and ticket issuance can enforce account/workspace/owner boundaries.
- `/api/ws-ticket` now requires auth, binds to a concrete `sessionId` plus `mode`, and returns a signed `ws_ticket` carrying `accountId`, `workspaceId`, `gatewayId`, `sessionId`, `userId`, `deviceId`, `mode`, `jti`, and `expiresAt`.
- WebSocket attach now rejects invalid, expired, reused, wrong-session, and wrong-mode tickets.

## Verification

- `pnpm --filter @tether/gateway typecheck` - passed
- `pnpm --filter @tether/gateway test` - passed (`27/27`)
- `pnpm --filter @tether/cli typecheck` - passed
- `pnpm --filter @tether/cli test` - passed (`7/7`)
- `pnpm --filter @tether/server typecheck` - passed
- `pnpm --filter @tether/protocol typecheck` - passed
- `pnpm --filter @tether/web build` - passed

## Deviations from Plan

- Instead of sharing Server JWT secret with Gateway, direct Gateway auth validates tokens by calling Server `/api/token/validate`. This keeps secret material centralized on Server while still enforcing revoke/expiry checks.
- Direct Gateway writes currently accept `gateway_access` in addition to `normal_client_access` so the new `tether gateway login` path can operate locally without introducing a second login command for normal user tokens.

## Known Stubs

- `auth.json` currently stores the initial bind token pair and relogin guidance, but does not yet auto-refresh revoked/expired tokens.
- Read-only endpoints like `/api/sessions/:id/clients` are not yet covered by the new direct auth policy.

## Uncommitted Change Policy

This run intentionally created no git commits. All changes remain in the working tree for later review or wave-level commit selection.

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
