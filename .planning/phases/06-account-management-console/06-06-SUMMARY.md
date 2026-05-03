---
phase: "06"
plan: "06-06"
subsystem: apps/admin-web
tags: [admin-ui, auth, register, jwt, identity]
dependency_graph:
  requires: ["06-05"]
  provides: ["admin-register-page", "jwt-identity-parsing"]
  affects: ["apps/admin-web/src/pages", "apps/admin-web/src/lib", "apps/admin-web/src/contexts"]
tech_stack:
  added: []
  patterns: ["JWT base64url decode via atob", "react-hook-form + zod register form"]
key_files:
  created:
    - apps/admin-web/src/pages/AdminRegisterPage.tsx
  modified:
    - apps/admin-web/src/lib/admin-api.ts
    - apps/admin-web/src/main.tsx
    - apps/admin-web/src/contexts/admin-auth-context.tsx
decisions:
  - "JWT payload does not contain email field (only adminUserId/accountId/workspaceId/deviceId); AdminLayout continues to display adminUserId as identity label"
  - "BLOCKER 3 (SC-4 role differentiation) intentionally deferred per D-13/D-14: v0.3 uses single management access level, no role-based UI"
metrics:
  duration_minutes: 2
  completed_date: "2026-05-03"
  tasks_completed: 3
  tasks_total: 3
---

# Phase 06 Plan 06: 管理员注册页 + 登录后身份信息填充 Summary

**One-liner:** AdminRegisterPage with email/password/confirm form + JWT payload parsing in loginManagement to populate identity field, closing BLOCKER 1 (SC-2) and BLOCKER 2 (SC-3).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 06-06-01 | 添加 createAdmin API 函数 + 创建 AdminRegisterPage | bd23f89 | apps/admin-web/src/lib/admin-api.ts, apps/admin-web/src/pages/AdminRegisterPage.tsx |
| 06-06-02 | 在 main.tsx 注册 /admin/register 路由 | 5d3c7c7 | apps/admin-web/src/main.tsx |
| 06-06-03 | 修复 loginManagement：解析 JWT payload 填充 identity 字段 | 48e7954 | apps/admin-web/src/contexts/admin-auth-context.tsx |

## What Was Built

### BLOCKER 1 Fix (SC-2): Admin Registration UI

- **`apps/admin-web/src/pages/AdminRegisterPage.tsx`** — New page with email/password/confirmPassword form using react-hook-form + zod. Zod schema enforces email format, password >= 8 chars, and password match. On submit, calls `createAdmin(managementAuth.accessToken, { email, password })` — requires existing logged-in admin. Error handling maps `email_already_registered` to human-readable message. Includes link to `/admin/login`.

- **`apps/admin-web/src/lib/admin-api.ts`** — Added `createAdmin()` function calling `POST /admin/api/admins` with body `{ email, password, displayName?, deviceName: 'admin-web', platform: 'web' }`. Aligns with `AdminAdminsController.create` server expectations.

- **`apps/admin-web/src/main.tsx`** — Added `import { AdminRegisterPage }` and `<Route path="/admin/register" element={<AdminRegisterPage />} />` alongside `/admin/login`, outside `<Route element={<AdminLayout />}>` to avoid auth guard redirect loop for unauthenticated registration visits.

### BLOCKER 2 Fix (SC-3): JWT Identity Parsing

- **`apps/admin-web/src/contexts/admin-auth-context.tsx`** — Added `decodeJwtPayload()` utility that splits JWT, base64url-decodes the payload segment via `atob()`, and returns parsed JSON. Modified `loginManagement` to call `decodeJwtPayload(body.accessToken)` after successful login, build a `ManagementIdentity` object from `adminUserId/accountId/workspaceId/exp/jti`, and include it in the stored `AuthStorageRecord`. If parsing fails, `identity` is `undefined` — login still succeeds.

- **JWT payload observation:** Server's `managementTokenPayload()` includes `adminUserId`, `accountId`, `workspaceId`, `deviceId` but NOT `email`. Therefore `AdminLayout`'s `managementAuth.identity?.adminUserId` will now show a real UUID (previously always empty string). No change needed to AdminLayout display logic.

## Deviations from Plan

None - plan executed exactly as written.

The plan's "if JWT payload contains email" conditional update to AdminLayout was evaluated: JWT does not contain email, so AdminLayout was not modified. This is expected behavior, not a deviation.

## Not Addressed

**BLOCKER 3 (SC-4)** — Role-based UI differentiation between `super_admin` and `admin` is intentionally deferred per CONTEXT.md D-13/D-14. v0.3 uses a single management access level; login grants full management access regardless of role. The `role` field is stored in DB and audit events but not enforced in UI.

## Self-Check

### Created files exist

- [x] `apps/admin-web/src/pages/AdminRegisterPage.tsx` — confirmed present
- [x] `apps/admin-web/src/lib/admin-api.ts` — modified, createAdmin function added
- [x] `apps/admin-web/src/main.tsx` — /admin/register route added
- [x] `apps/admin-web/src/contexts/admin-auth-context.tsx` — decodeJwtPayload + identity filling added

### Commits exist

- [x] bd23f89 — feat(06-06): add createAdmin API function + AdminRegisterPage component
- [x] 5d3c7c7 — feat(06-06): register /admin/register route outside AdminLayout
- [x] 48e7954 — fix(06-06): parse JWT payload in loginManagement to populate identity field

## Self-Check: PASSED
