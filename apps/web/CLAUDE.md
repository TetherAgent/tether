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
src/main.tsx                    应用启动、Provider、全局事件接线
src/routes.tsx                  路由事实源和路由守卫
src/pages/                      页面级入口，只放路由页面
src/components/console/         会话控制台、登录壳、Chrome 控制等业务组件
src/components/ui/              app 内 form glue；可共享基础组件应上移到 packages/design
src/contexts/                   React context
src/hooks/                      context hook 和 app hook
src/i18n/messages.ts            中英文文案表
src/lib/                        API、纯工具函数
src/styles.css                  app 专属布局样式；基础 token 不在这里定义
```

### 文件命名规范

- 新增文件统一使用 **kebab-case**：`session-list-page.tsx`、`use-i18n.ts`、
  `auth-context.tsx`。
- React 组件导出仍使用 **PascalCase**：`SessionListPage`、`WebAuthShell`。
- Hook 文件用 `use-*.ts`，hook 导出用 camelCase：`useI18n`。
- Context 文件用 `*-context.tsx`。
- 路由页面文件用 `*-page.tsx`。
- 禁止新增 PascalCase 文件名；当前前端 app 文件名应保持 kebab-case。

## 路由规范

当前 `apps/web` 只允许：

| 路由 | 说明 |
| --- | --- |
| `/login` | 普通用户登录 |
| `/register` | 普通用户注册 |
| `/` | 对外官网首页，公开访问 |
| `/sessions` | 登录后的 session 列表 |
| `/remote/session/:sessionId` | 单个终端 session |
| `*` | 重定向 `/sessions`；未登录由守卫跳 `/login` |

规则：

- 新增路由必须先进入 `src/routes.tsx`。
- 需要鉴权的页面必须通过路由守卫表达，不能在页面组件里散装 `Navigate`。
- `apps/web` 禁止新增 `/admin/*` 页面；后台入口在 `apps/admin-web`。
- `main.tsx` 只负责 Provider 和把 session surface 传给路由层。

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

### 模式 B：Session List

适用：登录后的 session 列表。

- 顶部只放连接设置和状态。
- session 卡片必须保持可扫描：title、provider/status、id、path。
- 历史 session 折叠展示。

### 模式 C：Terminal Surface

适用：`/remote/session/:sessionId`。

- 终端区域优先占满可用高度。
- 输入区固定底部。
- WebSocket / HTTP / Relay 状态必须可见。

### 模式 D：Public Landing

适用：`/`。

- 对外官网首页，服务公开叙事，不要求登录。
- 内容必须来自当前 README / 长期事实：Gateway ownership、PTY event stream、本机执行、
  Web / H5 / App 接入面、安全边界和路线图。
- 可见文案必须走 `src/i18n/messages.ts`，默认中英文双语。
- 可以使用轻量 CSS 动效，但必须支持 `prefers-reduced-motion: reduce`。
- CTA 只能导向现有 `/login`、`/register` 或页面锚点，不新增未实现产品入口。

## 反模式速查

| 禁止行为 | 正确做法 |
| --- | --- |
| 在 `main.tsx` 继续堆路由 | 改 `src/routes.tsx` |
| 新增 PascalCase 文件名 | 新文件统一 kebab-case |
| 在页面写硬编码可见文案 | 放进 `src/i18n/messages.ts` |
| `apps/web` 新增 `/admin/*` | 改 `apps/admin-web` |
| 页面层重复实现基础控件 | 用 `@tether/design` |
| 大面积品牌绿背景/阴影 | 只在主操作和状态锚点使用品牌信号 |
| 宽屏登录表单铺满 | 走 `WebAuthShell` 固定卡片宽度 |
| 用裸 `<select>` 做复杂选择器 | 优先 `Select`；简单调试控件例外需保持样式 token |
| 把 `.chat-markdown` / `.chat-code-*` 样式写进 `styles.css` | 统一写入 `src/components/chats/chat-markdown.css` |

## 验证

Web 改动至少执行：

```bash
pnpm --filter @tether/web typecheck
```

影响构建、路由、i18n 或样式时执行：

```bash
pnpm --filter @tether/web build
```
