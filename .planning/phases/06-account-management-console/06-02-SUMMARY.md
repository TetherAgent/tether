---
phase: 06
plan: 02
subsystem: server-api
tags: [admin-api, management-console, auth-middleware, storage, controllers]
dependency_graph:
  requires: []
  provides:
    - requireManagementToken middleware
    - /admin/api/users endpoint
    - /admin/api/admins CRUD endpoints
    - /admin/api/dashboard/stats endpoint
  affects:
    - apps/server/app/router.ts
tech_stack:
  added: []
  patterns:
    - MySQL/内存双模式（if mysqlModeEnabled() 分支）
    - requireManagementToken 在每个 controller 方法首行调用
    - service 层不返回 passwordHash 字段（T-06-02-04）
    - limit = Math.min(100, ...) 防止超大查询（T-06-02-05）
key_files:
  created:
    - apps/server/app/middleware/admin-auth.ts
    - apps/server/app/service/admin/users.ts
    - apps/server/app/service/admin/admins.ts
    - apps/server/app/controller/admin/users.ts
    - apps/server/app/controller/admin/admins.ts
    - apps/server/app/router/admin.ts
  modified:
    - apps/server/app/service/storage.ts
    - apps/server/app/router.ts
decisions:
  - "auth.login.succeeded 是 storage 中正确的事件类型（非计划文档中 auth.login.success）"
  - "DeviceRecord 无 revokedAt 字段，内存模式 activeDevices 统计全部设备数"
metrics:
  duration: 173s
  completed: "2026-05-03"
  tasks_completed: 2
  files_created: 6
  files_modified: 2
---

# Phase 6 Plan 02: Admin Management API Base Layer Summary

Management API 基础层：requireManagementToken 中间件 + storage 批量查询 + dashboard/users/admins 端点，所有路由统一鉴权 management_access token。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | admin-auth 中间件 + storage.ts 批量查询函数 | a9421a9 | middleware/admin-auth.ts, service/storage.ts (+88 lines) |
| 2 | users/admins service + controller + admin router 注册 | a9f6658 | 6 new files, router.ts updated |

## What Was Built

**apps/server/app/middleware/admin-auth.ts**
- `requireManagementToken(headerValue, config)` — 包装 `requireTokenClass(['management_access'])`，JWT 验证由 `verifyToken` 保证，token class 不匹配返回 `wrong_token_class` 错误（由 controller 转成 401）

**apps/server/app/service/storage.ts** (追加)
- `loadAllUsers(limit, offset)` — 分页获取普通用户列表
- `countUsers()` — 用户总数
- `loadAllAdminUsers(limit, offset)` — 分页获取管理用户列表
- `countActiveDevices()` — 活跃设备数（revoked_at IS NULL）
- `countRegisteredGateways()` — 注册 gateway 总数
- `countAuditEventsLast7Days()` — 近 7 天审计事件数
- `loadUserLoginStats(userId)` — 用户登录次数、失败次数、最后登录时间
- `countActiveDevicesByUserId(userId)` — 单用户活跃设备数
- `deleteAdminUserById(id)` — 删除管理用户

**apps/server/app/service/admin/users.ts**
- `listAdminUsers(_config, page, limit)` — MySQL 模式返回含登录分析的分页用户列表；内存模式返回基础字段（login stats 占位 0）
- `getDashboardStats(_config)` — 4 项统计：totalUsers, activeDevices, registeredGateways, auditEventsLast7Days

**apps/server/app/service/admin/admins.ts**
- `listAdminManagers(_config)` — 列出所有管理用户（不含 passwordHash）
- `deleteAdminManager(id, adminUserId, accountId, workspaceId)` — 删除并记录 `admin.admin_user.deleted` 审计事件

**apps/server/app/controller/admin/users.ts** — AdminUsersController
- `index()` — GET /admin/api/users，鉴权 + 分页参数 + limit 上限 100
- `dashboard()` — GET /admin/api/dashboard/stats

**apps/server/app/controller/admin/admins.ts** — AdminAdminsController
- `index()` — GET /admin/api/admins
- `create()` — POST /admin/api/admins（调用 registerManagementUser）
- `destroy()` — DELETE /admin/api/admins/:id

**apps/server/app/router/admin.ts** — 注册全部 /admin/api/* 路由

**apps/server/app/router.ts** — import adminRouter 并在末尾调用 adminRouter(app)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 修正 audit 事件类型名称**
- **Found during:** Task 1 实现 loadUserLoginStats 时
- **Issue:** 计划文档中使用 `auth.login.success`，但 auth.ts 中实际记录的事件是 `auth.login.succeeded`
- **Fix:** storage.ts 中 `loadUserLoginStats` 查询使用 `auth.login.succeeded` 以与实际数据匹配
- **Files modified:** apps/server/app/service/storage.ts
- **Commit:** a9421a9

**2. [Rule 2 - Correctness] 内存模式 activeDevices 计数**
- **Found during:** Task 2 实现 getDashboardStats 时
- **Issue:** 计划使用 `[...store.devices.values()].filter(d => !d.revokedAt)` 但 DeviceRecord 类型没有 revokedAt 字段
- **Fix:** 内存模式直接使用 `store.devices.size`（内存 store 不追踪设备撤销状态）
- **Files modified:** apps/server/app/service/admin/users.ts
- **Commit:** a9f6658

## Security Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-06-02-01 | requireManagementToken 在每个 controller 方法首行调用，token class 不匹配抛 wrong_token_class → 401 |
| T-06-02-02 | POST /admin/api/admins 在 create() 首行验证 management_access token |
| T-06-02-03 | destroy() 验证 token 并记录 admin.admin_user.deleted 审计事件 |
| T-06-02-04 | service 层 map 函数只返回 id/email/createdAt/stats，不含 passwordHash |
| T-06-02-05 | limit = Math.min(100, Math.max(1, Number(query.limit ?? '20'))) |

## Known Stubs

- 内存模式下 `listAdminUsers` 的 `loginCount/failedLoginCount/lastLoginAt/activeDeviceCount` 均为 0/null — 内存 store 不维护审计事件索引，MySQL 模式正常返回真实数据。这是设计意图：测试/开发环境使用内存模式，生产环境使用 MySQL。

## Threat Flags

无新增 threat surface — 所有端点均通过 requireManagementToken 鉴权，未引入未鉴权的新路由。

## Self-Check: PASSED

All 6 created files confirmed present on disk.
Both task commits (a9421a9, a9f6658) confirmed in git log.
TypeCheck passes with exit code 0.
