---
phase: 5
slug: web-first-account-setup-server-auth-runtime
status: executing
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-02
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in test runner via `tsx --test` for `apps/server`, `apps/cli`, `apps/gateway`, `apps/relay`; optional browser/manual checks for `apps/web` |
| **Config file** | `apps/server/test/`, existing `src/*.test.ts`, `apps/web/vite.config.ts` |
| **Quick run command** | `pnpm --filter @tether/server test` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run the narrowest affected package test, for example `pnpm --filter @tether/server test`
- **After every plan wave:** Run `pnpm -r test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-T01 | 01 | 1 | SERVER-01 | JWT secret / CORS misconfig | `apps/server` boots as Egg CommonJS service with explicit env config and `/healthz` | integration | `pnpm --filter @tether/server test` | ❌ W0 | ⬜ pending |
| 05-01-T02 | 01 | 1 | SERVER-02 | schema drift | SQL bootstrap defines ownership and token tables under `apps/server/sql/001_init.sql` | unit | `pnpm --filter @tether/server test` | ❌ W0 | ⬜ pending |
| 05-01-T03 | 01 | 1 | AUTH-04 | scope confusion | Shared token payload/types carry `accountId`, `workspaceId`, `gatewayId`, `sessionId`, `mode`, and `tokenClass` | unit | `pnpm --filter @tether/protocol typecheck` | ✅ | ⬜ pending |
| 05-02-T01 | 02 | 1 | WEBUI-01 | UI drift | `apps/web` initializes Tailwind 4 + shadcn using approved component set only | build | `pnpm --filter @tether/web build` | ✅ | ⬜ pending |
| 05-02-T02 | 02 | 1 | AUTH-01 | auth bypass | Router/auth shell redirects unauthenticated users to `/login` and keeps terminal shell behind auth gate | manual | `pnpm --filter @tether/web build` | ✅ | ⬜ pending |
| 05-03-T01 | 03 | 2 | SETUP-01 | bootstrap abuse | `POST /api/auth/register` creates first account/default workspace/owner/device only when no owner exists | integration | `pnpm --filter @tether/server test` | ❌ W0 | ✅ green |
| 05-03-T02 | 03 | 2 | AUTH-01 | wrong realm mixing | normal and management auth flows issue different token classes and reject wrong credentials | integration | `pnpm --filter @tether/server test` | ❌ W0 | ✅ green |
| 05-03-T03 | 03 | 2 | AUTH-07 | cross-account notification leak | notification WS only emits metadata/invalidation to the same account/user room | integration | `pnpm --filter @tether/server test` | ❌ W0 | ⬜ pending |
| 05-03-T04 | 03 | 2 | AUDIT-01 | missing accountability | login/logout/refresh/revoke and gateway bind write identity-bearing audit rows | integration | `pnpm --filter @tether/server test` | ❌ W0 | ⬜ pending |
| 05-04-T01 | 04 | 2 | AUTH-02 | token disclosure | `tether gateway login` writes `~/.tether/auth.json` with mode `0600` and reconnects Relay using Gateway token | integration | `pnpm --filter @tether/cli test` | ✅ | ⬜ pending |
| 05-04-T02 | 04 | 2 | AUTH-03 | direct write privilege bypass | Gateway HTTP write endpoints require `normal_client_access` and owner scope | integration | `pnpm --filter @tether/gateway test` | ✅ | ⬜ pending |
| 05-04-T03 | 04 | 2 | AUTH-04 | ticket reuse | `/api/ws-ticket` returns short-lived single-use JWT scoped to account/workspace/gateway/session/mode | integration | `pnpm --filter @tether/gateway test` | ✅ | ⬜ pending |
| 05-05-T01 | 05 | 3 | RELAY-AUTH-01 | unauthenticated WS attach | Relay `/gateway` and `/client` reject missing/invalid/wrong-class tokens | integration | `pnpm --filter @tether/relay test` | ✅ | ✅ green |
| 05-05-T02 | 05 | 3 | RELAY-AUTH-02 | cross-account/session routing | Relay only registers/subscribes/routes inside authorized account/workspace/gateway/session scope | integration | `pnpm --filter @tether/relay test` | ✅ | ✅ green |
| 05-06-T01 | 06 | 3 | SETUP-02 | stale setup path | `/register`, `/login`, `/admin/register`, and `/admin/login` render shadcn forms; `/setup?token=...` is removed from the required path | manual | `pnpm --filter @tether/web build` | ✅ | ✅ green |
| 05-06-T02 | 06 | 3 | AUTH-06 | session ownership confusion | logged-in normal user only sees own sessions; management login does not unlock terminal control | manual | `pnpm --filter @tether/web build` | ✅ | ⚠️ partial |
| 05-07-T01 | 07 | 4 | AUTH-05 | revoke gap | revoked tokens fail Server refresh, Gateway writes, and Relay attach flows in the same suite | integration | `pnpm -r test` | ✅ | ✅ green |
| 05-07-T02 | 07 | 4 | AUDIT-02 | secret leakage | stored/streamed events keep token and secret masking after Phase 5 auth changes | integration | `pnpm -r test` | ✅ | ✅ green |
| 05-07-T03 | 07 | 4 | SERVER-02 | doc drift | `.planning/ROADMAP.md`, `.planning/STATE.md`, and Phase 5 docs all describe `/register` instead of `/setup?token=...` as the required path | unit | `rg -n \"/register|/setup\\?token\" .planning/ROADMAP.md .planning/STATE.md .planning/phases/05-web-first-account-setup-server-auth-runtime` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/server/test/auth.test.ts` — normal/admin register/login/refresh/logout coverage
- [ ] `apps/server/test/gateway.test.ts` — bind/refresh/revoke coverage
- [ ] `apps/server/test/notification.test.ts` — same-account WS invalidation delivery only
- [ ] `apps/server/test/audit.test.ts` — identity-bearing audit rows without raw tokens
- [ ] `apps/server/test/helpers/db.ts` — MySQL fixture/bootstrap helper for `001_init.sql`
- [ ] `apps/server/test/helpers/redis.ts` — Redis revoke helper for `jti` blocklist scenarios
- [ ] `apps/server` package scaffolded with `test`, `typecheck`, and `dev` scripts

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/register`, `/login`, `/admin/register`, `/admin/login` render the expected shadcn auth cards | WEBUI-01, SETUP-02 | visual contract and mobile layout need human confirmation | Run `pnpm --filter @tether/web dev`, open each route, verify copy/layout/components against `05-UI-SPEC.md` |
| `tether gateway login` prompts for credentials and relogin hints on revoke/expiry | AUTH-02 | CLI interactive flow | Run `pnpm tether gateway login --server-url http://127.0.0.1:4800`, enter credentials, then revoke token and confirm CLI/Gateway show relogin guidance |
| Same-user multi-device invalidation flow works end to end | AUTH-07 | real multi-client/socket behavior | Login from two clients, stop a session or revoke a token on one side, verify the second side receives metadata refresh and refetches |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** automated checks complete; visual route verification complete; live submit path complete in both in-memory and MySQL-backed local runs; same-user multi-device verification still pending

## Execution Update — 2026-05-02

- Automated validation completed:
  - `pnpm -r test`
  - `pnpm typecheck`
  - `pnpm --filter @tether/web build`
- Added Gateway-side owner isolation coverage so same-account wrong-owner tokens cannot obtain another user's WS ticket.
- Manual browser verification completed:
  - `/register`, `/login`, `/admin/register`, `/admin/login` all render with the expected Phase 5 headings and card layout
  - unauthenticated `/` redirects to `/login`
  - unauthenticated `/admin` redirects to `/admin/login`
- Live auth submit verification completed against a local in-memory Server runtime:
  - normal `/api/auth/register` returns `normal_client_access` plus refresh token
  - `GET /api/auth/me` works with `Authorization: Bearer <token>` after fixing bearer parsing
  - sequential `/api/admin/auth/register` and `/api/admin/auth/login` return `management_access`
- Live auth submit verification also completed against a MySQL-backed local Server runtime:
  - fixed `apps/server/app/service/storage.ts` to resolve `apps/server/sql/001_init.sql` relative to the service file instead of assuming repo-root cwd
  - sourced private local MySQL config into env at process start, then ran the local server with `TETHER_SERVER_ENABLE_MYSQL=true`
  - normal `/api/auth/register`, `GET /api/auth/me`, and `/api/auth/refresh` all returned success
  - `/api/admin/auth/register`, `/api/admin/auth/login`, `/api/gateway/bind`, and `/api/gateway/refresh` all returned success
- Remaining manual-only checks:
  - same-user multi-device metadata refresh flow in a live environment
- Environment note:
  - local Phase 5 submit verification now runs without Redis/MySQL by leaving `egg-redis` and `egg-mysql` disabled unless explicitly enabled through env flags
  - committed code still expects MySQL connection details in env; `config.local.ts` remains a local-only source that can be projected into env for manual verification without being committed
