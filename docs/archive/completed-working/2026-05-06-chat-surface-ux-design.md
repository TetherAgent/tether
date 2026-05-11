# Tether 聊天视图 UX 设计文档

**最后更新**：2026-05-06
**文档定位**：前端 UX / 视觉 / 内容渲染 设计，配合架构文档
[`2026-05-04-simple-chat-view-clean-text.md`](./2026-05-04-simple-chat-view-clean-text.md)
使用。架构文档讨论"事件从哪来"，本文讨论"事件如何呈现给用户"。
**目标用户画像**：以**程序员为主**，关注代码、命令、工具调用的可观测性和可复制性。
**改动范围**：`apps/web/src/components/session/chat-session-surface.tsx`、
`apps/web/src/styles.css` 中 `.chat-bubble-*` / `.chat-panel` / `.composer-*` 区段。
**高还原 mockup**：[`./2026-05-06-chat-surface-mockup.html`](./2026-05-06-chat-surface-mockup.html)
（双击浏览器打开。包含所有视觉、状态、动效；内置演示控制面板可切换断连横条 /
循环用户消息状态 / 展开工具卡 / 切换 light-dark 主题）

---

## 1. 当前状态盘点

### 1.1 视觉骨架

- 用户气泡：品牌绿色，右对齐，无头像
- Agent 气泡：浅色 card 底，左对齐，无头像
- 头部：`SessionDetailHeader`（session id、provider、status chip、agentSessionId）
- 底部：composer (`Textarea` + 状态文字 + 手写 button)
- 内容渲染：裸 `react-markdown@10`，**无任何插件**

### 1.2 已知缺陷（按代码位置定位）

#### Bug 与反模式

| # | 位置 | 描述 |
|---|---|---|
| 0 | `chat-session-surface.tsx:273-283` | **无乐观渲染**：用户消息发出后本地状态不更新，要等服务端 `agent.turn` 回流或 250ms 轮询才显示。延迟体感明显，用户怀疑"消息没发出去" |
| 1 | `chat-session-surface.tsx:246` | 多行输入被静默压平为单行（`replace(/\s*\r?\n\s*/g, ' ')`），程序员粘贴代码 / 报错栈 / SQL 全部丢格式 |
| 2 | `styles.css:3927-3929` | Agent 气泡 `max-height: 60vh; overflow-y: auto` 形成嵌套滚动，鼠标进气泡时劫持外层滚动 |
| 3 | `chat-session-surface.tsx:729-734` | `onKeyDown` 没判断 `isComposing`，中文 / 日文 IME 选词回车被当成发送 |
| 4 | `chat-session-surface.tsx:209-214` | 自动滚动暴力 `scrollTop = scrollHeight`，用户翻历史时被拽回底部 |
| 5 | `chat-session-surface.tsx:278-280` | 每次发送触发 3 次 conversation HTTP 轮询（250ms / 1.25s / 3s），且 timer 未在 unmount 清理 |
| 6 | `chat-session-surface.tsx:627-636` | `useEffect` 依赖含 `t`，切换语言会重建 WebSocket 流 |
| 7 | `chat-session-surface.tsx:285` | `sendChatText` 依赖数组与实际使用不符（含未使用 `isReady`，缺 `t`） |

#### 体验缺失

| # | 描述 |
|---|---|
| 8 | 无草稿恢复：刷新 / 误关 tab 输入丢失 |
| 9 | `agent.select` 选项一旦被新消息覆盖就消失，用户记不住编号（截图复现）|
| 10 | 无"取消生成"按钮，AI 跑偏只能等完 |
| 11 | 无错误态可视化：WS 断连只在底部 status 文字提示 |
| 12 | 无消息时间戳 |
| 13 | 用户消息无送达 / 已读反馈 |
| 14 | 无消息复制按钮，只能鼠标拖选（markdown 渲染后选中常出错）|
| 15 | 无消息引用 / 重发 / 编辑 |
| 16 | 无对话内搜索 |
| 17 | composer `rows={1}` 写死，长输入只能内部滚动 |
| 18 | 头部 session id 不可点击复制 |
| 19 | 浏览器标签页无新消息提醒（标题 / favicon） |
| 20 | 无键盘快捷键（`↑` 回填、`Cmd+K` 清空、`Esc` 关 select 等） |
| 21 | 移动端虚拟键盘弹起遮挡 composer |

#### 视觉 / 一致性瑕疵

| # | 描述 |
|---|---|
| 22 | `<button className="composer-submit">` 不走 `@tether/design Button`，主题 / 焦点环不统一 |
| 23 | typing 提示是纯文字，应该是动画三点 + Agent 头像 |
| 24 | `genId` (`Math.random` 生成) 是死代码 |
| 25 | `tool.inputSummary` 字段已传输但前端未使用（chip 只显示工具名）|
| 26 | 长对话无虚拟化滚动 |
| 27 | 无 A11Y：无 `role="log"` / `aria-live="polite"`，屏幕阅读器不会朗读新消息 |
| 28 | 焦点管理弱：select 选项点击后焦点跑到按钮上 |
| 29 | 顶部 status chip 用 `Wifi` 图标表达"会话已结束"，语义错配 |
| 30 | 用户气泡 `color: #fff` 写死，依赖 brand 色保持深色，未来调浅会糊 |

---

## 2. 设计原则（程序员场景）

1. **代码即一等公民**：复制 / 高亮 / diff / ANSI 必须做对，比头像花哨重要
2. **静默就是绝望**：AI 思考期任何 > 1s 的等待都要有视觉反馈
3. **可观测性优先**：工具调用、入参、错误、耗时全部可见，不要"黑箱魔法"
4. **不破坏阅读历史**：滚动锁、状态断连、新消息浮动按钮等都为"我正在看历史"服务
5. **键盘党友好**：高频操作必须有快捷键（发送、取消、回填、清空、选项）
6. **极简头像，让代码占视觉中心**：用 lucide 图标 + 单色边框，不放大头照

---

## 3. 视觉设计

### 3.1 头像方案

| 角色 | 视觉 |
|---|---|
| Agent | 28px 圆形，背景 `color-mix(brand 10%, transparent)`，内部放 provider logo（Codex / Claude / Gemini SVG）；无 logo 时用 lucide `Bot` |
| User | 28px 圆形，背景 `var(--muted)`，邮箱首字母（无衬线 14px）或 lucide `Terminal` |

**摆放**：气泡外侧（agent 左 / user 右），气泡顶部对齐。

### 3.2 同发言人折叠

iMessage / Telegram 通用做法：

- 同一发言人连续消息时**隐藏头像和气泡尾巴尖角**，只在切换发言人时显示
- 同发言人消息间距 `4px`，跨发言人 `16px`

### 3.3 气泡精修

- `box-shadow: 0 1px 2px rgb(0 0 0 / 0.04)`（深色模式下用 `inset 0 0 0 1px` 替代）
- Agent 气泡背景：`color-mix(in srgb, var(--card) 96%, var(--brand))` 取代纯 card 灰
- 用户气泡前景色：用 `var(--brand-foreground)` 取代写死的 `#fff`
- 取消嵌套滚动：去掉 `max-height` + `overflow-y`，由外层 chat-panel 统一滚动

### 3.4 时间戳

- 默认不显示
- 切换发言人 **或** 前后消息间隔 > 5 分钟时，渲染居中细灰色分隔行（`14:32`）

### 3.5 Typing 指示器

- 三个跳动小点（CSS keyframes，每点错峰 0.4s）
- 容器即 Agent 气泡（带头像），首 token 到达时**原地变形**为真实回复气泡，不要"消失再出现"

### 3.6 字体栈

```css
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular,
             Menlo, Consolas, "Liberation Mono", monospace;
```

行内代码字号比正文小 1px（避免破坏行高）。

---

## 4. 内容渲染管线

新增 `<ChatMarkdown>` 组件集中处理。

### 4.1 插件清单

| 插件 | 用途 | 大小估算 |
|---|---|---|
| `remark-gfm` | 表格、任务列表、删除线、自动链接 | ~25KB gz |
| `rehype-highlight` + `highlight.js` | 代码语法高亮 | ~40KB gz（按语言子集） |
| `ansi-to-html` 或 `anser` | 终端输出 ANSI 颜色 | ~5KB gz |
| `rehype-raw` | **不引入**（XSS 风险） | - |
| `remark-math` + `rehype-katex` | **不引入**（程序员场景非必需，体积 200KB+） | - |

### 4.2 自定义 components 映射

```ts
{
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">…</a>,
  code: InlineOrBlockCode,            // 行内 vs 块级分发
  pre: ChatCodeBlock,                  // 块级带复制按钮 / 语言标签 / 行号
  table: ResponsiveTable,              // overflow-x: auto 包裹
  img: BoundedImage,                   // max-width: 100%, 懒加载, 圆角
  blockquote: BrandedQuote             // 左侧 4px 品牌色边条
}
```

### 4.3 ChatCodeBlock 规格

- **复制按钮**：右上角悬浮，hover 显示，点击后 0.8s 内显示 `✓ 已复制`
- **语言标签**：左上角小 chip 显示 lang（`typescript` / `bash` / `json`），无 lang 不显示
- **行号**：≥ 3 行才显示，可全局开关
- **横向滚动**：长行不换行，块单独 `overflow-x: auto`
- **可折叠**：超过 30 行自动折叠，按钮显示 `展开 (148 行)`
- **lang === 'diff' 特殊处理**：`+` 行绿底、`-` 行红底，符号品牌色
- **lang ∈ {bash, shell, console}** 或检测到 `\x1b[`：用 `ansi-to-html` 渲染

### 4.4 行内格式

- 文件路径模式（`path/to/file.ts:42`）自动识别为不换行的 inline code，便于跳转
- URL 自动转链接（`remark-gfm` 自带）
- `overflow-wrap: anywhere` + `word-break: break-word` 兜底超长行

### 4.5 流式中途的不完整 markdown

- react-markdown v10 自身有容错
- 加 60fps 节流防止"代码块 → 段落 → 代码块"反复重渲染抖动

---

## 4.6 乐观渲染（Optimistic UI）

**当前问题**：用户点发送 → 帧进 WebSocket → Gateway 处理 → PTY 输出回流 →
`agent.turn` (role=user) 事件 → 前端 `setChatMessages` 显示。整条链路即使在
本地 Direct 模式也有 100~300ms 延迟，Relay 模式可能 500ms+，用户感知"消息卡住"。

### 改造方案

**1. 立即写入临时消息**

```ts
const tempId = `pending:${crypto.randomUUID()}`;
setChatMessages((prev) => [...prev, {
  id: tempId,
  role: 'user',
  content: nextValue,
  tools: [],
  status: 'pending'  // 新字段
}]);
```

**2. 状态机**

| status | 触发 | 视觉 |
|---|---|---|
| `pending` | 刚加入本地，等 WS ack | 气泡 80% 不透明 + 右下灰色 `…` |
| `sent` | WS `send()` 同步成功（非保证送达，但本地认为已派出） | 单灰勾 `✓` |
| `delivered` | 收到服务端 echo `agent.turn` (role=user) | 切换到正式消息 id，蓝双勾 `✓✓` |
| `failed` | WS 关闭 / send throw | 红边 + 重试按钮 |

**3. 去重合并**

服务端 `agent.turn` 回流时，可能匹配本地 pending 消息：
- 内容相同且时间戳接近（< 5s） → 用服务端 `turn:N` id 替换本地 `pending:UUID`
- 不匹配 → 单独显示（说明 PTY 那边有别的输入源）

**4. 实现要点**

- `ChatMessage` 类型加 `status?: 'pending' | 'sent' | 'delivered' | 'failed'` + `localId?: string`
- `upsertChatMessage` 增强：按 `(role, content, recentTime)` 匹配 pending → 替换为正式
- 失败重试：在气泡上点击 → 重新走 `sendChatText`

**5. 边界情况**

- 用户连发 5 条相同内容：每条独立 `localId`，去重必须基于 id 不基于内容
- 服务端永不回 echo（PTY 写入失败）：5s 后 pending → failed
- 先收到 echo 再 send 完成：理论不会发生（WS 是顺序的），但保险起见 ack 检测 idempotent

---

## 5. AI 思考可见性

### 5.1 状态映射

`agent.runtime.status` 5 档分别对应不同视觉：

| 状态 | 视觉表现 |
|---|---|
| `submitted` | Agent 头像 + 灰色 chip "已收到，准备处理"（< 0.5s 过渡）|
| `running` | Agent 头像 + 三点跳动 + "思考中"（脉冲动画）|
| `running` + 工具调用 | 工具图标旋转 + "正在执行 Bash · git status..." |
| `responding` | 实际气泡逐字流式 + 末尾光标 `▍`（已实现）|
| `done` | 光标消失，hover 显示耗时 `(用时 3.2s)` |

### 5.2 思考时长可见

- 启动思考即开始计时
- > 3s 显示 `思考中 · 3s`
- > 10s 字号略大并切换为 `正在深度思考...`

### 5.3 工具执行实时卡片（程序员核心）

每次工具调用生成临时折叠卡，插在思考气泡和最终回复之间：

```
⏳ Bash · git status                    ← 进行中
✓ Bash · git status (0.4s)              ← 完成
✕ Bash · git status (failed, exit 1)    ← 失败，红边
```

- 点击展开：完整入参 + stdout + stderr
- 复用现有 `tool.inputSummary` 字段（目前未使用）

### 5.4 取消生成

- 思考 > 5s 在思考气泡右侧显示 `✕ 停止生成`
- 实现：发送 PTY interrupt（Ctrl+C 字符 `\x03`）到 session
- 高频操作，必做

### 5.5 用户消息状态

借鉴 WhatsApp 双勾：

| 状态 | 视觉 |
|---|---|
| 发送中 | 气泡右下角灰色 `…` |
| 已发送（服务端确认） | 单灰勾 `✓` |
| 已读（Agent 开始处理）| 蓝色双勾 `✓✓` |
| 失败 | 红色 `⚠ 重试` 按钮 |

### 5.6 错误态可视化

- WS 断连：composer 上方插红色横条 `⚠ 已断开，正在重连... [立即重连]`
- 最后一条思考气泡变红边框 + ⚠ 图标（不让消息默默消失）

### 5.7 滚动锁

- 滚动条距底部 ≤ 80px：自动跟随新消息
- 距底部 > 80px：不跟随，右下角浮动按钮 `↓ 3 条新消息`

### 5.8 标签页提醒

- 页面失焦时 Agent 完成 → `document.title = '(1) Tether'`
- 配合 `Notification` API（用户授权后）发系统通知

---

## 6. 键盘 / 快捷键

| 按键 | 行为 |
|---|---|
| `Enter` | 发送（IME composing 时不触发）|
| `Shift+Enter` | 换行 |
| `Cmd+Enter` / `Ctrl+Enter` | 强制发送（绕过任何禁用态确认）|
| `↑`（输入框为空时）| 回填上一条用户消息 |
| `Cmd+K` | 清空输入 |
| `Cmd+/` | 跳转到输入框 |
| `Esc` | 关闭 select prompt / 取消思考 |
| `1`-`9`（agent.select 激活时）| 直接选对应选项 |
| `Cmd+C`（在代码块内）| 复制整个块（不是只复制选中）|

---

## 7. 头部 / Composer 改造

### 7.1 头部

- session id 改为可点击复制（点击后 toast `已复制 session id`）
- status chip 用语义正确的图标：`CheckCircle`（已完成）/ `Loader2`（运行中）/ `WifiOff`（断开）
- 加 "返回会话列表" 按钮（当前只能浏览器后退）

### 7.2 Composer

- 替换手写 `<button>` 为 `@tether/design Button`
- `Textarea` 改为自适应高度（按内容增长，最大 8 行）
- 移动端 viewport 加 `interactive-widget=resizes-content`
- 草稿恢复：监听 `input` 事件存 sessionStorage，挂载时回填

---

## 8. agent.select 持久化

**当前问题**：选项 prompt 出现一次就消失，用户记不住编号（截图里用户瞎试 1/11/123/12/232 复现）。

**改造**：

- 把 select 选项当作**对话流里一条独立消息**持久化（事件类型 `agent.select` 已经在用，前端持久化即可）
- 选项气泡可重复点击
- 用户已选 → 该气泡变灰，但保留可见
- 顶部 chevron 折叠 / 展开

---

## 9. 落地优先级

### 9.1 Phase 0 — 纯 Bug 修复（P0，预计 1 天）

不改设计、不引入新依赖，纯修代码 bug 和补乐观渲染。

| # | 项 | 文件 |
|---|---|---|
| 0 | **乐观渲染**：用户消息立即显示，状态机 pending → sent → delivered，含 echo 去重 | `chat-session-surface.tsx:273-283` + `upsertChatMessage` |
| 1 | 多行输入吞行 | `chat-session-surface.tsx:246` |
| 2 | 嵌套滚动 | `styles.css:3927-3929` |
| 3 | IME 回车冲突 | `chat-session-surface.tsx:729-734` |
| 4 | 暴力滚动锁改造 | `chat-session-surface.tsx:209-214` |
| 5 | 删除 3 次轮询 + 修依赖 | `chat-session-surface.tsx:278-280, 627-636, 285` |
| 6 | 死代码清理（`genId`）| `chat-session-surface.tsx:67` |

> 注：乐观渲染落地后才能彻底删 #5 的轮询，否则 echo 比预期晚回时本地仍处 pending 但
> 没人触发刷新。两件事一起改最干净。

### 9.2 Phase A — 视觉骨架 + 内容渲染（P0~P1，预计 2 天）

| 项 | 文件 |
|---|---|
| 抽 `<ChatBubble>` 组件 + 头像 + 同发言人折叠 | `chat-bubble.tsx`（新）|
| 抽 `<ChatMarkdown>` 组件 + GFM + 代码高亮 + 复制按钮 | `chat-markdown.tsx`（新）|
| `chat-bubble-*` styles 重做 | `styles.css` |
| 工具 chip 显示 `inputSummary` | `chat-session-surface.tsx:691` |
| Diff / ANSI 渲染 | `chat-markdown.tsx` |
| `composer-submit` 改用 `@tether/design Button` | `chat-session-surface.tsx:740` |

依赖新增：

```jsonc
{
  "remark-gfm": "^4.0.0",
  "rehype-highlight": "^7.0.0",
  "highlight.js": "^11.10.0",
  "anser": "^2.3.0"
}
```

### 9.3 Phase B — 思考体验（P1，预计 2 天）

| 项 |
|---|
| 思考占位气泡（三点动画 + 计时）|
| 工具执行实时卡片（含展开 stdout/stderr）|
| 取消生成按钮（PTY interrupt）|
| 滚动锁 + "新消息"浮动按钮 |
| 用户消息已发送 / 已读双勾 |
| 错误态红色横条 |
| `agent.select` 选项持久化 |
| 标签页 favicon / title 提醒 |

### 9.4 Phase C — 体验细节（P2，预计 1.5 天）

| 项 |
|---|
| 时间戳分隔条 |
| 草稿恢复（sessionStorage） |
| 键盘快捷键全套 |
| 头部 session id 可复制 |
| Composer 自适应高度 |
| 移动端 viewport |
| 标签页通知 API |
| A11Y（`role="log"` / `aria-live`）|
| 消息复制按钮（hover 显示）|

### 9.5 Phase D — 高级功能（P3，按需）

| 项 |
|---|
| 长对话虚拟滚动 |
| 对话内搜索 |
| 消息引用 / 重发 / 编辑 |
| 流式渲染节流（60fps）|

---

## 10. 决策待办

- [ ] **是否先做 Phase 0**（纯 bug 修复，无设计争议，最小风险，最大收益）
- [ ] **代码高亮选择**：`rehype-highlight + highlight.js`（轻，~40KB）vs `shiki`（重但和 VSCode 一致，~250KB）
- [ ] **Phase B 的"取消生成"是否本期做**（涉及 Gateway PTY interrupt 路径，可能需要 store 改动）
- [ ] **同发言人折叠的判定**：仅按 role 还是按 role + 时间间隔（建议 role + 间隔 < 60s）
- [ ] **代码块行号默认开 / 关**：建议默认开 + 全局 setting 关闭

---

## 11. 与架构文档（F + Z）的关系

本文档约束的是 `chat-session-surface.tsx`，对应架构文档中的 `ChatRenderer`。
F + Z 落地后，本文所有设计**完全适用**于新的 `agent-chat-surface.tsx`：
- 头像 / 折叠 / 时间戳 / 滚动锁等都是**渲染层**改动，与数据源无关
- 工具执行卡片在 F 模式下天然是结构化数据（`agent.tool_use` + `agent.tool_result`），
  比当前 PTY 半桥派生的更准确
- 思考状态在 F 模式下来自 `agent.reasoning` 事件，比 PTY 状态更可靠

也就是说，本文设计**无论走 PTY 还是 F 都成立**，且 F 落地后只会更好。
建议**先做 Phase 0 + Phase A**（不依赖 F），再在 F 落地后做 Phase B 思考体验
（数据源更干净，工具卡片质量更高）。
