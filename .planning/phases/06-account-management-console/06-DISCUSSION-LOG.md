# Phase 6: Account Management Console - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 06-account-management-console
**Areas discussed:** 控制台布局和导航, Server API 边界, 角色权限可见性, 设备和 Gateway 管理 UX

---

## 控制台布局和导航

| Option | Description | Selected |
|--------|-------------|----------|
| 左侧边栏 + 顶部标题栏 | 左边导航菜单，顶部显示页面标题和登录账号 | ✓ |
| 顶部标签页导航 | 所有管理页共用顶部 Tab 切换 | |
| 不带全局导航，每页独立 | 各管理页自带面包屑和返回链接 | |

**User's choice:** 左侧边栏 + 顶部标题栏

| Option | Description | Selected |
|--------|-------------|----------|
| /admin/* 前缀统一路由 | 与现有 /admin/login + /admin/register 保持一致 | ✓ |
| /console/* 前缀 | 与普通用户路由区分更清晰 | |

**User's choice:** /admin/* 前缀

| Option | Description | Selected |
|--------|-------------|----------|
| 5 项：概览/用户/设备/Gateway/审计 | 直接对应 ROADMAP 成功标准 | ✓ |
| 6 项：加上设置页 | 额外包含 super_admin 的系统/安全设置入口 | |

**User's choice:** 5 项

| Option | Description | Selected |
|--------|-------------|----------|
| React Router 嵌套路由 + AdminLayout 组件 | 所有 /admin/* 页面共用一个 wrapper | ✓ |
| 每个页面独立引入 sidebar 组件 | 无嵌套路由，各页面自行引入 | |

**User's choice:** React Router 嵌套路由 + AdminLayout

---

## Server API 边界

| Option | Description | Selected |
|--------|-------------|----------|
| apps/server 内新增 /admin/api/* 路由组 | 与现有 Egg 服务共进程，通过 management token 鉴权 | ✓ |
| 独立的 apps/admin-server | 单独起一个管理端服务 | |

**User's choice:** apps/server 内新增 /admin/api/*

**Notes:** 用户追问 Web 代码组织方案。Claude 建议在 apps/web 内分层（pages/admin/、components/admin/），用户明确表示要放新仓库。进一步确认后：
- 新建 `apps/admin-web`（monorepo 内新包，非独立 Git 仓库）
- 技术栈：React + Vite + shadcn（与 apps/web 相同）
- 共享 `packages/` 中的类型和协议定义
- 独立调用 apps/server /admin/api/*

API 范围（用户多选确认）：用户+登录分析、设备管理、Gateway 管理、审计+管理员管理。

---

## 角色权限可见性

| Option | Description | Selected |
|--------|-------------|----------|
| 隐藏—不展示入口 | admin 登录后根本看不到 super_admin 专属功能 | ✓ |
| 灰化 + tooltip | 入口展示但灰化，悬停提示"需要 super_admin 权限" | |

**User's choice:** 隐藏

**Notes:** 用户随后提出："管理后台是不是一个权限就行（能登录就能操作全部）？"

Claude 建议简化为单一访问级别，理由：单人项目、spare time 开发、实际无多管理员场景。用户确认采纳。

**最终决策（简化）：** v0.3 能登录=全权限，super_admin/admin 区分保留在数据库但 UI 不做差异化，后续版本再补。

---

## 设备和 Gateway 管理 UX

| Option | Description | Selected |
|--------|-------------|----------|
| 对话框确认 | 点击操作后弹出确认对话框，确认后才请求 API | ✓ |
| 直接操作无确认 | 点击即执行，无二次确认 | |

**User's choice:** 对话框确认

| Option | Description | Selected |
|--------|-------------|----------|
| 就地更新列表 | API 成功后直接从列表移除该条目 | ✓ |
| 全页刷新 | 操作后重新拉取列表数据 | |

**User's choice:** 就地更新列表

| Option | Description | Selected |
|--------|-------------|----------|
| 设备名/类型/在线状态/最后在线/吊销按钮 | 最少必要字段，不展示通知 WS 状态 | ✓ |
| 包含通知 WebSocket 在线状态 | 展示设备 WS 连接状态（数据源不可靠） | |

**User's choice:** 设备名/类型/在线状态/最后在线/吊销按钮

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway ID/最后认证时间/在线状态/取消链接按钮 | 数据全部来自 apps/server 注册记录 | ✓ |
| 加上实时健康探测 | Server 实时请求 Gateway HTTP，展示实际响应状态 | |

**User's choice:** 不做实时探测，数据来自 Server 注册记录

---

## Claude's Discretion

- shadcn 组件选型（table、dialog、sidebar、header 具体用哪些 primitive）
- 列表分页大小
- 确认对话框中文措辞
- apps/admin-web 是否复用 apps/web 的 Vite/tsconfig 模板
- /admin/api/* 各接口的具体字段名和响应结构

## Deferred Ideas

- super_admin vs admin UI 差异化（菜单隐藏/灰化、权限标识）
- 通知 WebSocket 设备在线状态实时展示
- 系统/安全设置页面（ROADMAP 列为 super_admin 功能）
- Gateway 实时健康探测
- 多工作区支持（Phase 10）
