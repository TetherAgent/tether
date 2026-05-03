---
phase: 06
plan: 03
subsystem: server-api
tags: [admin-api, devices, gateways, audit, revoke, storage]
dependency_graph:
  requires:
    - "06-02"
  provides:
    - GET /admin/api/devices
    - POST /admin/api/devices/:id/revoke
    - GET /admin/api/gateways
    - DELETE /admin/api/gateways/:id/unlink
    - GET /admin/api/audit (with userId/action/deviceId/gatewayId/from/to filters)
  affects:
    - apps/server/app/service/storage.ts
    - apps/server/app/router/admin.ts
tech_stack:
  added: []
  patterns:
    - MySQL/内存双模式（if mysqlModeEnabled() 分支）
    - revokeDeviceById 后立即 revokeRefreshTokensByDeviceId（原子性保证已吊销设备无法刷新 token）
    - loadAuditEventsFiltered 动态 WHERE 拼接（conditions 数组 + values 数组）
    - limit = Math.min(100/200, ...) 防止超大查询（设备/gateway 100, audit 200）
key_files:
  created:
    - apps/server/app/service/admin/devices.ts
    - apps/server/app/service/admin/gateways.ts
    - apps/server/app/service/admin/audit.ts
    - apps/server/app/controller/admin/devices.ts
    - apps/server/app/controller/admin/gateways.ts
    - apps/server/app/controller/admin/audit.ts
  modified:
    - apps/server/app/service/storage.ts
    - apps/server/app/router/admin.ts
decisions:
  - "revokeRefreshTokensByDeviceId 使用 revoked_at IS NULL/SET revoked_at=NOW() 而非 revoked=TRUE，因为 refresh_tokens 表无布尔 revoked 列"
  - "内存模式设备吊销实现为 store.devices.delete() 而非修改字段（DeviceRecord 无 revokedAt 字段）"
  - "loadAllDevices 过滤 token_class = 'normal_client_access' 排除非用户设备"
metrics:
  duration: ~180s
  completed: "2026-05-03"
  tasks_completed: 2
  files_created: 6
  files_modified: 2
---

# Phase 6 Plan 03: Devices/Gateways/Audit Admin API Summary

设备管理、Gateway 管理和审计日志查询端点完整实现，含设备吊销时同步撤销所有 active refresh tokens，防止已吊销设备继续刷新 token；审计支持 deviceId/gatewayId 筛选维度。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | storage.ts 追加设备/Gateway/审计批量查询函数 | be365d2 | service/storage.ts (+135 lines) |
| 2 | devices/gateways/audit service + controller + 路由注册 | e57b93d | 6 new files, router/admin.ts updated |

## What Was Built

**apps/server/app/service/storage.ts** (追加 9 个函数)

设备相关：
- `loadAllDevices(limit, offset)` — LEFT JOIN users 返回含 userEmail + revokedAt 的分页设备列表，过滤 `normal_client_access`
- `countDevices()` — 设备总数（同样过滤 `normal_client_access`）
- `revokeDeviceById(id)` — `UPDATE devices SET revoked_at = NOW(), updated_at = NOW()`
- `revokeRefreshTokensByDeviceId(deviceId)` — 撤销该设备所有 `revoked_at IS NULL` 的 refresh tokens

Gateway 相关：
- `loadAllGateways(limit, offset)` — 分页 gateway 列表
- `countGateways()` — gateway 总数
- `deleteGatewayById(id)` — `DELETE FROM gateways WHERE id = ?`

审计相关：
- `loadAuditEventsFiltered(params)` — 动态条件筛选，支持 userId/eventType/deviceId/gatewayId/fromMs/toMs/limit/offset
- `countAuditEventsFiltered(params)` — 相同筛选条件的总数统计

**apps/server/app/service/admin/devices.ts**
- `listAdminDevices(_config, page, limit)` — 返回含 userEmail/status(active|revoked)/lastSeenAt 的设备列表
- `revokeAdminDevice(deviceId, adminUserId, accountId, workspaceId)` — 吊销设备 + 撤销所有 active refresh tokens + 记录 `admin.device.revoked` 审计事件

**apps/server/app/service/admin/gateways.ts**
- `listAdminGateways(_config, page, limit)` — 返回 id/lastSeenAt/status 的分页 gateway 列表
- `unlinkAdminGateway(gatewayId, adminUserId, accountId, workspaceId)` — 删除 gateway 记录 + 记录 `admin.gateway.unlinked` 审计事件

**apps/server/app/service/admin/audit.ts**
- `listAdminAuditEvents(_config, params)` — 支持 userId/action/deviceId/gatewayId/from/to 筛选，MySQL 模式调用 storage 过滤函数，内存模式做 Array.filter

**apps/server/app/controller/admin/devices.ts** — AdminDevicesController
- `index()` — GET /admin/api/devices，requireManagementToken + 分页
- `revoke()` — POST /admin/api/devices/:id/revoke，not_found 返回 404

**apps/server/app/controller/admin/gateways.ts** — AdminGatewaysController
- `index()` — GET /admin/api/gateways
- `unlink()` — DELETE /admin/api/gateways/:id/unlink，not_found 返回 404

**apps/server/app/controller/admin/audit.ts** — AdminAuditController
- `index()` — GET /admin/api/audit，透传全部筛选参数，limit 上限 200

**apps/server/app/router/admin.ts** — 追加 5 条路由，替换 "Plan 03 will add" 占位注释

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] revokeRefreshTokensByDeviceId SQL 列名修正**
- **Found during:** Task 1 实现 revokeRefreshTokensByDeviceId 时
- **Issue:** 计划文档中 SQL 使用 `revoked = TRUE`，但 refresh_tokens 表无布尔 `revoked` 列；该表使用 `revoked_at DATETIME DEFAULT NULL` 来标记撤销状态
- **Fix:** SQL 改为 `UPDATE refresh_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE device_id = ? AND revoked_at IS NULL`
- **Files modified:** apps/server/app/service/storage.ts
- **Commit:** be365d2

**2. [Rule 1 - Bug] 内存模式 revokeAdminDevice 实现调整**
- **Found during:** Task 2 实现 revokeAdminDevice 内存分支时
- **Issue:** 计划代码用 `{ ...device, revokedAt: Date.now() }` 但 `DeviceRecord` type 无 `revokedAt` 字段，TS 会报错；且 `as typeof device` 强转也不正确
- **Fix:** 内存模式改为 `store.devices.delete(deviceId)`，语义等同"已吊销"（内存 store 不持久化，测试/开发用途）
- **Files modified:** apps/server/app/service/admin/devices.ts
- **Commit:** e57b93d

## Security Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-06-03-01 | requireManagementToken + loadDeviceById 存在性检查 + revokeDeviceById + revokeRefreshTokensByDeviceId + audit event |
| T-06-03-02 | requireManagementToken + loadGatewayById 存在性检查 + deleteGatewayById + audit event |
| T-06-03-03 | recordAuditEvent 已通过 maskSensitivePayload 过滤敏感字段，查询无需额外处理 |
| T-06-03-04 | audit controller 强制 limit = Math.min(200, ...) |
| T-06-03-05 | revokeAdminDevice 和 unlinkAdminGateway 成功后均调用 recordAuditEvent |
| T-06-03-06 | revokeAdminDevice 在 revokeDeviceById 后立即调用 revokeRefreshTokensByDeviceId |

## Known Stubs

- 内存模式 `listAdminDevices` 的 `userEmail` 始终为 `null`，`lastSeenAt` 始终为 `null` — 内存 store 不维护 JOIN 关系。MySQL 模式正常返回真实数据。这是设计意图：开发/测试用内存模式，生产用 MySQL。

## Threat Flags

无新增 threat surface — 所有 5 条新路由均通过 requireManagementToken 鉴权，未引入未鉴权的新路由。

## Self-Check: PASSED

所有 6 个新建文件均已确认存在磁盘上。
两条任务 commit（be365d2, e57b93d）已确认在 git log 中。
pnpm typecheck 通过，退出码 0。
