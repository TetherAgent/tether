---
phase: 06
plan: 04
subsystem: admin-web
tags: [react, dashboard, users-table, shadcn, pagination, audit-link]
dependency_graph:
  requires:
    - "06-01: admin-web 基础设施（AdminAuthContext, useAdminAuth, admin-api.ts, main.tsx）"
    - "06-02: Admin Management API（getDashboardStats, listUsers 端点）"
  provides:
    - apps/admin-web/src/pages/DashboardPage.tsx（4 统计卡片概览页）
    - apps/admin-web/src/pages/UsersPage.tsx（用户表格 + 分页 + 查看事件操作列）
    - apps/admin-web/src/main.tsx（DashboardPage/UsersPage 替换 PlaceholderPage）
    - apps/admin-web/src/components/ui/table.tsx
    - apps/admin-web/src/components/ui/badge.tsx
    - apps/admin-web/src/components/ui/skeleton.tsx
    - apps/admin-web/src/components/ui/pagination.tsx
  affects:
    - apps/admin-web/src/components/ui/button.tsx（扩展 variant/size）
tech_stack:
  added:
    - "lucide-react ^1.14.0（pagination.tsx 图标依赖）"
    - "shadcn table/badge/skeleton/pagination 组件"
  patterns:
    - "useCallback + useEffect 组合控制 fetchUsers 触发时机，page 变化时重新 fetch"
    - "loading/error/empty 三态 UI（Skeleton → 错误+重试 → 空态 → 数据列）"
    - "navigate(/admin/audit?userId=...) 实现用户→审计事件快速跳转（MGMT-06）"
key_files:
  created:
    - apps/admin-web/src/components/ui/table.tsx
    - apps/admin-web/src/components/ui/badge.tsx
    - apps/admin-web/src/components/ui/skeleton.tsx
    - apps/admin-web/src/components/ui/pagination.tsx
    - apps/admin-web/src/pages/DashboardPage.tsx
    - apps/admin-web/src/pages/UsersPage.tsx
  modified:
    - apps/admin-web/src/main.tsx
    - apps/admin-web/src/components/ui/button.tsx
    - apps/admin-web/package.json
    - pnpm-lock.yaml
decisions:
  - "分页控件直接用 Button variant='outline' 而非 shadcn Pagination 组件 — shadcn Pagination 基于 <a> 标签，不适合 state-based 分页；Button 更简洁且类型安全"
  - "DashboardPage 加载前显示破折号占位（'—'）而非 Skeleton — 统计卡片只有 4 个，破折号占位更自然，避免 Skeleton 闪烁"
metrics:
  duration: "~4 min (239s)"
  completed_date: "2026-05-03"
  tasks_completed: 2
  files_created: 6
  files_modified: 4
---

# Phase 6 Plan 04: Dashboard 页 + Users 页 Summary

## One-liner

DashboardPage 4 统计卡片 + UsersPage 7 列用户表格（Skeleton/错误/空态/分页/查看事件操作列），替换 Plan 01 PlaceholderPage，TypeScript 检查通过。

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | shadcn 组件安装 + DashboardPage | 359f01c | table/badge/skeleton/pagination.tsx, DashboardPage.tsx |
| 2 | UsersPage + main.tsx 路由更新 | 40e8b17 | UsersPage.tsx, main.tsx, button.tsx（扩展），shadcn 导入修复 |

## Verification Results

- `pnpm typecheck` 通过：无 TypeScript 错误
- DashboardPage.tsx 包含 `getDashboardStats` 调用 + 4 个统计卡片（已注册用户/活跃设备/注册 Gateway/近 7 天审计事件）
- UsersPage.tsx 包含 `listUsers` 调用 + 7 列表格 + Skeleton 加载态 + 空态 + 分页（上一页/下一页/第N页共M条）+ 「查看事件」按钮（navigate 到 /admin/audit?userId=...）
- main.tsx 已 import DashboardPage/UsersPage 并替换对应路由的 PlaceholderPage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] 扩展 Button 组件增加 outline/ghost/destructive variant 和 size prop**
- **Found during:** Task 2 typecheck
- **Issue:** Plan 01 创建的 Button 只有 `default/secondary` 两个 variant，没有 `size` prop；UsersPage 和 pagination.tsx 需要 `outline/ghost` variant 和 `sm/icon` size
- **Fix:** 在 button.tsx 中增加 `outline/ghost/destructive` variant 和 `default/sm/lg/icon` size；Button render 函数加入 `size` 解构
- **Files modified:** apps/admin-web/src/components/ui/button.tsx
- **Commit:** 40e8b17

**2. [Rule 3 - Blocking] 修复 shadcn 生成组件的 @/ 导入路径**
- **Found during:** Task 2 typecheck
- **Issue:** shadcn CLI 生成的 badge/skeleton/table/pagination.tsx 使用 `@/lib/utils` 和 `@/components/ui/button` 路径；tsconfig.json paths 和 Vite alias 配置为 `@/* → ./src/*`，导致 TypeScript 找不到模块
- **Fix:** 将 4 个文件中的 `@/` 导入改为相对路径（`../../lib/utils.js`、`./button.js`）
- **Files modified:** badge.tsx, skeleton.tsx, table.tsx, pagination.tsx
- **Commit:** 40e8b17

**3. [Rule 3 - Blocking] 安装 lucide-react 并修复 pagination.tsx TS2783**
- **Found during:** Task 2 typecheck
- **Issue:** pagination.tsx 使用 `lucide-react` 图标但未安装；PaginationPrevious/Next 硬编码 `size="default"` 同时展开 `...props`，TypeScript 报 TS2783（属性重复指定）
- **Fix:** `pnpm add lucide-react`；将 `size` 提取到解构参数并设默认值 `size="default"`
- **Files modified:** pagination.tsx, package.json, pnpm-lock.yaml
- **Commit:** 40e8b17

## Known Stubs

- main.tsx 中 `/admin/devices`、`/admin/gateways`、`/admin/audit` 仍使用 PlaceholderPage — 这是计划明确设计的，由 Plan 05 替换

## Threat Surface Scan

无新增 threat surface — DashboardPage/UsersPage 仅读取数据，通过 managementAuth.accessToken 鉴权，userId 经 `encodeURIComponent` 编码后放入 URL query（T-06-04-04 已 mitigate）。

## Self-Check: PASSED
