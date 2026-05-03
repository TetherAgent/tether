# Tether Admin Web 前端规范

本文件约束 `apps/admin-web`。根级长期事实见 `../../AI_CONTEXT.md`，共享编码原则见
`../../CLAUDE.md`。

`apps/admin-web` 是唯一管理后台入口。普通用户会话控制台在 `apps/web`。

## 文档维护规则

以下变更完成后必须同步更新本文或对应长期文档：

| 操作 | 需要更新 |
| --- | --- |
| 新增、删除或改名管理路由 | 本文「路由规范」和 `src/routes.tsx` |
| 新增或修改可见文案 | i18n 文案目录；不得继续散落硬编码 |
| 新增后台布局模式 | 本文「布局模式」 |
| 新增基础 UI 组件或 token 使用约束 | `../../packages/design` / `../../packages/theme` 相关文档 |
| 发现新的 Admin Web 反模式 | 本文「反模式速查」 |

不得只改代码、不回写规范。

## 技术栈

- 框架：React + TypeScript + Vite
- 样式：Tailwind CSS v4 + CSS 自定义属性 token
- 基础组件：`@tether/design`
- 路由：`src/routes.tsx` 是路由事实源，禁止把新路由继续堆到 `main.tsx`
- 认证：`AdminAuthProvider` + `useAdminAuth()`
- API：`src/lib/admin-api.ts`
- 多语言：`src/i18n/messages.ts` + `useAdminI18n()`；所有新增页面必须默认支持中文 / English，当前存量列表页硬编码文案属于待迁移债务
- 主题：`UiPreferencesProvider` 控制 `<html class="dark">`；所有新增页面必须默认支持 light / dark

## 目录规范

```text
src/main.tsx                    应用启动、Provider、全局事件接线
src/routes.tsx                  路由事实源
src/pages/                      管理后台页面入口
src/components/layout/          AdminLayout 和导航框架
src/components/console/         管理登录壳、页面框架等业务组件
src/components/ui/              app 内 form glue；可共享基础组件应上移到 packages/design
src/contexts/                   管理认证 context
src/hooks/                      context hook 和 app hook
src/i18n/messages.ts            中英文文案表
src/lib/admin-api.ts            管理 API 客户端
src/styles.css                  app 专属布局样式；基础 token 不在这里定义
```

### 文件命名规范

- 新增文件统一使用 **kebab-case**：`dashboard-page.tsx`、`admin-auth-shell.tsx`、
  `use-i18n.ts`。
- React 组件导出仍使用 **PascalCase**：`DashboardPage`、`AdminAuthShell`。
- Hook 文件用 `use-*.ts`，hook 导出用 camelCase：`useAdminI18n`。
- Context 文件用 `*-context.tsx`。
- 路由页面文件用 `*-page.tsx`。
- 禁止新增 PascalCase 文件名；当前前端 app 文件名应保持 kebab-case。

## 路由规范

当前 `apps/admin-web` 路由事实源是 `src/routes.tsx`：

| 路由 | 说明 |
| --- | --- |
| `/admin/login` | 管理员登录 |
| `/admin/register` | 管理账户创建入口 |
| `/admin/dashboard` | 管理概览 |
| `/admin/users` | 用户管理 |
| `/admin/devices` | 设备管理 |
| `/admin/gateways` | Gateway 管理 |
| `/admin/audit` | 审计日志 |

规则：

- 登录/注册页必须在 `AdminLayout` 外，避免 auth guard 循环重定向。
- 受保护页面必须放在 `AdminLayout` 下，由 layout 统一处理鉴权。
- catch-all 统一跳 `/admin/login`。
- `apps/web` 不承载 admin 页面；不要跨 app 复制后台路由。

## i18n 规范

- `apps/admin-web` 默认所有页面都必须支持中文 / English，不允许新增单语言页面。
- 新增或修改可见文案必须进入 `src/i18n/messages.ts`，再通过 `useAdminI18n()` 获取。
- 页面标题、导航项、表格列名、按钮、toast、空态、错误文案都属于 i18n 范围。
- 禁止新增页面级双语 map 或散落硬编码文案。
- 当前存量中文硬编码页面在后续 UI 文案改造中逐步迁移，不允许继续扩大债务。

## Token 与样式规范

- 主题入口是 `@tether/theme/globals.css`，由 `src/styles.css` import。
- `apps/admin-web` 默认所有页面都必须同时支持 light / dark；新增页面、表格、筛选区、空态和弹窗都要在两种主题下可读。
- 页面框架必须提供主题切换入口；复用 `ThemeToggle`，不要另写主题按钮视觉。
- 公共 token 只维护在 `packages/theme`；app 层不得定义新的品牌色、文字色、阴影体系。
- 使用 shadcn 扁平 token utility：`bg-card`、`text-foreground`、`border-input`、
  `text-foreground-tertiary` 等。
- 禁止 `bg-bg-*`、`text-text-*`、`border-border-*`、`ring-border-*` 双前缀写法。
- 管理后台是操作型产品，视觉必须克制、密度适中，避免营销式 hero、装饰性大卡片和大面积品牌渐变。
- 品牌色只用于当前导航、主 CTA、关键状态和 focus ring。

## 组件规范

| 场景 | 必用组件 | 禁止 |
| --- | --- | --- |
| 按钮 | `Button` | 手写 button 样式 |
| 图标 | `lucide-react` | 手写 SVG |
| 文本输入 | `Input` | 裸 `<input>` |
| 信息提示 | `InfoBlock` / `Alert` | 散装 rounded border div |
| 数据表格 | `Table` / `DataTable` 能力 | 裸 table 且不走 token |
| 弹窗确认 | `Dialog` / `AlertDialog` | `window.confirm()` |
| 操作反馈 | `toast` | `alert()` |
| 页面框架 | `AdminLayout` / `AdminPageFrame` | 页面重复拼导航、标题和容器 |

可复用的基础交互模式必须先考虑上移到 `packages/design/src/`，不要在
`apps/admin-web` 复制一套组件库。

## 布局模式

### 模式 A：Auth Shell

适用：`/admin/login`、`/admin/register`。

- 由 `AdminAuthShell` 统一承载。
- 文案强调管理边界，不暗示可直接接管终端控制。
- 登录和注册页不进入 `AdminLayout`。

### 模式 B：Admin Layout

适用：所有受保护后台页面。

- `AdminLayout` 统一导航、鉴权、退出和页面外壳。
- 页面标题和说明由 layout 或 `AdminPageFrame` 统一呈现。
- 页面不要重复实现侧边栏和顶部身份信息。

### 模式 C：Data Management Page

适用：用户、设备、Gateway、审计。

- 搜索/筛选在表格上方。
- destructive 操作必须有二次确认。
- 表格列名、空态、loading、错误都要走统一组件和 i18n。

## 反模式速查

| 禁止行为 | 正确做法 |
| --- | --- |
| 在 `main.tsx` 继续堆路由 | 改 `src/routes.tsx` |
| 新增 PascalCase 文件名 | 新文件统一 kebab-case |
| 登录页放进 `AdminLayout` | 登录/注册页保持 layout 外 |
| 页面硬编码新文案 | 放进 i18n 文案目录 |
| 页面重复拼后台导航 | 用 `AdminLayout` |
| 页面重复拼标题区域 | 用 `AdminPageFrame` |
| 用普通用户 token 调后台 API | 只用 `management_access` |
| 管理后台做营销风 hero | 做密集、清晰、可扫描的操作界面 |

## 验证

Admin Web 改动至少执行：

```bash
pnpm --filter @tether/admin-web typecheck
```

影响构建、路由、i18n 或样式时执行：

```bash
pnpm --filter @tether/admin-web build
```
