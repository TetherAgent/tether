---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 06
subsystem: web-auth-pages-and-session-gating
tags: [apps-web, auth, register, login, admin, session-shell]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 02
    provides: Web shadcn foundation and auth shell baseline
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 03
    provides: Server auth endpoints and token validation runtime
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 04
    provides: Gateway bearer auth and ws ticket issuance
provides:
  - Web register/login/admin auth pages on the approved Phase 5 routes
  - localStorage-backed normal and management auth separation
  - Authenticated session shell access for normal users
affects: [WEBUI-01, SETUP-01, SETUP-02, SETUP-03, AUTH-01, AUTH-06, AUTH-07]
tech-stack:
  added: [react-hook-form, zod auth forms, web auth context, gateway bearer header helpers]
  patterns: [split normal-management browser auth state, auth guard backed by api/auth/me, ws-ticket fetch with bearer access token]
key-files:
  created:
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-06-SUMMARY.md
    - apps/web/src/contexts/auth-context.tsx
    - apps/web/src/hooks/use-auth.ts
    - apps/web/src/lib/api.ts
    - apps/web/src/pages/register-page.tsx
    - apps/web/src/pages/login-page.tsx
    - apps/web/src/pages/admin-register-page.tsx
    - apps/web/src/pages/admin-login-page.tsx
  modified:
    - apps/web/src/main.tsx
    - apps/web/src/styles.css
key-decisions:
  - "Browser auth state is split into `tether:web:normalAuth` and `tether:web:managementAuth` so management login never unlocks terminal access."
  - "Normal user session gating validates through `GET /api/auth/me`; invalid local state is cleared and redirected back to `/login`."
  - "Gateway write paths and WS ticket exchange now use bearer tokens from normal auth state instead of the old placeholder shell flow."
patterns-established:
  - "Normal login and registration redirect into the existing terminal shell without redesigning it."
  - "Management auth remains isolated behind `/admin/*` and only unlocks the reserved management placeholder."
requirements-completed: [WEBUI-01, SETUP-01, SETUP-02, SETUP-03, AUTH-01, AUTH-06, AUTH-07]
duration: ~90min
completed: 2026-05-02
---

# Phase 5 Plan 06: Web Registration, Login, Admin Auth Pages, and Authenticated Session Access Summary

**Phase 5 的四个 Web 鉴权页面已经落地，浏览器现在会分别保存 normal 和 management 两套 token，并把现有 terminal shell 收口到 normal auth 后面。**

## Accomplishments

- 新增 `apps/web/src/lib/api.ts`，补齐：
  - normal register/login
  - management register/login
  - `/api/auth/me` normal session validation
  - `/api/token/validate` management session validation
  - Gateway bearer header helper
  - WS ticket bearer 请求封装
- 新增 `apps/web/src/contexts/auth-context.tsx` 和 `apps/web/src/hooks/use-auth.ts`：
  - `localStorage` 分离保存 normal 和 management auth
  - 浏览器启动时自动验证本地 token
  - token 失效时自动清空并退出对应鉴权态
- 新增四个真实鉴权页面：
  - `/register` -> `Create your account`
  - `/login` -> `Sign in`
  - `/admin/register` -> `Set up management console`
  - `/admin/login` -> `Management sign in`
- 更新 `apps/web/src/main.tsx`：
  - 用 `AuthProvider` 包裹应用
  - 移除旧的 placeholder auth shell 状态
  - normal user 访问 `/` 时必须通过 normal auth guard
  - management 登录只解锁 `/admin` 管理侧占位壳，不暴露 terminal control
  - 现有 session shell、stop、send input、ws ticket 获取都改成走 bearer token
  - Relay `client.auth` 优先发送 normal access token，失败时清理 normal 登录态

## Verification

- `pnpm --filter @tether/web typecheck` - passed
- `pnpm --filter @tether/web build` - passed

## Deviations from Plan

- `notification refresh` 这轮只补了 `createNotificationSubscription()` 占位接缝，先把 auth bootstrap 入口留好，未引入真实 server push 通道。
- UI 验收项要求的手工打开 `/register`、`/login`、`/admin/register`、`/admin/login` 与 `05-UI-SPEC.md` 对照，这轮还没做浏览器人工核验。

## Known Stubs

- Web 侧 refresh token 仍未接入自动续期；当前 token 失效后会清理本地状态并要求重新登录。
- management shell 仍是占位页，只负责证明管理鉴权与 normal terminal 鉴权隔离，没有完整管理台功能。

## Uncommitted Change Policy

本轮没有创建 git commit，所有改动仍保留在工作区，供后续 Wave 3/4 一起审阅或分批提交。

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
