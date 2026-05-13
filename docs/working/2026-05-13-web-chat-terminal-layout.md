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
session-surface.tsx              -> 先保留；Step 6 内部改用 components/terminal/terminal-pane.tsx
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

`use-chat-relay-socket.ts` 当前已经是 shared singleton，但只有一个 `activeSubscriber`，并不适合直接支撑左中右多个消费者。拆成 Provider 时状态边界如下：

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
当前 /sessions 仍有独立终端列表页，数据读取和 WS list 逻辑还在 apps/web/src/main.tsx
```

所以第一版最小改动是前端过滤 `transport !== 'chat'`。如果希望服务端过滤，需要在 Server 侧补：

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
3. 第一版不依赖共享 WebSocket，降低改动范围。
4. 后续接入 Relay Provider 后，只需要把在线状态和运行中快照叠加到同一列表模型上。

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

这样 chat 和 terminal 都能保留用户标题，避免后续 Gateway sync 覆盖。

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

## 迁移步骤

## 可执行 TODO 总表

### Phase A：左侧信息架构先落地

- [ ] 在左侧账号区上方、列表底部空白处加入 `Chats / Terminal` 切换。
- [ ] `/chats` 默认显示 `Chats` tab。
- [ ] `/chats?tab=terminal` 显示 `Terminal` tab，刷新后保持该 tab。
- [ ] `Chats` tab 继续使用 `/api/server/chat-sessions`。
- [ ] `Terminal` tab 使用 `/api/server/sessions?limit=30`，前端过滤 `transport !== 'chat'`。
- [ ] 当前阶段点击 terminal session 跳转 `/remote/session/:sessionId`。
- [ ] 保留 `/sessions` 旧终端列表页，不在第一阶段删除。

验收：

- [ ] `pnpm --filter @tether/web typecheck`
- [ ] `pnpm --filter @tether/web build`
- [ ] 手动打开 `/chats`，默认仍能看到 chat 列表和新建会话入口。
- [ ] 手动打开 `/chats?tab=terminal`，能看到 terminal session，且不混入 `transport = 'chat'`。
- [ ] Terminal session 点击后进入 `/remote/session/:sessionId`。
- [ ] `/sessions` 旧页面仍可访问。

### Phase B：统一会话动作 Server 能力

- [ ] 新增 `PATCH /api/server/sessions/:id/title`。
- [ ] 新增 `POST /api/server/sessions/:id/archive`。
- [ ] `rename` 权限校验使用 `account_id + user_id + session id`。
- [ ] `rename` 写入 `title_source = 'user'`。
- [ ] `archive` 对 running terminal 返回业务错误，提示先 stop。
- [ ] Terminal archive 第一版采用 soft hide，保留 `gateway_runtime_events` 和 replay 数据。
- [ ] 保留旧 `PUT /api/server/chat-sessions/:id` / `DELETE /api/server/chat-sessions/:id`，避免破坏现有 chat。

验收：

- [ ] chat rename 走新接口后不会被 Gateway sync 覆盖。
- [ ] terminal rename 走新接口后不会被 Gateway sync 覆盖。
- [ ] running terminal archive 被拒绝。
- [ ] stopped/lost/completed terminal archive 后不再出现在 Terminal tab。
- [ ] terminal archive 后 replay 数据仍保留。
- [ ] 旧 chat rename/delete 接口仍可用。

### Phase C：拆 WorkbenchSidebar

- [ ] `AppSidebar` 拆成 `components/workbench/workbench-sidebar.tsx`。
- [ ] 拆出 `workbench-session-list.tsx`。
- [ ] 拆出 `workbench-session-actions.tsx`。
- [ ] 拆出 `rename-session-dialog.tsx`。
- [ ] 拆出 `archive-session-dialog.tsx`。
- [ ] 数据读取收口到 `hooks/workbench/use-workbench-sessions.ts`。
- [ ] action 能力按 `kind` 区分：chat 支持 rename/archive，terminal 支持 rename、非 running archive、running stop。

验收：

- [ ] 新建 chat 后左侧刷新不丢。
- [ ] Chat tab 和 Terminal tab 的选中状态互不污染。
- [ ] rename/archive/stop 的按钮只在对应 session kind 和 status 下出现。
- [ ] 账号菜单、主题切换、logout 行为不变。

### Phase D：拆共享 Relay transport

- [ ] 把 `use-chat-relay-socket.ts` 提升为 `components/relay/relay-client-provider.tsx`。
- [ ] 新增 `components/relay/use-relay-client.ts`。
- [ ] Provider 只保留 WebSocket、auth、reconnect、sendFrame、frame fan-out、online gateway ids、relaySessions 快照。
- [ ] Chat runtime 状态下沉到 `hooks/chats/use-chat-runtime.ts`。
- [ ] Terminal runtime 状态下沉到 `hooks/terminal/use-terminal-runtime.ts`。
- [ ] Provider 内实现 subscription owner/ref count。
- [ ] `ChatPanel` 使用 `chat:${sessionId}` owner。
- [ ] `TerminalPane` 使用 `terminal:${sessionId}` owner。

验收：

- [ ] 中间 chat 可以正常 subscribe、发送、接收 `agent.delta` / `agent.result`。
- [ ] ChatPanel unmount 只释放自己的 owner。
- [ ] TerminalPane unmount 只释放自己的 owner。
- [ ] 同一共享 WS 下不会出现一边 unmount 断掉另一边订阅。
- [ ] Gateway 在线/离线状态仍正常显示。

### Phase E：拆 ChatPanel

- [ ] 先搬 `MessageItem`、`UsageStats`、`RelaySessionSummary` 等类型。
- [ ] 搬 `compactPathLabel()`、`historyMessagesToItems()`、`historySnapshotLooksOlder()`、`usageStatsFromHistory()` 等纯函数。
- [ ] 将平铺 message 组件迁到 `components/chats/messages/`。
- [ ] 拆 `ChatMessageList`。
- [ ] 拆 `ChatComposer`。
- [ ] 拆 `ChatHeader`。
- [ ] 拆 `NewChatSurface`。
- [ ] 最后把 chat frame 处理移到 `use-chat-runtime.ts`。

验收：

- [ ] 首条消息创建 session 后仍跳转 `/chats/:sessionId`。
- [ ] `agent.delta` 流式输出正常。
- [ ] `agent.result` 不重复追加。
- [ ] permission prompt 仍可 allow/deny。
- [ ] provider resume command 复制仍正常。

### Phase F：抽 TerminalPane

- [ ] 新增 `components/terminal/terminal-pane.tsx`。
- [ ] 新增 `hooks/terminal/use-terminal-instance.ts`。
- [ ] 新增 `hooks/terminal/use-terminal-runtime.ts`。
- [ ] 新增 `hooks/terminal/use-terminal-composer.ts`。
- [ ] `SessionSurface` 内部改用 `TerminalPane`。
- [ ] 保留整页 `/remote/session/:sessionId` 路由。

验收：

- [ ] `/remote/session/:sessionId` 正常显示 PTY。
- [ ] 输入、stop、observe/control、replay 不回退。
- [ ] light/dark 主题正常。
- [ ] terminal resize / fit addon 正常。

### Phase G：右侧接入 Terminal

- [ ] `WebWorkbenchLayout` 支持右侧 panel。
- [ ] 右侧默认折叠。
- [ ] 右侧展开后显示 terminal session picker。
- [ ] 从左侧 Terminal tab 点击 session 时在右侧打开，不离开 `/chats`。
- [ ] URL 更新为 `/chats?tab=terminal&terminalId=:sessionId`。
- [ ] Chat 和 Terminal 共享 Relay transport，但各自拥有 runtime state 和 subscription owner。

验收：

- [ ] 中间 chat 和右侧 terminal 同时打开不互相抢订阅。
- [ ] Chat 的 `agent.delta` 不影响 terminal output。
- [ ] Terminal 的 `terminal.output` 不进入 chat message list。
- [ ] 断线重连后两个区域都能恢复。
- [ ] 移动端不同时显示两列，使用 tab 或 bottom sheet。

### Step 1：左侧加入 Chats / Terminal 切换，暂时全部走 HTTP

目标：

- 在左侧账号区上方、列表底部空白处加入 `Chats / Terminal` 切换。
- `Chats` tab 继续显示现有 chat sessions。
- `Terminal` tab 通过 `/api/server/sessions?limit=30` 拉取会话，并在前端过滤 `transport !== 'chat'`。
- tab 状态记录到 URL：`/chats?tab=terminal`，默认 `/chats` 等同于 `tab=chats`。
- 第一版只走 HTTP，不接 Relay WS。
- 保留现有账号菜单、主题切换、logout。

验收：

```bash
pnpm --filter @tether/web typecheck
pnpm --filter @tether/web build
```

人工检查：

- 切到 `Chats` 仍能新建 chat、进入已有 chat。
- 切到 `Terminal` 能看到 PTY session 列表，且不会混入 `transport = 'chat'` 的会话。
- 刷新 `/chats?tab=terminal` 后仍停在 Terminal tab。
- 当前阶段点击 terminal session 跳转 `/remote/session/:sessionId`。
- 两个 tab 切换不影响登录态和账号菜单。
- 30s visibility refresh 仍正常。

### Step 2：补统一会话动作 Server 接口

目标：

- 新增 `PATCH /api/server/sessions/:id/title`，统一 chat 和 terminal rename。
- 新增 `POST /api/server/sessions/:id/archive`，统一 archive / remove from list。
- `rename` 写 `title_source = 'user'`。
- `archive` 对 running terminal 返回业务错误，提示先 stop。
- 旧 `PUT /api/server/chat-sessions/:id` 和 `DELETE /api/server/chat-sessions/:id` 先保留，避免一次性迁移破坏现有 chat。

验收：

- chat rename 走新接口后不会被 Gateway sync 覆盖。
- terminal rename 走新接口后不会被 Gateway sync 覆盖。
- running terminal archive 被拒绝。
- stopped/lost/completed terminal archive 后不再出现在 Terminal tab。
- terminal archive 后 replay 数据仍保留。
- 旧 chat rename/delete 接口仍可用。

### Step 3：拆 WorkbenchSidebar

目标：

- `AppSidebar` 改名/拆分成 `WorkbenchSidebar`。
- session list、rename dialog、archive dialog 拆成独立组件。
- `WorkbenchSidebar` 内部持有 `activeTab: 'chats' | 'terminal'`。
- 数据读取收口到 `use-workbench-sessions.ts`。
- action 能力按 `kind` 区分：chat 支持 rename/archive，terminal 支持 rename、非 running archive、running stop。

验收：

- rename 行为对 chat 和 terminal 都不被 Gateway sync 覆盖。
- archive 不会误杀 running terminal。
- 新建 chat 后左侧刷新不丢。
- Terminal tab 不影响 Chat tab 的选中状态。

### Step 4：拆共享 Relay transport

目标：

- 把 `use-chat-relay-socket.ts` 提升为 `components/relay/relay-client-provider.tsx`。
- `ChatsLayout` 外层包 `RelayClientProvider`。
- `ChatPanel` 从 `useRelayClient()` 取 `sendFrame` 和 frame 订阅。
- 左侧列表仍以 HTTP 为事实源，只叠加 WS 在线状态。

验收：

```bash
pnpm --filter @tether/web typecheck
pnpm --filter @tether/web build
```

人工检查：

- 打开 `/chats`
- 新建 chat
- 进入已有 chat
- Gateway 在线/离线状态仍正常

### Step 5：拆 ChatPanel 内部结构

目标：

- 先拆纯类型和纯函数。
- 按“现有文件迁移去向”把平铺 message 组件移动到 `components/chats/messages/`。
- 再拆 `ChatMessageList`、`ChatComposer`、`ChatHeader`、`NewChatSurface`。
- 最后把 chat runtime frame 处理移到 `use-chat-runtime.ts`。

验收：

- 首条消息创建 session 后仍跳转 `/chats/:sessionId`。
- `agent.delta` 流式输出正常。
- `agent.result` 不重复追加。
- permission prompt 仍可 allow/deny。
- provider resume command 复制仍正常。

### Step 6：抽 TerminalPane

目标：

- 从 `SessionSurface` 里抽出可嵌入 `TerminalPane`。
- 整页 `/remote/session/:sessionId` 先改用 `TerminalPane`。
- 不接入 chats 右侧。

验收：

- `/remote/session/:sessionId` 正常显示 PTY。
- 输入、stop、observe/control、replay 不回退。
- light/dark 主题正常。

### Step 7：接入右侧 Terminal

目标：

- `WebWorkbenchLayout` 支持右侧 panel。
- 右侧先手动选择已有 PTY session；从左侧 Terminal tab 点击 session 时在右侧打开，不离开 `/chats`。
- Chat 和 Terminal 共享 relay transport，但各自 subscribe 自己的 session。

验收：

- 中间 chat 和右侧 terminal 同时打开不互相抢订阅。
- ChatPanel unmount 只能 unsubscribe 自己的 chat owner。
- TerminalPane unmount 只能 unsubscribe 自己的 terminal owner。
- Chat 的 `agent.delta` 不影响 terminal output。
- Terminal 的 `terminal.output` 不进入 chat message list。
- 断线重连后两个区域都能恢复。

## 风险点

1. 多个组件共享 `sendFrame()` 后，必须避免重复 subscribe 同一个 session。
2. `client.unsubscribe` 只能取消自己 owner 管理的 subscription，不能误伤另一区域。
3. 左侧列表只能读快照，不应该拥有 control session。
4. `SessionSurface` 抽 `TerminalPane` 时，要保留 replay queue、resize、theme、cursor、client mode 现有行为。
5. Chat 和 Terminal 未来都依赖 Relay Provider 后，auth token 刷新和 logout 必须统一关闭连接。
6. Terminal 的 `archive` 不能等同于 `stop`；running terminal 第一版必须先 stop，再允许 archive。

## 暂不做

- 不把 chat message 和 terminal output 合成一种消息模型。
- 不立刻做 chat session 和 PTY session 的持久绑定。
- 不让左侧 sidebar 发 `client.subscribe`。
- 不复制一套 PTY WebSocket 逻辑给右侧。
- 不在这次重构里改协议。
- 不做永久删除；统一删除语义先收敛为 archive / remove from list。

## 推荐结论

按当前代码状态，最佳路线是：

```text
先在左侧加 Chats / Terminal 切换，列表暂时走 HTTP
再补统一 rename/archive 的 Server 接口
再拆 WorkbenchSidebar
再共享 Relay transport
再把 ChatPanel 拆小
再抽 TerminalPane
最后把 TerminalPane 接到右侧
```

这样可以同时满足：

- `apps/web/src/components/chats` 继续专注 chat。
- `apps/web/src/components/terminal` 成为 PTY 可嵌入面板。
- 左边面板统一。
- WebSocket 只连一条，但 chat/terminal 业务状态隔离。
