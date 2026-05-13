# Web Chat / Terminal 统一布局重构方案

状态：Working

日期：2026-05-13

## 背景

`apps/web/src/components/chats` 现在已经承担了完整 chat 工作台：

- 左侧 chat session 列表和账号菜单
- 中间 chat 消息流、输入框、provider/model/gateway/cwd 选择
- Relay WebSocket 连接和 chat runtime frame 处理

未来如果把 PTY terminal 集成到右侧，不能直接把现有整页 `SessionSurface` 塞进 chat 页面。否则会形成「页面套页面」，并把 chat、terminal、relay、左侧列表的状态绑在一个大组件里。

目标是把 Web 控制台整理成同一个工作台：

```text
左：统一会话面板
中：Chat 工作区
右：Terminal / PTY 工作区
底层：共享同一个 relay client ws transport
```

## 设计目标

1. `components/chats` 保留 chat 领域组件，不再承载全局工作台和 relay transport。
2. 新增 `components/terminal`，沉淀可嵌入的 PTY terminal 面板。
3. 左侧面板统一，不要分别为 chat 和 terminal 做两套 sidebar。
4. Chat 和 Terminal 可以共享 WebSocket transport，但不能共享业务 reducer。
5. Server HTTP 仍是历史数据和持久化事实源，Relay WS 只提供实时状态和运行中事件。
6. 迁移必须小步完成，先拆结构，再改变行为。

## 建议目录结构

```text
apps/web/src/
├── components/
│   ├── chats/
│   │   ├── chat-panel.tsx
│   │   ├── chat-header.tsx
│   │   ├── chat-message-list.tsx
│   │   ├── chat-composer.tsx
│   │   ├── new-chat-surface.tsx
│   │   ├── session-settings-popover.tsx
│   │   ├── gateway-selector.tsx
│   │   ├── slash-command-menu.tsx
│   │   ├── messages/
│   │   │   ├── chat-bubble-agent.tsx
│   │   │   ├── chat-bubble-user.tsx
│   │   │   ├── permission-prompt.tsx
│   │   │   ├── result-card.tsx
│   │   │   ├── system-message.tsx
│   │   │   └── tool-card.tsx
│   │   └── chat-markdown.css
│   ├── terminal/
│   │   ├── terminal-pane.tsx
│   │   ├── terminal-toolbar.tsx
│   │   ├── terminal-composer.tsx
│   │   ├── terminal-session-picker.tsx
│   │   └── terminal-skeleton.tsx
│   ├── workbench/
│   │   ├── web-workbench-layout.tsx
│   │   ├── workbench-sidebar.tsx
│   │   ├── workbench-session-list.tsx
│   │   ├── workbench-session-actions.tsx
│   │   ├── workbench-right-panel.tsx
│   │   ├── notification-bell.tsx
│   │   ├── rename-session-dialog.tsx
│   │   └── archive-session-dialog.tsx
│   ├── relay/
│   │   ├── relay-client-provider.tsx
│   │   ├── use-relay-client.ts
│   │   ├── relay-frame-router.ts
│   │   └── relay-types.ts
│   ├── console/
│   ├── session/
│   └── ui/
├── hooks/
│   ├── chats/
│   │   ├── use-chat-runtime.ts
│   │   ├── use-chat-composer.ts
│   │   ├── use-chat-session-metadata.ts
│   │   └── use-slash-menu.ts
│   ├── terminal/
│   │   ├── use-terminal-runtime.ts
│   │   ├── use-terminal-instance.ts
│   │   └── use-terminal-composer.ts
│   └── workbench/
│       ├── use-workbench-sessions.ts
│       └── use-workbench-selection.ts
├── lib/
│   ├── chats/
│   │   ├── chat-data.ts
│   │   ├── chat-format.ts
│   │   ├── chat-history.ts
│   │   ├── chat-message-state.ts
│   │   └── slash-commands.ts
│   ├── terminal/
│   │   ├── terminal-stream.ts
│   │   ├── terminal-theme.ts
│   │   └── terminal-frame-state.ts
│   └── workbench/
│       └── session-format.ts
└── pages/
    └── chats-page.tsx
```

说明：

- `components/chats`：只放 chat UI。
- `components/terminal`：只放可嵌入 terminal UI。
- `components/workbench`：左侧统一面板、三栏布局、右侧 panel 壳。
- `components/relay`：共享 WebSocket transport 和 frame 分发，不放 chat/terminal 业务逻辑。
- `hooks/chats`：chat runtime 状态，不处理 PTY。
- `hooks/terminal`：terminal runtime 状态，不处理 chat message。
- `lib/*`：纯函数、数据转换、reducer，方便补单测。

## 现有文件迁移去向

`apps/web/src/components/chats` 现有文件不能只按新目录重画，需要逐个有去向。

```text
app-sidebar.tsx                  -> components/workbench/workbench-sidebar.tsx
chats-layout.tsx                 -> components/workbench/web-workbench-layout.tsx
chat-panel.tsx                   -> components/chats/chat-panel.tsx，并逐步拆分
chat-data.ts                     -> lib/chats/chat-data.ts
use-chat-relay-socket.ts         -> components/relay/relay-client-provider.tsx + use-relay-client.ts
use-slash-menu.ts                -> hooks/chats/use-slash-menu.ts
slash-commands.ts                -> lib/chats/slash-commands.ts
slash-command-menu.tsx           -> components/chats/slash-command-menu.tsx
gateway-selector.tsx             -> components/chats/gateway-selector.tsx，后续可上移 workbench
notification-bell.tsx            -> components/workbench/notification-bell.tsx
model-avatar.tsx                 -> components/chats/messages/model-avatar.tsx
streaming-cursor.tsx             -> components/chats/messages/streaming-cursor.tsx
thinking-dots.tsx                -> components/chats/messages/thinking-dots.tsx
chat-bubble-agent.tsx            -> components/chats/messages/chat-bubble-agent.tsx
chat-bubble-user.tsx             -> components/chats/messages/chat-bubble-user.tsx
permission-prompt.tsx            -> components/chats/messages/permission-prompt.tsx
result-card.tsx                  -> components/chats/messages/result-card.tsx
system-message.tsx               -> components/chats/messages/system-message.tsx
tool-card.tsx                    -> components/chats/messages/tool-card.tsx
chat-markdown.css                -> components/chats/chat-markdown.css
```

`apps/web/src/components/session` 不立即删除。它在过渡期保留整页 PTY 路由：

```text
session-surface.tsx              -> 先保留；Phase F 内部改用 components/terminal/terminal-pane.tsx
session-detail-chrome.tsx        -> 先保留；可被 terminal toolbar 复用后再迁移
chat-bubble.tsx                  -> 保留给旧 session 页面；后续确认无引用再清理
```

执行迁移时先搬小组件，再搬 `chat-panel.tsx` 依赖，最后处理 `chats-layout.tsx`。不要在同一步同时移动文件和改 runtime 行为。

## WebSocket 共享边界

可以共享：

```text
Relay 连接
auth token 变化后的 close/reconnect
sendFrame()
gateway.status
sessions frame
gateway 在线/离线集合
relaySessions 快照
connection status
frame fan-out
```

不能共享：

```text
chat messages
agent.delta / agent.result reducer
terminal.output 写入
PTY replay queue
permission prompt state
chat input inflight state
terminal composer state
当前 chat subscribe 控制权
当前 terminal subscribe 控制权
```

建议统一入口：

```tsx
<RelayClientProvider>
  <WebWorkbenchLayout />
</RelayClientProvider>
```

`RelayClientProvider` 只暴露 transport 层能力：

```ts
type RelayClientContextValue = {
  ready: boolean;
  connectionEpoch: number;
  gatewayIdsOnline: Set<string>;
  gatewayNamesById: Record<string, string>;
  relaySessions: RelaySessionSummary[];
  sendFrame(frame: Record<string, unknown>): boolean;
  subscribeFrame(handler: (frame: RelayFrame) => void): () => void;
};
```

`subscribeFrame()` 只做 fan-out。Chat 和 Terminal 各自注册 handler，各自判断 `frame.type` 和 `sessionId`，不能互相改对方状态。

代码现状：`use-chat-relay-socket.ts` 当前已经是 shared singleton，但只有一个 `activeSubscriber`，并不适合直接支撑左中右多个消费者。

目标设计：拆成 Provider 时状态边界如下：

| 状态 / 职责 | 迁移后归属 |
| --- | --- |
| WebSocket 实例、open/close/reconnect | `RelayClientProvider` |
| `accessToken` / `relayUrl` 变化后重连 | `RelayClientProvider` |
| `ready` / `connectionEpoch` | `RelayClientProvider` |
| `sendFrame()` | `RelayClientProvider` |
| frame JSON parse 和 fan-out | `RelayClientProvider` |
| `gateway.status` 聚合出的 online gateway ids | `RelayClientProvider` |
| `sessions` frame 的 relaySessions 快照 | `RelayClientProvider` |
| `client.auth.ok` / `client.auth.failed` transport 状态 | `RelayClientProvider` |
| 当前 chat session metadata/history | `use-chat-runtime.ts` |
| `agent.delta` / `agent.result` / `agent.tool` | `use-chat-runtime.ts` + `chat-message-state.ts` |
| chat permission prompt state | `use-chat-runtime.ts` |
| chat input inflight state | `use-chat-composer.ts` |
| PTY terminal output / replay queue | `use-terminal-runtime.ts` |
| PTY xterm instance / fit / theme | `use-terminal-instance.ts` |
| PTY composer / input disabled reason | `use-terminal-composer.ts` |
| 左侧列表 HTTP 历史、tab、选中项 | `use-workbench-sessions.ts` / `use-workbench-selection.ts` |

Provider 不能直接理解 chat message 或 terminal output；它只负责连接、在线快照和 frame 分发。

订阅所有权规则：

```text
ChatPanel 只能取消自己订阅的 chat session
TerminalPane 只能取消自己订阅的 terminal session
```

实现上建议每个 runtime hook 持有自己的 owner key：

```text
chat:${sessionId}
terminal:${sessionId}
```

第一版先做 owner 隔离，避免组件 unmount 时误发 `client.unsubscribe` 断掉另一区域。

代码现状风险：

```text
Relay 侧 client.unsubscribe 只按 sessionId 取消
同一个共享 WS 连接只有一个 clientId
如果 ChatPanel 和 TerminalPane 共享一个 WS，任何一方直接发 client.unsubscribe 都可能取消同一 clientId 下的 session 订阅
```

因此 Provider 内需要维护订阅表：

```ts
type RelaySubscriptionOwner = {
  ownerKey: string;
  sessionId: string;
  mode: 'control' | 'observe';
};
```

规则：

```text
subscribe(ownerKey, sessionId, mode)：首次订阅该 sessionId 时才发送 client.subscribe
unsubscribe(ownerKey)：移除 owner；同一 sessionId 没有 owner 后才发送 client.unsubscribe
```

后续如果同一个 session 允许多个消费者同时订阅，沿用这套 owner/ref count 机制。

## 左侧面板统一方案

现在 `AppSidebar` 只服务 chat。未来应改成 `WorkbenchSidebar`，它展示统一 session 列表。

第一版不要先把 chat 和 terminal 混在同一个列表里。建议在账号区上方、列表空白区域底部放一个显式切换：

```text
┌──────────────────────────────┐
│ Chats | Terminal             │
└──────────────────────────────┘
```

切换后的列表只显示对应类型：

```text
Chats tab
- New Chat
- chat session A
- chat session B

Terminal tab
- terminal session A
- terminal session B
```

数据来源：

```text
Chat 历史列表：Server HTTP fetchChatSessions()
Terminal 历史/运行中列表：GET /api/server/sessions?limit=30，第一版前端过滤 transport !== 'chat'
在线状态第一版：HTTP 返回的 status 字段
在线状态后续：Relay WS sessions + gateway.status
rename/archive：仍走 Server HTTP，不能只改本地 WS 快照
```

事实核对：

```text
当前普通用户 /api/server/sessions 尚未解析 ?transport=
当前 admin session 查询支持 filters.transport
当前 /sessions 仍有独立终端列表页，apps/web/src/main.tsx 同时使用 Relay WS sessions frame 读取活跃列表，并用 /api/server/sessions?limit=30 读取历史列表
```

执行顺序：

```text
第一阶段：前端过滤 transport !== 'chat'，不改 Server
后续优化：再补普通用户 /api/server/sessions 的 transport 过滤参数
```

如果希望服务端过滤，需要在 Server 侧补：

```text
GET /api/server/sessions?transport=terminal
或
GET /api/server/sessions?excludeTransport=chat
```

并让 `controller.session.list` 把 query 传给 `sessionRepository.listSessions()`。

`/sessions` 过渡策略：

```text
第一版：保留 /sessions，Terminal tab 先复用同一类 Session 数据结构和卡片信息
Workbench 稳定后：/sessions 可以 redirect 到 /chats?tab=terminal
迁移前：不要删除 apps/web/src/main.tsx 里的 SessionList 逻辑
```

这样做的好处：

1. 左侧视觉先统一，但数据层仍简单。
2. 用户切到 `Chats` 只看 chat 会话，切到 `Terminal` 只看 PTY 会话，不会混乱。
3. 第一版可以先接共享 WebSocket transport，但 Terminal tab 只能把 Provider 快照作为在线状态增强，不能依赖 WS 才能显示列表。
4. 后续右侧 TerminalPane 接入后，只需要把在线状态和运行中快照叠加到同一列表模型上。

左侧面板不要直接 subscribe 某个 session。它只读全局快照和 HTTP 历史，真正的 session subscribe 由中间 `ChatPanel` 或右侧 `TerminalPane` 发起。

推荐左侧状态模型：

```ts
type WorkbenchSidebarTab = 'chats' | 'terminal';

type WorkbenchSessionListItem = {
  id: string;
  kind: 'chat' | 'terminal';
  title: string;
  provider?: string;
  projectPath?: string;
  status?: string;
  lastActiveAt?: number;
};
```

对应 hook：

```text
hooks/workbench/use-workbench-sessions.ts
```

职责：

```text
读取当前 tab
按 tab 调用对应 HTTP API
保留 30s visibility refresh
提供 optimistic rename/archive
后续叠加 Relay WS 在线状态
```

第一版 Terminal tab 点击行为：

```text
当前阶段：点击 terminal session 直接跳转 /remote/session/:sessionId
右侧 TerminalPane 完成后：点击 terminal session 在右侧打开，不离开 /chats
```

第一版 URL 策略：

```text
左侧 tab 状态保留在 /chats 页面内，不新增路由
推荐用 /chats?tab=terminal 记录当前 tab，刷新后仍停在 Terminal tab
点击 terminal session 时跳转 /remote/session/:sessionId
点击 chat session 时跳转 /chats/:sessionId
右侧 TerminalPane 完成后，terminal 点击行为改为更新 /chats?tab=terminal&terminalId=:sessionId
```

## 统一会话动作语义

左侧面板可以统一 UI，但不能把 chat 和 terminal 的运行时语义混掉。

推荐统一为：

```text
rename：统一
archive / remove from list：统一入口，语义是从列表隐藏或归档，不杀进程
stop：Terminal 单独动作，只停止 running PTY
delete permanently：暂不做
```

### Rename

`rename` 可以统一，因为 chat 和 terminal 都落在 `gateway_sessions.title`。

后续建议新增统一接口：

```text
PATCH /api/server/sessions/:id/title
```

语义：

```text
title = 用户输入
title_source = 'user'
```

现有 chat rename 已经通过 `title_source = 'user'` 和 runtime sync 的 `IF(title_source = 'user', title, VALUES(title))` 防覆盖。新增统一接口的关键收益是让 terminal rename 也获得同样保护，并把 chat/terminal 的前端调用收口到同一入口。

### Archive / Remove from List

`delete` 不建议作为第一版统一语义。Terminal 如果直接叫 delete，用户容易误解为会杀掉正在运行的 PTY；如果只删 `gateway_sessions`，running session 又可能被 Gateway sync 回来。

第一版统一成 `archive / remove from list` 更安全：

```text
POST /api/server/sessions/:id/archive
```

建议规则：

```text
chat：允许 archive
terminal stopped/lost/completed：允许 archive
terminal running：第一版禁止 archive，提示先 stop
```

`archive` 只表示从列表隐藏或归档，不表示终止进程。

代码现状风险：

```text
现有 chat delete 会写 gateway_deleted_sessions tombstone
runtimeSyncRepository 遇到 tombstone 会删除 gateway_chat_messages / gateway_runtime_events / gateway_sync_cursors / gateway_sessions
如果 Terminal archive 直接复用这套 delete tombstone，会丢失 terminal replay 数据
```

因此 Terminal 的 `archive / remove from list` 需要先定数据语义：

```text
方案 A：soft hide，只对当前用户隐藏，保留 gateway_runtime_events，可继续 replay
方案 B：hard remove，写 tombstone 并清理 runtime events，不能再 replay
```

推荐第一版采用方案 A。若采用方案 A，需要新增独立隐藏标记或归档表，不要直接复用 `gateway_deleted_sessions` 的硬删除语义。

Server 侧前置任务：

```text
1. 新增 PATCH /api/server/sessions/:id/title
2. 新增 POST /api/server/sessions/:id/archive
3. 在 sessionRepository 中实现统一权限校验：account_id + user_id + session id
4. rename 写 title_source = 'user'
5. archive 对 running terminal 返回业务错误，提示先 stop
6. chat 旧接口 PUT /api/server/chat-sessions/:id 可以先保留，前端逐步迁到统一接口
7. terminal archive 第一版必须保留 replay 数据，不得直接复用 chat delete 的 tombstone 清理路径
```

没有这组 Server 接口前，WorkbenchSidebar 只能做到 UI 拆分和 Chat 原有 rename/delete 不回退，不能验收“chat 和 terminal 统一 rename/archive”。

### Stop

`stop` 是 Terminal 专属运行时动作。

规则：

```text
只对 running terminal session 显示
明确文案为停止终端 / Stop terminal
走现有 PTY stop 流程
不复用 archive/delete 文案
```

## 右侧 Terminal 集成方式

右侧不要复用整页 `SessionSurface`，而是新增可嵌入组件：

```tsx
<TerminalPane
  sessionId={selectedTerminalSessionId}
  mode="control"
  chrome="compact"
/>
```

`TerminalPane` 负责：

```text
xterm 初始化
fit addon
terminal output 写入
terminal theme
resize
client.input
client.stop
control / observe mode
reconnect catchup
```

`SessionSurface` 保留整页页面，但内部也应改用 `TerminalPane`，避免同一套 PTY 逻辑复制两份。

第一版右侧行为建议：

```text
1. 默认折叠
2. 展开后先显示 terminal session picker
3. 用户手动选择 running PTY session
4. 选中状态只存在当前 Web 视图
5. 暂不把 chat session 和 PTY session 持久绑定
```

后续再加：

```text
chat session 绑定默认 terminal session
从 chat 请求创建 PTY session
从 terminal output 回填 chat 上下文
```

## 布局方案

桌面：

```text
┌──────────────┬──────────────────────────────┬──────────────────────┐
│ Sidebar      │ Chat                         │ Terminal             │
│ 260px        │ flex: 1                      │ 360-520px            │
│ unified list │ messages + composer          │ xterm + composer     │
└──────────────┴──────────────────────────────┴──────────────────────┘
```

移动端：

```text
Sidebar：drawer
Chat / Terminal：tab 或 bottom sheet
```

不建议移动端同时显示 chat 和 terminal 两列。

## 可执行 TODO 与验收

### Phase A：共享 Relay transport + 左侧信息架构先落地

- [x] 新增 `components/relay/relay-client-provider.tsx`。
- [x] 新增 `components/relay/use-relay-client.ts`。
- [x] Provider 负责 WebSocket、auth、reconnect、sendFrame、frame fan-out、online gateway ids、relaySessions 快照。
- [x] 保留 `use-chat-relay-socket.ts` 兼容层，返回值仍是 `{ wsReady, sendFrame, connectionEpoch }`。
- [x] `ChatPanel` 继续通过兼容层使用 WS，不直接改 frame 处理逻辑。
- [x] `ChatsLayout` / `WebWorkbenchLayout` 外层包 `RelayClientProvider`。
- [x] 在左侧账号区上方、列表底部空白处加入 `Chats / Terminal` 切换。
- [x] `/chats` 默认显示 `Chats` tab。
- [x] `/chats?tab=terminal` 显示 `Terminal` tab，刷新后保持该 tab。
- [x] `Chats` tab 继续使用 `/api/server/chat-sessions`。
- [x] `Terminal` tab 使用 `/api/server/sessions?limit=30`，前端过滤 `transport !== 'chat'`。
- [x] `Terminal` tab 只读 Provider 的 `relaySessions` / `gatewayIdsOnline` 叠加在线状态；Provider 无快照时仍显示 HTTP 列表，不发 `client.subscribe`。
- [x] Phase A 首版点击 terminal session 跳转 `/remote/session/:sessionId`；Phase G 已改为右侧打开。
- [x] 保留 `/sessions` 旧终端列表页，不在第一阶段删除。

硬约束：

- [x] 不能改 `ChatPanel` 的 `handleRelayFrame` 业务逻辑。
- [x] 不能改 `agent.delta` / `agent.result` / `agent.tool` 处理。
- [x] 不能改 `sendMessage` 行为。
- [x] 不能改 `/api/server/chat-sessions` 行为。
- [x] Terminal tab 不能发 `client.subscribe`。

验收：

- [x] `pnpm --filter @tether/web typecheck`
- [x] `pnpm --filter @tether/web build`
- [x] 改动前先做 chat baseline：打开已有 `/chats/:sessionId`，确认历史加载正常。
- [x] 手动打开 `/chats`，默认仍能看到 chat 列表和新建会话入口。
- [x] 手动打开 `/chats/:sessionId`，仍直接打开对应 chat。
- [x] 新建 chat 后仍跳转 `/chats/:sessionId`。
- [x] 发送消息后 user message 立即出现。
- [x] `agent.delta` 流式输出正常。
- [x] `agent.result` 不重复追加。
- [x] permission prompt 仍可 allow/deny。
- [x] 刷新已有 chat 后 history 正常。
- [x] 手动打开 `/chats?tab=terminal`，能看到 terminal session，且不混入 `transport = 'chat'`。
- [x] Terminal tab 能叠加 Provider 的在线状态；Provider 暂无快照时仍显示 HTTP 列表，且不会触发 terminal subscribe。
- [x] Terminal session 点击行为已由 Phase G 调整为 `/chats?tab=terminal&terminalId=:sessionId` 右侧打开。
- [x] `/sessions` 旧页面仍可访问。

执行记录：

- 2026-05-13：`pnpm --filter @tether/web typecheck` 通过。
- 2026-05-13：`pnpm --filter @tether/web build` 通过；仅有 Vite chunk size warning。
- 2026-05-13：本地 dev server 使用 `TETHER_WEB_PORT=4793 pnpm --filter @tether/web dev` 启动，`/chats`、`/chats?tab=terminal`、`/sessions` 均返回 `200 text/html`。
- 2026-05-13：代码级确认 `chat-panel.tsx`、`session/`、`main.tsx` 无本阶段 diff；Terminal tab 侧栏代码无 `client.subscribe`。
- 2026-05-13：用户人工确认 chat history、新建跳转、发送即时显示、`agent.delta`、`agent.result`、permission allow/deny、刷新 history、Terminal tab 过滤均无问题。
- 2026-05-13：Phase G 后 terminal session 点击不再跳 `/remote/session/:sessionId`，改为在 `/chats` 右侧打开。

### Phase B：统一会话动作 Server 能力

- [x] 新增 `PATCH /api/server/sessions/:id/title`。
- [x] 新增 `POST /api/server/sessions/:id/archive`。
- [x] `rename` 权限校验使用 `account_id + user_id + session id`。
- [x] `rename` 写入 `title_source = 'user'`。
- [x] `archive` 对 running terminal 返回业务错误，提示先 stop。
- [x] Terminal archive 第一版采用 soft hide，保留 `gateway_runtime_events` 和 replay 数据。
- [x] 保留旧 `PUT /api/server/chat-sessions/:id` / `DELETE /api/server/chat-sessions/:id`，避免破坏现有 chat。

验收：

- [x] 旧 chat rename 仍保持现有防 Gateway sync 覆盖行为。
- [x] 新统一 rename 接口用于 chat 时不回退现有防覆盖行为。
- [x] terminal rename 走新接口后不会被 Gateway sync 覆盖。
- [x] running terminal archive 被拒绝。
- [x] stopped/lost/completed terminal archive 后不再出现在 Terminal tab。
- [x] terminal archive 后 replay 数据仍保留。
- [x] 旧 chat rename/delete 接口仍可用。

执行记录：

- 2026-05-13：新增 `archived_at` soft hide 迁移；普通用户 session 列表和 chat 列表默认过滤 `archived_at IS NULL`。
- 2026-05-13：`PATCH /api/server/sessions/:id/title` 复用 `gateway_sessions` 范围校验并写入 `title_source = 'user'`。
- 2026-05-13：`POST /api/server/sessions/:id/archive` 对 running terminal 返回 `409`，对 stopped/lost/completed terminal 只写 `archived_at`，不删除 `gateway_runtime_events` / replay 数据。
- 2026-05-13：前端 `api.ts` 补充 `renameSessionTitle()` / `archiveSession()`，`@tether/http` 补充 `patch()` helper，供 Phase C action 收口使用。
- 2026-05-13：`pnpm --filter @tether/server typecheck` 通过。
- 2026-05-13：`pnpm --filter @tether/server test -- --require ts-node/register test/session-read.test.ts test/chat-repository.test.ts` 通过。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/http typecheck` 通过。

### Phase C：拆 WorkbenchSidebar

- [x] `AppSidebar` 拆成 `components/workbench/workbench-sidebar.tsx`。
- [x] 拆出 `workbench-session-list.tsx`。
- [x] 拆出 `workbench-session-actions.tsx`。
- [x] 拆出 `rename-session-dialog.tsx`。
- [x] 拆出 `archive-session-dialog.tsx`。
- [x] 数据读取收口到 `hooks/workbench/use-workbench-sessions.ts`。
- [ ] action 能力按 `kind` 区分：chat 支持 rename/archive，terminal 支持 rename、非 running archive、running stop。

说明：running terminal 的 `stop` 暂不放在左侧侧栏。当前 Relay 要求 `client.stop` 必须已有 control subscribe，而本方案硬约束是左侧 sidebar / Terminal tab 不发 `client.subscribe`。因此 Phase C 先完成 rename/archive 和 running terminal 隐藏 archive；stop 留到右侧 `TerminalPane` 接入后由 runtime owner 执行。

验收：

- [ ] 新建 chat 后左侧刷新不丢。
- [ ] Chat tab 和 Terminal tab 的选中状态互不污染。
- [ ] rename/archive/stop 的按钮只在对应 session kind 和 status 下出现。
- [ ] 账号菜单、主题切换、logout 行为不变。

执行记录：

- 2026-05-13：`AppSidebar` 缩成兼容导出，实际实现迁到 `components/workbench/workbench-sidebar.tsx`。
- 2026-05-13：拆出 `workbench-session-list.tsx`、`workbench-session-actions.tsx`、`rename-session-dialog.tsx`、`archive-session-dialog.tsx`、`session-utils.ts`、`types.ts`。
- 2026-05-13：数据读取收口到 `hooks/workbench/use-workbench-sessions.ts`，保留 Chats/Terminal tab 的 HTTP 数据来源和前端 terminal 过滤。
- 2026-05-13：chat 和 terminal 均使用统一 `renameSessionTitle()`；archive 使用统一 `archiveSession()`；running terminal 不显示 archive action。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

### Phase D：收敛 Relay transport 订阅所有权

- [x] 移除 `use-chat-relay-socket.ts` 兼容层，所有运行时改用 `useRelayClient()`。
- [ ] Chat runtime 状态下沉到 `hooks/chats/use-chat-runtime.ts`。
- [ ] Terminal runtime 状态下沉到 `hooks/terminal/use-terminal-runtime.ts`。
- [x] Provider 内实现 subscription owner/ref count。
- [x] `ChatPanel` 使用 `chat:${sessionId}` owner。
- [x] `TerminalPane` 使用 `terminal:${sessionId}` owner。

说明：本轮已完成 Provider 级 owner/ref-count 能力，并把 `ChatPanel` 与 `TerminalPane` 的 session subscribe/unsubscribe 接入 owner 模型。runtime state 仍分别留在各自组件内，没有把 chat reducer 和 terminal replay queue 合并。

验收：

- [ ] 中间 chat 可以正常 subscribe、发送、接收 `agent.delta` / `agent.result`。
- [ ] ChatPanel unmount 只释放自己的 owner。
- [ ] TerminalPane unmount 只释放自己的 owner。
- [ ] 同一共享 WS 下不会出现一边 unmount 断掉另一边订阅。
- [ ] Gateway 在线/离线状态仍正常显示。

执行记录：

- 2026-05-13：`RelayClientProvider` 新增 `acquireSessionSubscription({ owner, sessionId, mode, ... })`。
- 2026-05-13：同一 session 多 owner 时只在最后一个 owner release 后发送 `client.unsubscribe`，避免一个面板 unmount 断掉另一个面板订阅。
- 2026-05-13：Relay 重新鉴权成功后会按 owner/ref-count 快照重发当前 session subscribe。
- 2026-05-13：`ChatPanel` subscribe/unsubscribe 生命周期已切到 `acquireSessionSubscription({ owner: "chat:${sessionId}", mode: "control" })`，但 frame 处理和 runtime state 仍保留在原组件内。
- 2026-05-13：删除 `use-chat-relay-socket.ts` 兼容层，ChatPanel 直接使用 `useRelayClient()` 获取 `wsReady`、`sendFrame`、`connectionEpoch`、`acquireSessionSubscription()`。
- 2026-05-13：`TerminalPane` 已从独立 WebSocket 切到共享 `RelayClientProvider`，使用 `acquireSessionSubscription({ owner: "terminal:${sessionId}", ... })` 管理订阅。
- 2026-05-13：`TerminalPane` 的 `client.input`、`client.resize`、`client.stop` 改为通过 Provider `sendFrame()` 发送；unmount 只 release terminal owner。
- 2026-05-13：`SessionSurface` 会为旧 `/remote/session/:sessionId` 和 replay 路由包一层 `RelayClientProvider`，避免旧入口因 `TerminalPane` 改用 shared hook 而失效。
- 2026-05-13：Provider 在 token / relayUrl 重连时保留 owner 表，避免连接重建后已打开的 chat / terminal 丢失自动重订阅。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

### Phase E：拆 ChatPanel

- [x] 先搬 `MessageItem`、`UsageStats`、`RelaySessionSummary` 等类型。
- [x] 搬 `compactPathLabel()`、`historyMessagesToItems()`、`historySnapshotLooksOlder()`、`usageStatsFromHistory()` 等纯函数。
- [x] 将平铺 message 组件迁到 `components/chats/messages/`。
- [x] 拆 `ChatMessageList`。
- [x] 拆 `ChatComposer`。
- [x] 拆 `ChatHeader`。
- [x] 拆 `NewChatSurface`。
- [ ] 最后把 chat frame 处理移到 `use-chat-runtime.ts`。

执行记录：

- 2026-05-13：`chat-bubble-agent.tsx`、`chat-bubble-user.tsx`、`permission-prompt.tsx`、`streaming-cursor.tsx`、`system-message.tsx`、`thinking-dots.tsx`、`tool-card.tsx` 已迁到 `components/chats/messages/`。
- 2026-05-13：`MessageItem`、`UsageStats`、`RelaySessionSummary`、`GatewayInfo` 等类型已迁到 `components/chats/chat-types.ts`。
- 2026-05-13：`compactPathLabel()`、`compactProjectPath()`、`historyMessagesToItems()`、`historySnapshotLooksOlder()`、`usageStatsFromHistory()`、provider/session type guards 等纯函数已迁到 `components/chats/chat-utils.ts`。
- 2026-05-13：消息列表渲染拆到 `components/chats/chat-message-list.tsx`，ChatPanel 继续持有 messages state 和 permission response 行为。
- 2026-05-13：底部已有会话输入区拆到 `components/chats/chat-composer.tsx`，ChatPanel 继续持有输入状态、slash menu、发送逻辑和新建会话 surface。
- 2026-05-13：已有会话顶部 header 拆到 `components/chats/chat-header.tsx`，复制 provider session id 和通知铃铛行为不变。
- 2026-05-13：新建会话页面外壳拆到 `components/chats/new-chat-surface.tsx`，provider/cwd/slash menu/inputCard 逻辑仍留在 ChatPanel。
- 2026-05-13：本轮只迁移已独立 message 组件和导入路径，不拆 `ChatPanel` runtime，不改 `handleRelayFrame` 业务逻辑。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

验收：

- [ ] 首条消息创建 session 后仍跳转 `/chats/:sessionId`。
- [ ] `agent.delta` 流式输出正常。
- [ ] `agent.result` 不重复追加。
- [ ] permission prompt 仍可 allow/deny。
- [ ] provider resume command 复制仍正常。

### Phase F：抽 TerminalPane

- [x] 新增 `components/terminal/terminal-pane.tsx`。
- [x] 新增 `hooks/terminal/use-terminal-instance.ts`。
- [x] 新增 `hooks/terminal/use-terminal-runtime.ts`。
- [x] 新增 `hooks/terminal/use-terminal-composer.ts`。
- [x] `SessionSurface` 内部改用 `TerminalPane`。
- [x] 保留整页 `/remote/session/:sessionId` 路由。

验收：

- [ ] `/remote/session/:sessionId` 正常显示 PTY。
- [ ] 输入、stop、observe/control、replay 不回退。
- [ ] light/dark 主题正常。
- [ ] terminal resize / fit addon 正常。

执行记录：

- 2026-05-13：`SessionSurface` 内部已改为渲染 `TerminalPane`。
- 2026-05-13：`TerminalPane` 实现已物理迁到 `components/terminal/terminal-pane.tsx`，`components/session/session-surface.tsx` 保留兼容 re-export。
- 2026-05-13：新增 `hooks/terminal/use-terminal-instance.ts`、`use-terminal-runtime.ts`、`use-terminal-composer.ts` 占位入口；后续再逐步下沉 xterm lifecycle、relay runtime、composer state。
- 2026-05-13：旧 `/remote/session/:sessionId` / replay 路由通过 `SessionSurface` 内置 `RelayClientProvider` 继续使用同一套 `TerminalPane` 实现。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

### Phase G：右侧接入 Terminal

- [x] `WebWorkbenchLayout` 支持右侧 panel。
- [x] 右侧默认折叠。
- [x] 右侧展开后显示 terminal session picker。
- [x] 从左侧 Terminal tab 点击 session 时在右侧打开，不离开 `/chats`。
- [x] URL 更新为 `/chats?tab=terminal&terminalId=:sessionId`。
- [x] Chat 和 Terminal 共享 Relay transport，但各自拥有 runtime state 和 subscription owner。

验收：

- [ ] 中间 chat 和右侧 terminal 同时打开不互相抢订阅。
- [ ] Chat 的 `agent.delta` 不影响 terminal output。
- [ ] Terminal 的 `terminal.output` 不进入 chat message list。
- [ ] 断线重连后两个区域都能恢复。
- [ ] 移动端不同时显示两列，使用 tab 或 bottom sheet。

执行记录：

- 2026-05-13：`ChatsLayout` 支持右侧 terminal panel，默认无 `terminalId` 时折叠。
- 2026-05-13：左侧 Terminal tab 点击 session 更新为 `/chats?tab=terminal&terminalId=:sessionId`，不再跳转 `/remote/session/:sessionId`。
- 2026-05-13：右侧 panel 复用 `TerminalPane`，并通过共享 `RelayClientProvider` 使用 `terminal:${sessionId}` owner，不再单独创建 PTY WebSocket。
- 2026-05-13：无 `terminalId` 时右侧显示 `components/terminal/terminal-session-picker.tsx`，使用 `/api/server/sessions?limit=30` + 前端过滤 `transport !== 'chat'`。
- 2026-05-13：根据实际 UI 反馈，Terminal tab 下不再保留中间新建 Chat 空态；主工作区直接显示 `TerminalPane` 或 `TerminalSessionPicker`。
- 2026-05-13：移动端右侧 panel 暂隐藏，避免与 chat 同屏挤压；后续可做 bottom sheet / tab。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

### Phase H：拆独立 `/terminal` 路由并上移 Workbench/WS

决策：`/chats?tab=terminal&terminalId=...` 只作为过渡方案，不再继续扩展。Terminal 和 Chats 是两个主工作区，应拆成独立路由，但共享同一个 Workbench 外壳和 Relay WS。

目标路由：

```text
/chats
/chats/:sessionId
/terminal
/terminal/:sessionId
```

执行 TODO：

- [x] 新增 `components/workbench/workbench-layout.tsx`。
- [x] `RelayClientProvider` 上移到 `WorkbenchLayout`，作为 `/chats` 与 `/terminal` 的共同父层。
- [x] `WorkbenchSidebar` 上移到 `WorkbenchLayout`，不再由 `ChatsLayout` 私有管理。
- [x] `ChatsPage` 改为只渲染 `ChatPanel`，通过 outlet context 接收 sidebar 回调和 refresh。
- [x] 新增 `pages/terminal-page.tsx`。
- [x] 新增 `/terminal` 与 `/terminal/:sessionId` 路由。
- [x] 左侧底部 `终端` tab 跳转 `/terminal`。
- [x] terminal session 点击跳转 `/terminal/:sessionId`。
- [x] 旧 `/chats?tab=terminal&terminalId=:id` 在 `WorkbenchLayout` 内临时 redirect 到 `/terminal/:id`。
- [x] 删除过渡用 `components/chats/chats-layout.tsx`，避免继续在 `/chats` 内维护 terminal 分支。
- [x] 修复 `NotificationBell` 默认 `{}` 导致 `useUpdateCheck()` 反复触发的问题。
- [x] 修复嵌入式 `TerminalPane` 在容器尺寸未稳定时 `fitAddon.fit()` 抛错的问题。

验收：

- [ ] `/chats` 默认打开 Chat 新建页，左侧为 Chats tab。
- [ ] `/chats/:sessionId` 打开对应 chat，发送、流式、permission 行为不回退。
- [ ] `/terminal` 打开 Terminal 工作区，左侧为 Terminal tab。
- [ ] `/terminal/:sessionId` 打开对应 terminal，不显示旧 Terminal 详情页头部。
- [ ] 从 `/chats/:id` 切到 `/terminal/:id` 时 Relay WS 不重建为两条连接。
- [ ] ChatPanel unmount 只 release `chat:${sessionId}`。
- [ ] TerminalPane unmount 只 release `terminal:${sessionId}`。
- [ ] `/chats?tab=terminal&terminalId=:id` redirect 到 `/terminal/:id`。
- [ ] `/sessions` 旧页面仍可访问。

执行记录：

- 2026-05-13：开始执行 Phase H，按独立 `/terminal` 路由方案替代 `/chats?tab=terminal` 过渡结构。
- 2026-05-13：新增 `WorkbenchLayout`，`RelayClientProvider` 与 `WorkbenchSidebar` 已上移到 `/chats` 和 `/terminal` 共同父层。
- 2026-05-13：`ChatsPage` 只渲染 `ChatPanel`；`TerminalPage` 渲染 Terminal topbar + `TerminalPane` / `TerminalSessionPicker`。
- 2026-05-13：左侧 tab 和 session 链接已改为 `/chats`、`/chats/:sessionId`、`/terminal`、`/terminal/:sessionId`。
- 2026-05-13：修复 `NotificationBell` 默认对象导致的 `useUpdateCheck()` 最大更新深度问题。
- 2026-05-13：`TerminalPane` 的 `fitAddon.fit()` 增加容器尺寸未稳定时的防御，避免嵌入式页面初始化报错。
- 2026-05-13：抽出 `WorkbenchStatusPill` / `WorkbenchConnectionStatus`，统一 Gateway / Relay / terminal status 的 pill 样式；Gateway 已连接判定兼容 relay session 快照，避免实际可用但一直显示连接中。
- 2026-05-13：`GET /api/server/sessions` 契约收口为默认只返回 `running`；`?status=all` 返回所有非归档状态；`?status=lost` 只返回 lost；`?transport=pty-event-stream` 按 transport 过滤。
- 2026-05-13：Terminal 左侧列表改为首次 HTTP 拉取 `/api/server/sessions?transport=pty-event-stream&limit=30`，后续不再 HTTP 轮询；Relay WS 的 `sessions` frame 只作为 invalidation 信号，收到后 debounce 重新拉 HTTP，避免依赖 WS 快照字段完整性。
- 2026-05-13：旧 `/sessions` 页面改用 `/api/server/sessions?status=all&limit=30`，不受默认 `running` 过滤影响。
- 2026-05-13：`pnpm --filter @tether/web typecheck` 与 `pnpm --filter @tether/web build` 通过。

## 风险点

1. Phase A 允许先共享 WebSocket transport，但只能通过兼容层替换 transport，不能改 chat runtime。
2. 多个组件共享 `sendFrame()` 后，必须避免重复 subscribe 同一个 session。
3. `client.unsubscribe` 只能取消自己 owner 管理的 subscription，不能误伤另一区域。
4. 左侧列表只能读快照，不应该拥有 control session。
5. `SessionSurface` 抽 `TerminalPane` 时，要保留 replay queue、resize、theme、cursor、client mode 现有行为。
6. Chat 和 Terminal 未来都依赖 Relay Provider 后，auth token 刷新和 logout 必须统一关闭连接。
7. Terminal 的 `archive` 不能等同于 `stop`；running terminal 第一版必须先 stop，再允许 archive。

## 暂不做

- 不把 chat message 和 terminal output 合成一种消息模型。
- 不立刻做 chat session 和 PTY session 的持久绑定。
- 不让左侧 sidebar / Terminal tab 发 `client.subscribe`。
- 不复制一套 PTY WebSocket 逻辑给右侧。
- 不在这次重构里改协议。
- 不做永久删除；统一删除语义先收敛为 archive / remove from list。

## 推荐结论

按当前代码状态，最佳路线是：

```text
先建立共享 Relay transport Provider，并用兼容层保证 ChatPanel 行为不变
再在左侧加 Chats / Terminal 切换，Terminal 列表暂时走 HTTP
再补统一 rename/archive 的 Server 接口
再拆 WorkbenchSidebar
再收敛 Relay transport 订阅所有权
再把 ChatPanel 拆小
再抽 TerminalPane
最后把 TerminalPane 接到右侧
```

这样可以同时满足：

- `apps/web/src/components/chats` 继续专注 chat。
- `apps/web/src/components/terminal` 成为 PTY 可嵌入面板。
- 左边面板统一。
- WebSocket 只连一条，但 chat/terminal 业务状态隔离。
