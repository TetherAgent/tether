# Chat 会话切换状态隔离排查

日期：2026-05-14

> 状态：已被后续 Restore flow 定案和实现取代。
>
> 本文保留为历史排查记录。当前规范以 `apps/web/CLAUDE.md` 的 Chat 时序规范和
> `docs/working/2026-05-15-offline-gateway-session-navigation.md` 为准：
> `activeSessionId` 切换后必须立即进入当前 session 的 restoring/loading/offline pending 状态，
> Server snapshot/catch-up path 立即启动，不等待 `subscription.ack`；live subscribe 只负责
> realtime ready。本文中关于 `lastDeltaEventIdRef`、`currentAgentIdRef`、
> `historySnapshotLooksOlder()` 和 `gateway.chat-catchup` 的描述均为旧实现背景，不是当前实现
> 或未来方案依据。

## 背景

在 Web Chat 左侧会话列表中反复切换会话时，右侧详情区可能出现：

- 消息列表短暂显示上一个会话内容。
- 当前会话历史没有及时更新。
- 右上角 provider session ID、底部 provider/cwd/usage 等元数据和当前选中的会话不一致。
- 左侧高亮已经切到新会话，但右侧仍像停留在旧会话。

本文件只记录排查结论、待办和验证项，不改变当前实现。

## 当前代码事实

### 路由与组件生命周期

- `/chats/:sessionId` 由 `apps/web/src/pages/chats-page.tsx` 读取 `useParams()` 后传入 `ChatPanel.activeSessionId`。
- `ChatPanel` 在同一路由组件内随参数变化复用同一个 React 组件实例。
- 因此会话切换不会自动重置 `ChatPanel` 内部 state，必须由 `activeSessionId` effect 主动清理和隔离。

### 右侧消息历史加载

位置：`apps/web/src/components/chats/chat-panel.tsx`

`loadActiveSessionHistory(sessionId)` 当前流程：

1. 读取 token。
2. 将 `lastDeltaEventIdRef.current` 置为 `0`。
3. 调用 `fetchChatMessages(sessionId, token)`。
4. 请求返回后写入：
   - `lastDeltaEventIdRef.current`
   - `currentAgentIdRef.current`
   - `isInflight`
   - `usageStats`
   - `messages`

问题：请求返回后没有检查 `sessionId === currentSessionIdRef.current`。

如果用户快速切换 A -> B，A 的历史请求晚于 B 返回，A 会覆盖当前 B 的右侧消息和 usage 状态。

### 右侧元数据加载

位置：`apps/web/src/components/chats/chat-panel.tsx`

`loadActiveSessionMetadata(sessionId)` 当前流程：

1. 调用 `fetchChatSessions(token)`。
2. 从列表中找到 `session.id === sessionId`。
3. 写入：
   - `agentSessionId`
   - `activeSessionProvider`
   - `activeSessionProjectPath`
   - `activeSessionGatewayId`
   - `activeSessionModel`
   - `activeSessionMetadataReady`

问题：请求返回后没有检查 `sessionId === currentSessionIdRef.current`。

如果旧会话 metadata 请求晚返回，会覆盖当前会话 header、provider、cwd、gateway 和 metadata ready 状态。

### 切换会话时的即时清理不足

`activeSessionId` 变化时当前会清理：

- `sessionAccessError`
- `agentSessionId`
- `activeSessionProjectPath`
- `activeSessionGatewayId`
- `activeSessionMetadataReady`
- `activeSessionProvider`
- `activeSessionModel`

但没有同步清理：

- `messages`
- `usageStats`
- `isInflight`
- `currentAgentIdRef`
- `lastDeltaEventIdRef`

因此新会话历史返回前，右侧可能短暂保留旧会话内容。

### WebSocket 实时帧防串情况

`gateway.chat-catchup`、`user.message`、`agent.delta`、`agent.result`、`agent.tool`、`agent.permission_request` 等分支大多已有：

```ts
if (frame.sessionId !== currentSessionIdRef.current) {
  return;
}
```

所以实时帧不是当前优先怀疑点。主要风险在 HTTP 历史加载和 metadata 加载的异步返回。

### 左侧列表加载

位置：`apps/web/src/hooks/workbench/use-workbench-sessions.ts`

`loadSessions()` 会在 `activeSessionId`、`refreshKey`、visibility change 等场景触发，但没有请求序号或取消保护。

旧的 session list 请求晚返回时，可能覆盖更新后的左侧列表，导致标题、排序、状态短暂滞后。

该问题不直接导致右侧消息串 session，但会放大“左侧和右侧看起来不一致”的感知。

## 设计原则

- 不用粗暴 `key={sessionId}` remount 作为主方案。
- 保留当前 `ChatPanel` 的 pending new session / optimistic message 流程。
- 会话隔离应在异步写 state 前完成。
- 所有异步 catch 分支也必须做会话一致性判断，避免旧请求错误覆盖当前会话。
- 修复范围优先限制在 Web 层，不改 relay/server 协议。

## TODO

- [ ] 在 `ChatPanel` 增加 history load 的 session 一致性保护。
  - `fetchChatMessages()` 返回后，如果 `sessionId !== currentSessionIdRef.current`，直接丢弃结果。
  - 不允许旧请求写入 `messages`、`usageStats`、`isInflight`、`currentAgentIdRef`、`lastDeltaEventIdRef`。

- [ ] 在 `ChatPanel` 增加 metadata load 的 session 一致性保护。
  - `fetchChatSessions()` 返回后，如果 `sessionId !== currentSessionIdRef.current`，直接丢弃结果。
  - 不允许旧请求写入 `agentSessionId`、`provider`、`projectPath`、`gatewayId`、`metadataReady`。

- [ ] 修复 history load 的 catch 分支。
  - 修复位置在调用处 effect，不在 `loadActiveSessionHistory()` 函数内部。
  - 调用前捕获目标 session：

```ts
const targetId = activeSessionId;
void loadActiveSessionHistory(targetId).catch(() => {
  if (targetId !== currentSessionIdRef.current) return;
  setMessages([{ kind: 'system', id: 'history-error', text: t.chatsHistoryFail }]);
});
```

- [ ] 修复 metadata load 的 catch 分支。
  - 修复位置在调用处 effect，不在 `loadActiveSessionMetadata()` 函数内部。
  - 调用前捕获目标 session：

```ts
const targetId = activeSessionId;
void loadActiveSessionMetadata(targetId).catch(() => {
  if (targetId !== currentSessionIdRef.current) return;
  setActiveSessionMetadataReady(true);
});
```

- [ ] 切换已有会话时立即清理右侧旧状态。
  - 清理 `messages`。
  - 清理 `usageStats`。
  - 设置 `isInflight(false)`。
  - 设置 `currentAgentIdRef.current = null`。
  - 设置 `lastDeltaEventIdRef.current = 0`。
  - `lastDeltaEventIdRef.current = 0` 在正常历史加载路径中会由 `loadActiveSessionHistory()` 同步执行，因此这里属于冗余清理；真正关键的是 TODO 1 的返回后 guard，防止旧请求晚返回后把旧 session 的 `lastEventId` 写回来。
  - 注意：新建会话的 optimistic message / pending created session 路径不能被误清理。
  - 清理条件必须排除两个 ref 保护路径：

```ts
if (
  activeSessionId &&
  pendingCreatedSessionIdRef.current !== activeSessionId &&
  skipNextHistoryLoadSessionIdRef.current !== activeSessionId
) {
  setMessages([]);
  setUsageStats(undefined);
  setIsInflight(false);
  currentAgentIdRef.current = null;
  lastDeltaEventIdRef.current = 0;
}
```

  - `pendingCreatedSessionIdRef`：用户刚发出第一条消息，session 还在等 gateway 创建。
  - `skipNextHistoryLoadSessionIdRef`：`gateway.session-created` 已到达，当前已有 optimistic 消息，不应重新拉历史或清空本地消息。

- [ ] 检查 reconnect catchup 路径。
  - `connectionEpoch` 触发的 `loadActiveSessionMetadata()` 和 `loadActiveSessionHistory(..., { protectNewerLocal: true })` 应自动继承一致性保护。

- [ ] 给 `useWorkbenchSessions.loadSessions()` 增加请求序号保护。
  - 旧请求返回时，如果不是当前 tab 的最新请求，丢弃结果。
  - 避免左侧列表被旧响应覆盖。

- [ ] 保持 WebSocket frame 现有 session guard。
  - 不需要重构 relay event 分发。
  - 只在发现漏网 frame 时补充 `sessionId` 检查。

## 验证项目

### 自动验证

- [x] 已新增 Web 单测入口：

```bash
pnpm --filter @tether/web test
```

覆盖文件：

- `apps/web/test/session-switch-guards.test.ts`
- `apps/web/src/components/chats/session-switch-guards.ts`

覆盖点：

- stale history / metadata response 不应写入当前会话。
- stale catch 分支不应覆盖当前会话。
- 切换已有会话时应清理旧状态。
- `pendingCreatedSessionIdRef` 不应清掉新建会话 optimistic 消息。
- `skipNextHistoryLoadSessionIdRef` 不应清掉已创建会话的 optimistic 消息。
- 左侧 session list 旧请求不应覆盖最新 tab / 最新请求。

- [x] 运行 Web 类型检查：

```bash
pnpm --filter @tether/web typecheck
```

- [x] 如修改了 hook 或工具函数并新增测试，运行对应测试：

```bash
pnpm --filter @tether/web test
```

Web 包已新增 `test` 脚本，使用仓库现有的 `tsx --test` 风格。

### 手工验证

- [ ] 打开 Web Chat 页面，准备至少 3 个已有 Claude chat session。
- [ ] 快速连续点击左侧会话 A -> B -> C。
  - 预期：右侧不会显示 A/B 的消息残留。
  - 预期：C 的历史加载完成后只显示 C 的消息。

- [ ] 在 Network 面板限速为 Slow 3G 或手动制造接口延迟后重复切换。
  - 预期：旧会话的 `/api/server/chat-sessions/:id/messages` 晚返回不会覆盖当前会话。
  - 预期：旧的 `/api/server/chat-sessions` 晚返回不会覆盖当前 metadata。

- [ ] 在会话 A 正在流式输出时切到会话 B。
  - 预期：A 的后续 `agent.delta` / `agent.result` 不会写入 B。
  - 预期：B 的输入框不会因为 A 的 `isInflight` 状态被禁用。

- [ ] 切换到一个带 provider session ID 的会话。
  - 预期：右上角 provider session ID 与当前会话一致。
  - 预期：复制出来的 resume 命令使用当前会话的 provider 和 agent session ID。

- [ ] 切换到不同 gateway / cwd 的会话。
  - 预期：底部状态 popover 显示当前会话的 gateway、cwd、model。
  - 预期：不会显示上一个会话的 cwd。

- [ ] 新建一个 chat session。
  - 预期：发送第一条消息后的 optimistic user/agent waiting 消息仍保留。
  - 预期：`gateway.session-created` 后不会被“切换清理逻辑”误清空。

- [ ] 断开并恢复 Relay/WebSocket 后重复切换。
  - 预期：reconnect catchup 不会把旧 session 历史覆盖到当前 session。
  - 预期：订阅 `after` 游标不使用旧 session 的 `lastDeltaEventId`。

## 不做事项

- 不改 server 数据模型。
- 不改 relay session broadcast 协议。
- 不把 `ChatPanel` 简单改成按 `sessionId` remount，除非后续验证证明显式状态隔离仍不足。
- 不把左侧列表和右侧详情强行合并成单一大 store；当前问题可在局部异步边界修复。
