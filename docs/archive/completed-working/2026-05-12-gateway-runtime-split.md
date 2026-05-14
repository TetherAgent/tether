# Gateway Runtime 分层拆分方案

## 背景

`apps/gateway/src/relay-client.ts` 当前同时承担多类职责：

- Relay WebSocket 连接、认证、心跳、重连和 frame 收发。
- `gateway.sessions` 列表合并与 `gateway.sessions-restore` 恢复。
- Chat session 内存状态、并发锁、provider runner、catchup 和事件发送。
- PTY session 订阅、replay、live event 转发、输入、resize、stop 和创建。
- runner socket 可达性检查、lost 标记和 `agent.select` 派生事件检测。

这些职责长期放在一个文件里，会让后续维护时很难判断一个改动到底影响
Relay transport、Chat runtime 还是 PTY runtime。目标是拆清目录和值守职责，
但不拆进程、不拆 package。

## 结论

采用 **目录分层拆分**，不拆成 `apps/gateway-pty` 和 `apps/gateway-chat`。

原因：

- Gateway identity、auth、Relay 连接、heartbeat、session list 仍是 Gateway 级共享能力。
- Chat 和 PTY 都需要通过同一条 Relay Gateway WS 暴露给 Web / CLI / mobile surface。
- 包级或进程级拆分会提前引入跨进程状态同步和部署复杂度，收益不匹配当前阶段。

一句话原则：

> `relay-client.ts` 只保留 transport；`session-catalog` 和 `subscription-manager`
> 是 Chat / PTY 的共享层；`chat-handler` 和 `pty-handler` 只处理各自控制面。

## 非目标

本拆分阶段不做以下事情：

- 不改 Relay / Gateway / Client 协议字段。
- 不改 Server / MySQL schema。
- 不恢复本地 SQLite / Store。
- 不改 Web / CLI 的行为入口。
- 不改变 Chat 远端事实源和 PTY 远端化当前设计。
- 不拆 `apps/gateway` 为多个 package 或多个常驻进程。

## 目标目录

```text
apps/gateway/src/
  relay-client.ts              # WS transport：连接、认证、心跳、重连、send/parse frame
  relay/
    frame-router.ts            # 按 frame.type 分发，不写业务细节
    relay-sender.ts            # send gateway.event/gateway.error/gateway.sessions 的薄封装
    session-catalog.ts         # 合并 chat + PTY sessions，处理 restore/lost/list
    subscription-manager.ts    # subscribe/unsubscribe/detach，共享 chat catchup + PTY replay/live subscribe
    pty-handler.ts             # input/resize/stop/new-pty-session
    chat-handler.ts            # chat/list-providers/cwd-suggest/switch-model/permission_response

  pty/
    manager.ts                 # 当前 pty.ts
    session-runner.ts
    session-runner-client.ts
    session-runner-spawn.ts
    session-runner-process.ts
    agent-select-detector.ts
    replay.ts

  chat/
    chat-runtime.ts
    chat-session-runner.ts
    chat-session-registry.ts
    provider-registry.ts
    providers/
      claude.ts
      codex.ts
      copilot.ts

  utils/
    events.ts
    ids.ts
    mask.ts
    provider-env.ts
```

## 职责边界

### relay-client.ts

只保留 Relay transport：

- 建立 Gateway WS。
- 解析 Relay URL。
- 认证、心跳、重连、关闭。
- 接收 raw frame 后交给 `frame-router`。
- 提供 `send(frame)` 能力给下游模块。

不再直接处理 `client.chat`、`client.input`、`client.resize`、`client.stop`、
`client.subscribe` 等业务 frame。

### relay/frame-router.ts

只做 frame 分发：

- `gateway.auth.ok` / `gateway.auth.failed` 这类 transport 状态交回 `relay-client`。
- `gateway.sessions-restore` 交给 `session-catalog`。
- `client.list` 触发 `session-catalog.sendSessions()`。
- `client.subscribe` / `client.unsubscribe` / `client.detach` 交给 `subscription-manager`。
- `client.input` / `client.resize` / `client.stop` / `client.new-pty-session` 交给 `pty-handler`。
- `client.chat` / `client.list-providers` / `client.cwd-suggest` /
  `client.switch-model` / `client.permission_response` 交给 `chat-handler`。

`frame-router` 不直接访问 `PtySessionManager`、chat runners 或 runner socket。

### relay/session-catalog.ts

负责 Gateway 本地可见 session 目录：

- 维护 Chat registry 与 PTY registry 的合并视图。
- 将 `Session` 转换为 `RelaySession`。
- 处理 `gateway.sessions-restore`，把远端 sessions 恢复进 `PtySessionManager`。
- 过滤 `lost` session。
- 保留 restored PTY session，避免 Gateway 重启后列表丢失。
- 对 running PTY session 做 runner 活性检查。
- runner 不可达时标记 `lost` 并发送 `session.error`。

`session-catalog` 是 Chat / PTY 共享层，不属于任一 runtime。

### relay/subscription-manager.ts

负责 client 订阅状态：

- 管理 `clientId + sessionId -> mode/unsubscribe`。
- 处理 `client.subscribe`、`client.unsubscribe`、`client.detach`。
- Chat session：发送 Gateway 侧 catchup；Relay/Server 历史 catchup 仍由 Relay 服务端负责。
- PTY session：发送进程内 replay 事件，订阅 runner live events 或 `PtySessionManager` events。
- PTY live events 中调用 `agent-select-detector` 派生 `agent.select`。
- 暴露 `requireControlSession(clientId, sessionId, action)` 给 `pty-handler` 使用。

`requireControlSession` 必须保持现有错误语义：

| 条件 | 错误 |
| --- | --- |
| 未订阅 | `not_subscribed` |
| observe 模式 | `observe_only` |
| session 不存在 | `session_not_found` |
| PTY session 非 running | `session_lost` |

### relay/pty-handler.ts

只负责 PTY 控制动作：

- `client.input` -> `runnerClient.write()` 或 `ptySessions.write()`。
- `client.resize` -> `runnerClient.resize()` 或 `ptySessions.resize()`。
- `client.stop` -> `runnerClient.stop()` 或 `ptySessions.stop()`。
- `client.new-pty-session` -> 调用 daemon 注入的 `onNewPtySession()`。

`pty-handler` 必须先调用 `subscription-manager.requireControlSession()`，
不能自己复制订阅 / control mode 判断。

`pty-handler` 禁止：

- 自己维护订阅表。
- 自己处理 `client.subscribe`。
- 自己处理 Relay 账号、gatewayId、session scope 权限。
- 直接 spawn 任意 provider command。
- 从 `client.new-pty-session` 或 `onNewPtySession` 参数中信任客户端传来的 `command`。
- 处理 `client.chat` 或 `permission_response`。

### relay/chat-handler.ts

负责 Chat 控制面：

- `client.chat` 新建或续聊。
- 使用 Relay 注入的 trusted metadata 续聊既有 session。
- 维护 `chatInFlight` 并发锁。
- `agent.result` / `session.error` 后释放并发锁。
- `client.permission_response` 转给对应 provider runner。
- `client.list-providers` 和 `client.cwd-suggest`。
- `client.switch-model` 当前继续返回未实现错误。
- `permission_response` 必须先确认该 client 已订阅对应 session。

`chat-handler` 禁止：

- 调用 PTY `write` / `resize` / `stop`。
- 接受 Web 直接传来的可执行 metadata 作为事实源。
- 读写本地 SQLite。

### chat/chat-session-registry.ts

负责 Chat runtime 的内存状态：

- `chatSessions: Map<string, Session>`。
- `chatInFlight: Set<string>`。
- `upsertFromTrustedMetadata()`。
- `markInFlight()` / `clearInFlight()` / `isInFlight()`。
- `updateAgentSessionId()`。

### chat/provider-registry.ts

负责 provider runner 查找和 provider 列表能力：

- `claude` -> `ChatSessionRunner`。
- `codex` -> `CodexChatRunner`。
- `copilot` -> `CopilotChatRunner`。
- provider installed 检测与 model 列表读取。

### pty/agent-select-detector.ts

从 PTY `terminal.output` 中检测 Claude select prompt，派生 `agent.select`。

它不负责订阅，也不负责发送 frame；只接收 event buffer，返回需要发送的派生事件。

已选择重命名为 `pty/agent-select-detector.ts`，并同步更新 import。不要再新增旧名 `agent-select-detect.ts`。

## 分阶段 TODO

### Wave 1：抽 relay-sender

- [x] 新增 `apps/gateway/src/relay/relay-sender.ts`。
- [x] 收口 `gateway.event`、`gateway.error`、`gateway.sessions` 发送。
- [x] 同步收口 `gateway.chat-catchup`、`gateway.replay`、`gateway.session-created` 发送，或在代码注释中明确它们会在后续 Wave 迁入。
- [x] 保持 `effectiveGatewayId` 来自 relay auth 后的真实 gatewayId。
- [x] `relay-client.ts` 仍拥有底层 `send(frame)`。

验收：

- [x] `gateway.auth.ok` 后仍发送 `gateway.sessions`。
- [x] chat / PTY 错误仍走 `gateway.error`。
- [x] PTY live events 仍走 `gateway.event`。
- [x] chat catchup、PTY replay、session created 的 frame 发送路径没有丢失。

### Wave 2：抽 chat-session-registry

- [x] 新增 `apps/gateway/src/chat/chat-session-registry.ts`。
- [x] 迁出 `chatSessions`。
- [x] 迁出 `chatInFlight`。
- [x] 迁出 `agentSessionId` 更新逻辑。
- [x] 保持 Chat session 不写本地 SQLite。

验收：

- [x] 同一 chat session 第二个请求仍返回 `chat_in_progress`。
- [x] `agent.result` 后锁释放。
- [x] `session.error` 后锁释放。
- [x] `session.agent-id-updated` 仍发送。

### Wave 3：抽 session-catalog

- [x] 新增 `apps/gateway/src/relay/session-catalog.ts`。
- [x] 迁出 `getStoredSession()`。
- [x] 迁出 `listRelaySessions()`。
- [x] 迁出 `toRelaySession()`。
- [x] 迁出 `gateway.sessions-restore` 处理。
- [x] 迁出 `isLiveSession()` / `markSessionLost()` 或提供等价接口。
- [x] 保持 restored PTY session 可见。

验收：

- [x] `client.list` 返回 chat + PTY 合并列表。
- [x] `gateway.sessions-restore` 后 PTY session 进入内存 registry。
- [x] runner socket 丢失时 session 标记 `lost`，并发送 `session.error`。

### Wave 4：抽 subscription-manager 最小版

- [x] 新增 `apps/gateway/src/relay/subscription-manager.ts`。
- [x] 先迁出订阅 Map 和 `subscriptionKey()`。
- [x] 暴露 `requireControlSession(clientId, sessionId, action)`。
- [x] `pty-handler` 前置依赖这个接口，不复制订阅判断。

验收：

- [x] 未订阅时 input/resize/stop 仍返回 `not_subscribed`。
- [x] observe 模式 input/resize/stop 仍返回 `observe_only`。
- [x] session 不存在仍返回 `session_not_found`。

### Wave 5：抽 pty-handler

- [x] 新增 `apps/gateway/src/relay/pty-handler.ts`。
- [x] 迁出 `writeInput()`。
- [x] 迁出 `resizePty()`。
- [x] 迁出 `stopPty()`。
- [x] 迁出 `client.new-pty-session` 处理。
- [x] `client.new-pty-session` 只调用注入的 `onNewPtySession()`，不直接 spawn。
- [x] 从 `RelayClientOptions.onNewPtySession` 类型中删除 `command` 字段。
- [x] `relay-client` 转发 `client.new-pty-session` 给 `onNewPtySession()` 时不再传 `frame.command`。
- [x] `daemon` 继续只用 `providerCommand(provider, options.config)` 决定可执行命令。
- [x] 保持 runner socket 优先，`PtySessionManager` 作为 legacy/local fallback。
- [x] runner socket 写入 / resize / stop 失败时统一走 lost 标记路径，并发送 `gateway.event` 包装的 `session.error`，不能只发给当前 client 一个 `gateway.error`。

验收：

- [x] control 模式可 input。
- [x] control 模式可 resize。
- [x] control 模式可 stop。
- [x] observe 模式不能 input / resize / stop。
- [x] runner socket 不可达时返回 `session_lost`。
- [x] runner socket stop 失败时，当前 client 收到错误，其他订阅者也能收到 `session.error`。
- [x] `client.new-pty-session` 成功后发送 `gateway.session-created` 并刷新 sessions。
- [x] `client.new-pty-session` 传入恶意 `command` 字段不会影响实际启动命令。

### Wave 6：抽 chat-handler

- [x] 新增 `apps/gateway/src/relay/chat-handler.ts`。
- [x] 迁出 `client.chat` 新建和续聊处理。
- [x] 迁出 `client.list-providers`。
- [x] 迁出 `client.cwd-suggest`。
- [x] 迁出 `client.switch-model` 当前未实现响应。
- [x] 迁出 `client.permission_response`。
- [x] `client.permission_response` 必须先确认该 client 已订阅对应 session。
- [x] 未订阅 client 发送 `permission_response` 时返回 `not_subscribed`，不得转发给 provider runner。
- [x] 续聊必须使用 Relay 注入的 trusted metadata。

验收：

- [x] 非白名单 provider 仍返回 `provider_not_supported`。
- [x] existing chat 缺少 trusted metadata 仍返回 `missing_session_metadata`。
- [x] 同 session 并发仍返回 `chat_in_progress`。
- [x] `permission_response` 能转给对应 provider runner。
- [x] 未订阅 client 不能发送 `permission_response`。

### Wave 7：抽 subscription-manager 完整版

- [x] 迁出 `client.subscribe`。
- [x] 迁出 `client.unsubscribe`。
- [x] 迁出 `client.detach`。
- [x] 迁出 chat catchup。
- [x] 迁出 PTY replay，并替换原空 stub 为进程内事件回放。
- [x] 迁出 runner live event subscribe。
- [x] 迁出 `agent.select` 检测调用。
- [x] 关闭 Relay client 时仍清理所有 unsubscribe 和 debounce timer。

验收：

- [x] Chat session subscribe 仍返回 catchup。
- [x] PTY session subscribe 仍能 replay done。
- [x] PTY live output 仍转发到 Relay。
- [x] `agent.select` 仍能从 Claude PTY 输出派生。
- [x] reconnect / close 时订阅清理不泄漏。

### Wave 8：收敛 relay-client.ts

- [x] `relay-client.ts` 只保留 transport 和 wiring。
- [x] 删除已经迁走的业务 helper。
- [x] 保留 `relayGatewayUrl()`、auth resolve、heartbeat、reconnect、close、status。
- [x] 确认无 Chat / PTY 业务逻辑回流。

验收：

- [x] `relay-client.ts` 不直接 import `ChatSessionRunner`。
- [x] `relay-client.ts` 不直接 import `PtySessionManager` 的运行时方法，除类型注入外。
- [x] `relay-client.ts` 不直接实现 `client.chat` / `client.input` / `client.subscribe` 分支细节。

## 必须保持的行为

- `gateway.sessions-restore` 后 PTY session 进入内存 registry。
- `client.new-pty-session` 仍通过 Relay 路由到绑定 Gateway。
- `client.new-pty-session` 的 provider command 由 daemon / config 决定，不信任客户端传来的 command。
- `RelayClientOptions.onNewPtySession` 不暴露 `command` 字段，避免未来实现者误用客户端输入。
- Chat 同 session 并发锁仍生效，`agent.result` / `session.error` 后释放锁。
- `client.chat` existing session 必须使用 Relay 注入的 trusted metadata。
- `permission_response` 不能跨账号 / 未订阅转发。
- PTY observe 模式不能 input / resize / stop。
- runner socket 丢失时 session 标记 `lost`，并发送 `session.error`。
- `agent.select` 派生事件仍能从 Claude PTY 输出检测出来。
- `terminal.output`、`session.exited`、`agent.status` 等事件仍按 Relay whitelist 同步到 Server。

## 验证命令

最小验证：

```bash
pnpm --filter @tether/gateway typecheck
pnpm --filter @tether/gateway test -- relay-client.test.ts
pnpm --filter @tether/gateway test -- chat-session-runner.test.ts
pnpm --filter @tether/gateway test -- session-runner.test.ts
pnpm --filter @tether/gateway test -- pty.test.ts
```

影响 Relay 路由、scope、frame 或新建 PTY session 时加跑：

```bash
pnpm --filter @tether/relay typecheck
pnpm --filter @tether/relay test -- relay.test.ts
```

影响 CLI 创建、attach、stop 或 debug 时加跑：

```bash
pnpm --filter @tether-labs/cli typecheck
```

涉及真实 PTY / runner 行为时，必须做一次人工 UAT：

```bash
pnpm tether restart
pnpm tether run shell
pnpm tether ls
pnpm tether stop <session-id>
```

人工确认：

- Web/CLI 能看到新建 PTY session。
- PTY 输出能实时显示。
- control 模式能输入。
- observe 模式不能输入。
- stop 后 session 正确退出或变为 lost。

## 已知后续清理

本方案只定义 runtime 分层拆分。以下清理属于相邻任务，不混入结构拆分：

- `apps/cli/src/main.ts` 中 `verifyGatewaySession()` 仍尝试调用本地
  `/api/sessions/:id/stop` 的残留修复。
- `docs/working/2026-05-12-remove-local-sqlite.md` 的 TODO 状态回填。
