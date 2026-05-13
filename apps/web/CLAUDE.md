# Tether Web 前端规范

本文件约束 `apps/web`。根级长期事实见 `../../AI_CONTEXT.md`，共享编码原则见
`../../CLAUDE.md`。

`apps/web` 只承载普通用户会话控制台，不承载管理后台。管理后台统一在
`apps/admin-web`。

## 文档维护规则

以下变更完成后必须同步更新本文或对应长期文档：

| 操作 | 需要更新 |
| --- | --- |
| 新增、删除或改名页面路由 | 本文「路由规范」和 `src/routes.tsx` |
| 新增或修改可见文案 | `src/i18n/messages.ts` |
| 新增页面布局模式 | 本文「布局模式」 |
| 新增或调整 `components/` 目录分层 | 本文「目录规范」 |
| 新增基础 UI 组件或 token 使用约束 | `../../packages/design` / `../../packages/theme` 相关文档 |
| 新增或修改 chat-markdown / chat-code-block 样式 | `src/components/chats/chat-markdown.css` |
| 发现新的 Web 反模式 | 本文「反模式速查」 |

不得只改代码、不回写规范。

## 技术栈

- 框架：React + TypeScript + Vite
- 样式：Tailwind CSS v4 + CSS 自定义属性 token
- 基础组件：`@tether/design`
- 主题：`UiPreferencesProvider` 控制 `<html class="dark">`
- 多语言：`src/i18n/messages.ts` + `useI18n()`，禁止页面直接维护文案表
- 路由：`src/routes.tsx` 是路由事实源，禁止把新路由继续堆到 `main.tsx`
- 终端渲染：`@xterm/xterm` + `@xterm/addon-fit`

## 目录规范

```text
src/main.tsx                         应用启动、Provider、全局事件接线；
                                     /sessions 旧终端列表 surface 仍在此渲染
src/routes.tsx                       路由事实源和路由守卫
src/pages/                           页面级入口，只放路由页面
  chats-page.tsx                     /chats 和 /chats/:sessionId
  terminal-page.tsx                  /terminal 和 /terminal/:sessionId
  login-page.tsx
  register-page.tsx
  gateway-auth-page.tsx
  session-control-page.tsx           /remote/session/:sessionId
  session-replay-page.tsx            /remote/session/:sessionId/replay
src/components/
  workbench/                         Workbench 三栏布局、统一 Sidebar、会话动作
    workbench-layout.tsx             路由嵌套 Outlet 布局；包裹 RelayClientProvider
    workbench-sidebar.tsx            统一 Sidebar（Chats / Terminal tab 切换）
    workbench-session-list.tsx       会话列表渲染
    workbench-session-actions.tsx    rename / archive / stop 动作
    workbench-status-pill.tsx        连接状态指示
    rename-session-dialog.tsx
    archive-session-dialog.tsx
    types.ts                         WorkbenchSessionRecord、WorkbenchSidebarTab 等类型
    session-utils.ts                 纯工具函数
  relay/                             共享 Relay WebSocket transport
    relay-client-provider.tsx        Provider：连接、认证、reconnect、sendFrame、frame fan-out
    use-relay-client.ts              useRelayClient() hook
  chats/                             Chat 领域 UI
    chat-panel.tsx                   Chat 工作区主组件
    chat-header.tsx
    chat-message-list.tsx
    chat-composer.tsx
    new-chat-surface.tsx
    app-sidebar.tsx                  旧 Sidebar（过渡期保留，逐步迁到 workbench/）
    gateway-selector.tsx
    slash-command-menu.tsx
    slash-commands.ts
    use-slash-menu.ts
    notification-bell.tsx
    model-avatar.tsx
    result-card.tsx
    chat-data.ts
    chat-types.ts
    chat-utils.ts
    chat-markdown.css
    messages/                        消息气泡和卡片组件
      chat-bubble-agent.tsx
      chat-bubble-user.tsx
      permission-prompt.tsx
      system-message.tsx
      tool-card.tsx
      streaming-cursor.tsx
      thinking-dots.tsx
  terminal/                          Terminal 可嵌入面板
    terminal-pane.tsx                xterm 初始化、output 写入、resize、control/observe
    terminal-session-picker.tsx      选择 running session 的选择器
  session/                           旧整页 PTY surface（过渡期保留）
    session-surface.tsx
    session-detail-chrome.tsx
    chat-bubble.tsx
  console/                           登录壳和 Chrome 控制
    web-auth-shell.tsx
    web-chrome-controls.tsx
  ui/
    form.tsx
src/hooks/
  terminal/                          Terminal runtime 状态
    use-terminal-runtime.ts
    use-terminal-instance.ts
    use-terminal-composer.ts
  workbench/                         Workbench 数据
    use-workbench-sessions.ts
  use-auth.ts
  use-i18n.ts
  use-ui-preferences.ts
  use-update-check.ts
src/contexts/
  auth-context.tsx
  ui-preferences-context.tsx
src/lib/
  api.ts
  provider-resume-command.ts
  terminal-text-extractor.ts
  utils.ts
src/i18n/messages.ts
src/styles.css
```

### 文件命名规范

- 新增文件统一使用 **kebab-case**：`session-list-page.tsx`、`use-i18n.ts`、
  `auth-context.tsx`。
- React 组件导出仍使用 **PascalCase**：`WorkbenchLayout`、`WebAuthShell`。
- Hook 文件用 `use-*.ts`，hook 导出用 camelCase：`useRelayClient`。
- Context 文件用 `*-context.tsx`。
- 路由页面文件用 `*-page.tsx`。
- 禁止新增 PascalCase 文件名；当前前端 app 文件名应保持 kebab-case。

### 目录职责边界

- `components/workbench/`：三栏布局、统一 Sidebar、session list/actions、连接状态。不放 chat 消息或 terminal output 业务逻辑。
- `components/relay/`：Relay WS transport，只暴露连接能力、在线快照和 frame fan-out。不理解 chat message 或 terminal output。
- `components/chats/`：Chat 领域 UI。不处理 terminal 输出，不拥有 Relay WS 连接。
- `components/chats/messages/`：消息气泡和卡片，不依赖 relay 或路由。
- `components/terminal/`：可嵌入 terminal 面板。不处理 chat message。
- `components/session/`：旧整页 PTY surface，过渡期保留，新功能优先用 `terminal/terminal-pane.tsx`。
- `hooks/terminal/`：terminal runtime 状态，不处理 chat。
- `hooks/workbench/`：workbench 数据（session 列表、tab），不处理运行时业务。

## 路由规范

当前 `apps/web` 路由（`src/routes.tsx` 为事实源）：

| 路由 | 说明 |
| --- | --- |
| `/login` | 普通用户登录 |
| `/register` | 普通用户注册 |
| `/gateway-auth` | Gateway 本地认证回调 |
| `/` | 重定向到 `/chats` |
| `/chats` | Chat 工作台（WorkbenchLayout 嵌套） |
| `/chats/:sessionId` | 特定 chat session（WorkbenchLayout 嵌套） |
| `/terminal` | Terminal 工作台（WorkbenchLayout 嵌套） |
| `/terminal/:sessionId` | 特定 terminal session（WorkbenchLayout 嵌套） |
| `/sessions` | 旧终端列表页（`main.tsx` 渲染，过渡期保留） |
| `/remote/session/:sessionId` | 旧整页 terminal session |
| `/remote/session/:sessionId/replay` | 旧终端 replay |
| `*` | 重定向 `/chats` |

规则：

- 新增路由必须先进入 `src/routes.tsx`。
- `/chats`、`/chats/:sessionId`、`/terminal`、`/terminal/:sessionId` 由 `WorkbenchLayout` 嵌套，共享 Relay WS 连接和 Sidebar。
- 需要鉴权的页面必须通过 `RequireUserAuth` 路由守卫表达，不能在页面组件里散装 `Navigate`。
- `apps/web` 禁止新增 `/admin/*` 页面；后台入口在 `apps/admin-web`。
- 不要继续把新路由挂到 `main.tsx`；`/sessions` 是遗留路由，不复制这种模式。

## Relay 架构

`RelayClientProvider`（`components/relay/relay-client-provider.tsx`）是共享 WebSocket transport 的唯一入口，由 `WorkbenchLayout` 包裹。

Provider 只暴露：

```ts
type RelayClientContextValue = {
  ready: boolean;
  connectionEpoch: number;
  gatewayIdsOnline: Set<string>;
  gatewayNamesById: Record<string, string>;
  relaySessions: RelaySessionSummary[];
  sendFrame(frame: Record<string, unknown>): boolean;
  subscribeFrame(handler: (frame: RelayFrame) => void): () => void;
  subscribe(input: RelaySessionSubscriptionInput): void;
  unsubscribe(ownerKey: string): void;
};
```

禁止：

- 在 `WorkbenchLayout` 以外再创建独立 Relay WS 连接。
- 在 Provider 里处理 chat message 或 terminal output 业务状态。
- Chat / Terminal 组件各自维护独立 WS 连接。

订阅所有权：每个 runtime hook 持有唯一 `owner` key（`chat:${sessionId}` / `terminal:${sessionId}`），`unsubscribe` 时只释放自己的 owner，不影响其他消费者。

## i18n 规范

- `apps/web` 默认所有页面都必须支持中文 / English，不允许新增单语言页面。
- 所有可见文案必须来自 `src/i18n/messages.ts`。
- 页面组件通过 `useI18n()` 获取 `t`，不要直接 import 文案对象。
- 语言偏好由 `UiPreferencesProvider` 统一读写 localStorage。
- 表单校验、按钮 loading、空态、错误兜底文案都属于可见文案，新增时必须进 i18n。
- 登录后页面也必须提供语言切换入口；复用 `WebChromeControls` 或等价共享组件。
- 禁止再新增 `ui-copy.ts`、页面内 `const copy = ...` 或散落的双语 map。

## Chat Markdown 样式规范

聊天气泡内的 Markdown 渲染和代码块所有 CSS 统一写入：

```
src/components/chats/chat-markdown.css
```

该文件在 `src/styles.css` 顶部通过 `@import` 引入，**禁止**把 `.chat-markdown`、
`.chat-code-block`、`.chat-code-*` 及 hljs token 覆盖规则写到 `styles.css` 或
其他文件。

新增样式时的判断：

| 样式范围 | 写入位置 |
| --- | --- |
| Markdown 内 `p` / `ul` / `ol` / `li` / `hr` / `h*` / `a` 等 prose 覆盖 | `chat-markdown.css` |
| 代码块容器、header、copy 按钮、pre/code 颜色 | `chat-markdown.css` |
| hljs token 亮色/暗色 overrides | `chat-markdown.css` |
| 其他页面级、全局布局样式 | `styles.css` |

## Token 与样式规范

- 主题入口是 `@tether/theme/globals.css`，由 `src/styles.css` import。
- `apps/web` 默认所有页面都必须同时支持 light / dark；新增页面、shell、终端面板和空态都要在两种主题下可读。
- 页面级 header 或 shell 必须提供主题切换入口；复用 `ThemeToggle` / `WebChromeControls`，不要另写视觉。
- 公共 token 只维护在 `packages/theme`；app 层不得定义新的品牌色、文字色、阴影体系。
- 使用 shadcn 扁平 token utility：`bg-card`、`text-foreground`、`border-input`、
  `text-foreground-tertiary` 等。
- 禁止 `bg-bg-*`、`text-text-*`、`border-border-*`、`ring-border-*` 双前缀写法。
- 品牌色只用于主 CTA、active/current 状态、关键 badge、focus ring；不要大面积铺满页面。
- `backdrop-blur` 只允许登录背景特效、header/nav、modal overlay；业务卡片不要滥用。

## 组件规范

| 场景 | 必用组件 | 禁止 |
| --- | --- | --- |
| 按钮 | `Button` | 手写 button 样式 |
| 图标 | `lucide-react` | 手写 SVG |
| 文本输入 | `Input` | 裸 `<input>` |
| 多行输入 | `Textarea` | 裸 `<textarea>` |
| 信息提示 | `InfoBlock` / `Alert` | 散装 rounded border div |
| 卡片 | `Card` parts | 页面层重复拼 card |
| 反馈 | `toast` | `alert()` |
| 主题切换 | `ThemeToggle` | 重写主题按钮视觉 |

可复用的基础交互模式必须先考虑上移到 `packages/design/src/`，不要在 `apps/web`
复制一套组件库。

## 布局模式

### 模式 A：Auth Shell

适用：`/login`、`/register`。

- 由 `WebAuthShell` 统一承载。
- 背景允许低饱和品牌渐变和轻微动画。
- 表单卡片固定宽度；禁止宽屏铺满。
- 移动端隐藏左侧状态面板，只保留登录卡片。

### 模式 B：Workbench

适用：`/chats`、`/chats/:sessionId`、`/terminal`、`/terminal/:sessionId`。

- 由 `WorkbenchLayout` 统一承载，内部包裹 `RelayClientProvider`。
- 三栏结构：左侧 `WorkbenchSidebar`（260px）+ 中间内容区（flex: 1）。
- 左侧 Sidebar 支持 Chats / Terminal tab 切换；移动端收入 drawer。
- 内容区由 React Router `<Outlet>` 渲染对应页面（`ChatsPage` / `TerminalPage`）。
- Relay WS 连接由 `WorkbenchLayout` 持有，`/chats` 和 `/terminal` 共享同一连接。

### 模式 C：Terminal Surface（旧）

适用：`/remote/session/:sessionId`、`/remote/session/:sessionId/replay`。

- 整页 terminal，由 `SessionSurface` 承载（过渡期保留）。
- 终端区域优先占满可用高度，输入区固定底部。
- 新功能优先使用 `components/terminal/terminal-pane.tsx` 嵌入，不要扩展旧 surface。

### 模式 D：Auth Callback

适用：`/gateway-auth`。

- Gateway 本地认证回调页，功能页，无需完整 shell。

## 反模式速查

| 禁止行为 | 正确做法 |
| --- | --- |
| 在 `main.tsx` 继续堆新路由 | 改 `src/routes.tsx` |
| 新增 PascalCase 文件名 | 新文件统一 kebab-case |
| 在页面写硬编码可见文案 | 放进 `src/i18n/messages.ts` |
| `apps/web` 新增 `/admin/*` | 改 `apps/admin-web` |
| 页面层重复实现基础控件 | 用 `@tether/design` |
| 大面积品牌绿背景/阴影 | 只在主操作和状态锚点使用品牌信号 |
| 宽屏登录表单铺满 | 走 `WebAuthShell` 固定卡片宽度 |
| 把 `.chat-markdown` / `.chat-code-*` 样式写进 `styles.css` | 统一写入 `src/components/chats/chat-markdown.css` |
| Chat 组件或 Terminal 组件自建 Relay WS 连接 | 通过 `useRelayClient()` 共享 WorkbenchLayout 的连接 |
| Terminal 业务逻辑写进 `components/chats/` | 放 `components/terminal/` 和 `hooks/terminal/` |
| `unsubscribe` 时不指定 owner key | 传自己的 `chat:${sessionId}` / `terminal:${sessionId}` owner，防止误断他方订阅 |
| 新功能扩展 `components/session/session-surface.tsx` | 用 `components/terminal/terminal-pane.tsx` |
| 用裸 `<select>` 做复杂选择器 | 优先 `Select`；简单调试控件例外需保持样式 token |

## 验证

Web 改动至少执行：

```bash
pnpm --filter @tether/web typecheck
```

影响构建、路由、i18n 或样式时执行：

```bash
pnpm --filter @tether/web build
```
