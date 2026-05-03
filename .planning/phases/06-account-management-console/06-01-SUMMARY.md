---
phase: 06
plan: 01
subsystem: admin-web
tags: [react, vite, shadcn, auth, admin-console]
dependency_graph:
  requires: []
  provides:
    - apps/admin-web pnpm 包（dev 端口 4792）
    - AdminAuthContext + AdminAuthProvider（localStorage tether:web:managementAuth）
    - useAdminAuth hook
    - admin-api.ts（requestJson + listUsers/listAdmins/listDevices/revokeDevice/listGateways/unlinkGateway/listAuditEvents/getDashboardStats）
    - AdminLayout（sidebar 5 项 + header + auth guard + Outlet）
    - AdminLoginPage（react-hook-form + zod）
    - main.tsx（/admin/login 独立路由 + AdminLayout nested routes + catch-all 到 /admin/login）
  affects: []
tech_stack:
  added:
    - "@tether/admin-web: React 19 + Vite 7 + Tailwind 4 + shadcn"
    - "react-router-dom 7 BrowserRouter + Routes"
    - "react-hook-form 7 + zod 4 登录表单验证"
  patterns:
    - "localStorage readStorage/writeStorage 与 apps/web 共享同一 key"
    - "authReady 状态机：mount 时读 localStorage，读完后设 authReady=true"
    - "AdminLayout auth guard：authReady=false 返回 null，无 token Navigate to /admin/login"
    - "登录路由在 AdminLayout 外独立注册，避免无限重定向循环"
key_files:
  created:
    - apps/admin-web/package.json
    - apps/admin-web/vite.config.ts
    - apps/admin-web/tsconfig.json
    - apps/admin-web/index.html
    - apps/admin-web/components.json
    - apps/admin-web/src/styles.css
    - apps/admin-web/src/lib/utils.ts
    - apps/admin-web/src/components/ui/button.tsx
    - apps/admin-web/src/components/ui/card.tsx
    - apps/admin-web/src/components/ui/input.tsx
    - apps/admin-web/src/components/ui/label.tsx
    - apps/admin-web/src/components/ui/form.tsx
    - apps/admin-web/src/contexts/admin-auth-context.tsx
    - apps/admin-web/src/hooks/use-admin-auth.ts
    - apps/admin-web/src/lib/admin-api.ts
    - apps/admin-web/src/components/layout/AdminLayout.tsx
    - apps/admin-web/src/pages/AdminLoginPage.tsx
    - apps/admin-web/src/main.tsx
  modified:
    - pnpm-lock.yaml
decisions:
  - "tsconfig.json 添加 paths: {'@/*': ['./src/*']} — apps/web 未配置此项但 vite 别名靠 vite.config.ts 处理；admin-web 是独立 TS 项目，typecheck 需要 paths 才能解析 @/ 别名"
  - "AdminLayout 使用内联 style 而非纯 Tailwind 类 — 布局宽高固定值（220px sidebar, 52px header）更适合 inline style，避免 Tailwind 自定义宽度 magic number"
  - "AdminAuthContext loginManagement 直接 fetch /api/admin/auth/login，不依赖 admin-api.ts — 登录是 auth context 内部逻辑，保持 context 与 API 层解耦"
metrics:
  duration: "~15 min"
  completed_date: "2026-05-03"
  tasks_completed: 3
  files_created: 18
---

# Phase 6 Plan 01: admin-web 基础设施 Summary

## One-liner

创建 @tether/admin-web 独立 React 应用：Vite+shadcn 配置、management token auth context、AdminLayout（sidebar/header/auth guard）、AdminLoginPage（react-hook-form+zod）、admin-api.ts 请求封装，TypeScript 检查通过无错误。

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1a | 包配置文件层 | 85bd050 | package.json, vite.config.ts, tsconfig.json, styles.css, utils.ts |
| 1b | shadcn UI 组件复制 | c3083d9 | button, card, input, label, form |
| 2 | auth context / layout / pages / main | 52b2302 | admin-auth-context.tsx, AdminLayout.tsx, AdminLoginPage.tsx, admin-api.ts, main.tsx |

## Verification Results

- `pnpm install` 成功：所有依赖安装
- `pnpm typecheck` 通过：无 TypeScript 错误
- AdminLayout 包含 `Navigate replace to="/admin/login"` auth guard
- main.tsx 包含独立 `/admin/login` 路由（在 AdminLayout 外）+ catch-all 重定向到 `/admin/login`
- admin-api.ts 包含 8 个 API 函数（listUsers/listAdmins/listDevices/revokeDevice/listGateways/unlinkGateway/listAuditEvents/getDashboardStats）

## Deviations from Plan

### Auto-added Items

**1. [Rule 2 - Missing] tsconfig.json 添加 paths 别名**
- **Found during:** Task 2 typecheck
- **Issue:** apps/web tsconfig.json 没有 paths，但 admin-web 是独立独立 typecheck 项目，TypeScript 无法解析 `@/` 前缀的 import
- **Fix:** 在 tsconfig.json compilerOptions 添加 `"paths": {"@/*": ["./src/*"]}`
- **Files modified:** apps/admin-web/tsconfig.json
- **Note:** Vite 运行时靠 vite.config.ts 中的 `resolve.alias`；TypeScript 静态检查靠 tsconfig `paths`，两者都需要

**2. [Rule 2 - Enhancement] AdminLayout header 增加退出按钮**
- **Found during:** Task 2 实现
- **Issue:** 计划未明确要求退出按钮，但 header 显示已登录邮箱而无退出方式是不完整的 UX
- **Fix:** header 右侧添加退出按钮，调用 `logoutManagement()`
- **Files modified:** apps/admin-web/src/components/layout/AdminLayout.tsx

## Known Stubs

| File | Description |
|------|-------------|
| apps/admin-web/src/main.tsx | PlaceholderPage 组件用于 /admin/dashboard、/admin/users、/admin/devices、/admin/gateways、/admin/audit — 这些占位页面将由 Plan 04/05 替换 |

这些占位是计划明确设计的（plan 原文注释），不影响本 plan 的目标（基础设施可运行）。

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: auth_endpoint | admin-auth-context.tsx | POST /api/admin/auth/login — 在 STRIDE 威胁模型 T-06-01-05 中已记录，zod 校验 email 格式，服务端验证密码 |
| threat_flag: token_storage | admin-auth-context.tsx | localStorage 存储 management token — T-06-01-03 标记为 accept，JWT 签名由服务端验证，客户端篡改不影响服务端授权 |

## Self-Check: PASSED

- 18 个创建文件全部存在（FOUND）
- 3 个提交哈希全部存在（85bd050, c3083d9, 52b2302）
- pnpm typecheck 通过无 TS 错误
