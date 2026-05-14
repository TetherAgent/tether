# 前端开发规范

本文件是 `tether` 仓库级前端规范，适用于：

- `apps/web`
- `apps/admin-web`
- `packages/design`
- `packages/theme`

## 0. 相关规范入口

前端规范按层级阅读：

1. 本文件：仓库级前端边界和验证要求。
2. `apps/web/CLAUDE.md` / `apps/admin-web/CLAUDE.md`：具体 app 的路由、目录、文案和页面实现规则。
3. `packages/design/CLAUDE.md`：共享 UI primitive 的组件 API、导出、状态和 authoring 规则。
4. `packages/theme/SPEC.md`：主题 token、Tailwind utility、颜色/字号/行高准入规则。

当规则冲突时，组件实现以 `packages/design/CLAUDE.md` 为准；token 和 utility
以 `packages/theme/SPEC.md` 为准。

## 1. 设计系统优先

- 设计 token 必须定义在共享 `packages/theme` 中，app 不得各自再起一套基础 token。
- 基础 UI 组件必须定义在共享 `packages/design` 中，app 不得继续维护等价的本地基础组件副本。
- 页面优先复用共享组件，不在页面层重复拼 `button`、`input`、`dialog`、`table`、`card`、`badge`、`skeleton` 等基础控件。
- 修改共享组件 API、主题 token 或全局样式入口后，必须同步验证 `apps/web` 和 `apps/admin-web`。

## 2. 共享层与 app 层边界

放进 `packages/design`：

- 基础输入控件
- 基础展示容器
- 通用弹窗 primitive
- 通用表格 primitive
- badge、skeleton、empty、spinner、page-header、sidebar 这类跨 app 公共模式

留在 app 层：

- 业务布局
- 页面路由壳子
- 表单 schema 和业务字段编排
- 业务状态渲染
- 依赖具体接口语义的页面组件

`react-hook-form` 适配层可以保留在 app 层，但底层视觉必须消费共享 `packages/design` 和 `packages/theme`。

## 3. Token 使用

- app 级样式文件只负责引入共享 theme 和少量业务样式，不得重新定义整套基础颜色、字号、圆角、阴影 token。
- 禁止在页面层硬编码基础视觉值，例如 `#101214`、`text-[12px]`、`rounded-[10px]`。
- 禁止继续在 app 全局样式中沉淀 header、nav、card、button 等基础视觉，这些应进入共享组件或局部业务样式。
- 主题切换、字体、背景、边框、交互色统一走共享 token。

## 4. 页面实现规则

- 优先使用 className 和共享语义组件，不继续大面积使用 `style={{ ... }}` 手搓基础布局和视觉。
- `apps/admin-web` 的控制台骨架、侧栏、头部、卡片、表格状态块应优先收口到共享样式体系。
- `apps/web` 和 `apps/admin-web` 视觉必须保持同一设计语言，不能各自漂移。
- 共享组件不足时，先补共享层，再由页面消费；不要先在 app 内复制一份近似组件。

## 5. 响应式与交互

- 移动端和窄屏页面优先使用 CSS 响应式 class 处理布局。
- 所有交互元素必须具备 `hover`、`active`、`focus-visible`、`disabled` 状态。
- 表格、列表、卡片异步加载必须提供结构化 loading UI，不允许纯空白等待。

## 6. 验证

前端改动至少执行：

- `pnpm typecheck`
- `pnpm --filter @tether/web build`
- `pnpm --filter @tether/admin-web build`

如果改动影响布局、交互、主题或共享组件，必须同时检查：

- `apps/web`
- `apps/admin-web`

如果有任何验证没跑，必须明确记录缺口和风险。
