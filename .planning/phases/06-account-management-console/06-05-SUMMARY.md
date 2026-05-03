---
phase: 06
plan: 05
subsystem: admin-web
tags: [react, devices, gateways, audit, dialog, shadcn, pagination]
dependency_graph:
  requires:
    - "06-01: admin-web 基础设施（AdminAuthContext, useAdminAuth, admin-api.ts）"
    - "06-03: Devices/Gateways/Audit API 端点（listDevices, revokeDevice, listGateways, unlinkGateway, listAuditEvents）"
    - "06-04: DashboardPage/UsersPage UI 模式（Table, Skeleton, Button 组件）"
  provides:
    - apps/admin-web/src/pages/DevicesPage.tsx（设备管理页，Table + Dialog 确认 + 就地更新状态）
    - apps/admin-web/src/pages/GatewaysPage.tsx（Gateway 管理页，Table + Dialog 确认 + 就地移除行）
    - apps/admin-web/src/pages/AuditPage.tsx（审计日志页，筛选表单 + Table + 内联展开 JSON）
    - apps/admin-web/src/components/ui/dialog.tsx（shadcn Dialog 组件）
    - apps/admin-web/src/components/ui/select.tsx（shadcn Select 组件）
    - apps/admin-web/src/main.tsx（所有 5 个路由完整，PlaceholderPage 已删除）
  affects:
    - apps/admin-web/package.json（添加 @radix-ui/react-dialog, @radix-ui/react-select）
    - pnpm-lock.yaml
tech_stack:
  added:
    - "@radix-ui/react-dialog ^1.1.14"
    - "@radix-ui/react-select ^2.2.5"
    - "shadcn dialog.tsx, select.tsx（相对路径修复）"
  patterns:
    - "Dialog 确认模式：confirmDevice/confirmGateway state 控制 open；revoking/unlinking state disable 按钮防重复提交"
    - "就地更新：setDevices(current => current.map(...)) 避免整页刷新"
    - "就地移除：setGateways(current => current.filter(...)) 确认后立即移除行"
    - "appliedFilters 分离 filter input state（即时响应）和 fetch trigger（查询按钮触发）"
    - "expandedIds: Set<number> 跟踪展开行，React.Fragment 渲染展开内容行"
    - "AuditPage 读取 URL searchParams.get('userId') 支持 UsersPage 跳转"
key_files:
  created:
    - apps/admin-web/src/components/ui/dialog.tsx
    - apps/admin-web/src/components/ui/select.tsx
    - apps/admin-web/src/pages/DevicesPage.tsx
    - apps/admin-web/src/pages/GatewaysPage.tsx
    - apps/admin-web/src/pages/AuditPage.tsx
  modified:
    - apps/admin-web/src/main.tsx
    - apps/admin-web/package.json
    - pnpm-lock.yaml
decisions:
  - "AuditPage 用 Button 触发筛选而不是实时查询 — 避免用户每键入一个字符触发 API 请求"
  - "AuditPage 读取 useSearchParams 获取初始 userId — 支持 UsersPage 「查看事件」按钮跳转，无需额外导航逻辑"
  - "DevicesPage StatusBadge 复用同样的 badge 样式用于操作列的「已吊销」状态 — 一致性"
metrics:
  duration: "~8 min"
  completed_date: "2026-05-03"
  tasks_completed: 2
  files_created: 5
  files_modified: 3
---

# Phase 6 Plan 05: 设备/Gateway/审计页 Summary

## One-liner

DevicesPage/GatewaysPage 带 Dialog 破坏性操作确认（就地更新/移除行）+ AuditPage 带筛选和 payload JSON 内联展开，main.tsx 所有路由替换 PlaceholderPage 完成。

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | 安装 Dialog/Select 组件 + DevicesPage + GatewaysPage | 8cdba5b | dialog.tsx, select.tsx, DevicesPage.tsx, GatewaysPage.tsx, package.json |
| 2 | AuditPage + main.tsx 路由完成 | ff27c5f | AuditPage.tsx, main.tsx |

## Verification Results

- `pnpm typecheck` 通过：无 TypeScript 错误
- DevicesPage.tsx：6 列表格 + Dialog（"吊销设备"/"确认吊销"/"取消"/"此操作不可撤销"）+ 就地 status→revoked 更新 + Skeleton 加载态 + 空态
- GatewaysPage.tsx：4 列表格 + Dialog（"取消链接 Gateway"/"确认取消链接"/"取消"/"该 Gateway 将无法再通过 Relay 发布会话"）+ 就地移除行 + Skeleton 加载态 + 空态
- AuditPage.tsx：筛选栏（userId/action/from/to + 查询/重置）+ 6 列表格 + expandedIds Set 控制 payload JSON 展开 + 分页（50条/页）
- main.tsx：import DevicesPage/GatewaysPage/AuditPage，3 个 PlaceholderPage 已替换，PlaceholderPage 函数已删除，共 6 个路由（含登录页）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 在 worktree 中安装 @radix-ui/react-dialog 和 @radix-ui/react-select 依赖**
- **Found during:** Task 1 — 计划要求 `npx shadcn@latest add dialog select`，但 shadcn CLI 安装到主仓库（非 worktree）
- **Issue:** worktree 的 package.json 没有 `@radix-ui/react-dialog` 和 `@radix-ui/react-select`；TypeScript 无法解析这些模块
- **Fix:** 在 worktree 的 package.json 中手动添加依赖，运行 `pnpm install`；手动创建 dialog.tsx/select.tsx 并修复 `@/lib/utils` 路径为 `../../lib/utils.js`（与 06-04 相同的路径修复模式）
- **Files modified:** apps/admin-web/package.json, pnpm-lock.yaml, dialog.tsx, select.tsx
- **Commit:** 8cdba5b

## Known Stubs

无。所有页面均连接到真实 API 函数（listDevices/revokeDevice/listGateways/unlinkGateway/listAuditEvents），没有硬编码空数据或 mock。

## Threat Surface Scan

无新增 threat surface：
- T-06-05-01/02: revokeDevice/unlinkGateway 均通过 Dialog 确认（loading 状态 disable 按钮防止重复提交）— mitigate 已实现
- T-06-05-03: payload JSON 通过 `JSON.stringify` 展示给管理员（已通过 maskSensitivePayload 过滤）— accept
- T-06-05-04: 筛选参数通过 URL query 传递，服务端使用参数化 SQL — accept

## Self-Check: PASSED
