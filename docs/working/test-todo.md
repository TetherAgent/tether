# 测试补充 TODO

> 测试框架：Node.js built-in `node:test` + `assert/strict`，不引入第三方测试库。
> 优先级：P0 = 安全/隔离/不可回归，P1 = 核心业务链路，P2 = 辅助单元

---

## 一、端到端链路场景（跨层集成测试）

这些场景涉及多个模块协作，是最容易静默回归的地方。建议单独放一个测试文件
`gateway/test/integration/` 或直接在现有 `relay-client.test.ts` 中扩展。

### L1 — PTY Session 全流程（新建 session → 订阅 → 输入 → 退出）

```
client.new-pty-session
  → PtyHandler.handleNewSession
  → onNewPtySession()
  → relaySender.sessionCreated + sendSessions
  → client.subscribe
  → SubscriptionHandler.subscribeClient + PTY event forwarding
  → session.exited → client 收到退出通知
```

- [ ] 新建 session 成功 → `gateway.session-created` + 随后的 `gateway.sessions` 按顺序发出
- [ ] 订阅后 PTY 输出 → 事件经 `relaySender.event` 转发给所有订阅者
- [ ] 订阅时携带 `after` 参数 → replay 从该 eventId 之后开始，不重发旧事件
- [ ] `session.exited` 事件 → 所有订阅该 session 的 client 都收到，不只是发起 stop 的那个

### L2 — Gateway 重连 → Session 恢复链路

```
WS 断开
  → subscriptions.clear()
  → scheduleReconnect（指数退避）
  → gateway.auth 重发
  → gateway.sessions-restore
  → sessionCatalog.restoreRelaySessions（PID 活性检查）
  → sendSessions（恢复后发布 session 列表）
```

- [x] 断开后所有订阅状态被清空（不复用旧订阅）→ `relay-client.test.ts` L2
- [ ] 重连延迟指数退避：1s → 2s → 4s → 5s（上限），成功后重置为 1s
- [ ] `auth_failed` 且 permanent=true → `closed=true`，不再重连
- [ ] `gateway.sessions-restore` → PID 存活的 session 恢复为 running
- [ ] `gateway.sessions-restore` → PID 不存活的 session 恢复为 lost
- [ ] 恢复后立即调用 `sendSessions`，将最新 session 列表推送给 Relay

### L3 — Runner 失联 → 所有订阅者同步收到 session.error

```
runnerClient.write/resize/stop 失败
  → sessionCatalog.markSessionLost
  → session 状态更新为 lost
  → relaySender.event(session.error)  ← 发给所有订阅者，不只是触发者
  → onSessionsChanged → sendSessions
```

- [x] A、B 两个 client 都订阅了同一个 PTY session → `relay-client.test.ts` L3
- [x] A 发送 `client.input` → 两者都能收到 PTY terminal.output（`sendEventToSubscribers` 广播）→ L3
  - 注：PTY write 失败时 `sendChatEventToSubscribers` 对 PTY 无效（chatSessionSubscribers 为空），
    只有触发 client 收到 `gateway.error { session_lost }`，另一 client 只收到 sessions 列表更新
- [x] `markSessionLost` 调用一次后，session.status=lost，第二次调用不重复 emit 事件 → `session-catalog.test.ts`

### L4 — Chat Session 全流程（新建 → delta 流 → result → 续聊）

```
client.chat (sessionId=null)
  → ChatHandler.handleChat → runner.run
  → onChatSessionCreated → registry.upsertFromMetadata + chatSessionCreated
  → onDelta * N → gateway.event(agent.delta)
  → onResult → releaseInFlight + gateway.event(agent.result)
  → 续聊 client.chat (sessionId=existing)
  → markInFlight → runner.run
```

- [ ] 新建 session：`gateway.chat-session-created` 先于 `agent.delta` 发出
- [ ] `onDelta` 多次调用 → 每次都发出 `agent.delta` 事件，携带 deltaEventId
- [ ] `onResult` → `releaseInFlight` 一定在 `agent.result` 事件之前调用（不能卡锁）
- [ ] `onError` → `releaseInFlight` + `gateway.error` + `session.error` 事件都发出
- [ ] 续聊时已有 session in-flight → 返回 `chat_in_progress`，不发起第二次 run
- [x] 客户端订阅 mid-stream 的 chat session → 收到 `gateway.chat-catchup` → `relay-client.test.ts` L4

### L5 — Chat Permission 流程

```
runner 触发工具需要授权
  → onPermissionRequest → gateway.event(agent.permission_request)
  → client 发 client.permission_response（需已订阅）
  → ChatHandler.handlePermissionResponse
  → runner.respondToPermission
```

- [ ] 未订阅的 client 发 `permission_response` → 返回 `not_subscribed`，不转发给 runner
- [ ] 已订阅但 session 不存在 → `session_not_found`
- [ ] 已订阅且 session 存在 → `runner.respondToPermission(sessionId, requestId, decision)` 被调用

### L6 — Gateway Auth Token 刷新链路

```
loadGatewayAuthState
  → token 距过期 < 5min → refreshGatewayAuthState
  → POST /api/relay/gateway/refresh
  → 解析新 accessToken payload 取 expiresAt
  → writeFile(auth.json, mode=0o600)
  → 返回新 state
```

- [ ] token 未过期且剩余 > 5min → 直接返回，不触发刷新
- [ ] token 剩余 < 5min → 调用刷新，刷新成功 → 返回新 state 并写入磁盘
- [ ] token 剩余 < 5min，刷新失败，但 token 仍未过期 → 使用原 state（不抛错）
- [ ] token 剩余 < 5min，刷新失败，且 token 已过期 → 返回 `{ ok: false, status: 401 }`
- [ ] auth.json 不存在 → `{ ok: false, status: 401, error: 'gateway_auth_missing' }`
- [ ] auth.json 格式无效 → `{ ok: false, status: 500, error: 'gateway_auth_invalid' }`

### L7 — CLI Attach 重连延迟链路

```
attachPtySession (reconnect=true)
  → attachPtySessionOnce 失败
  → attempt++ → delay = min(500 * attempt, 5000)
  → sleep(delay)
  → 重试，latestEventId 携带上次最大值（保证 replay 续接）
```

- [ ] 第 1 次重连等 500ms，第 2 次 1000ms，……第 10 次等 5000ms（上限）
- [ ] 每次重连携带上次 session 中收到的最大 `latestEventId`，不从 0 开始 replay
- [ ] auth 失败不进入重连循环，直接抛错

---

## 二、单元测试（按模块）

### apps/gateway

#### P0 — utils/gateway-auth.test.ts（新建）

`src/utils/gateway-auth.ts` 负责凭证读写和 token 刷新，是 Gateway 接入 Relay 的关键。

- [x] `parseGatewayAuthState` — 合法 JSON → GatewayAuthState
- [x] `parseGatewayAuthState` — 缺少任意必填字段 → undefined
- [x] `parseGatewayAuthState` — 字段类型错误（expiresAt=string）→ undefined
- [x] `parseGatewayAuthState` — 非法 JSON → undefined
- [x] `decodeGatewayToken` — 合法 3 段 JWT → 返回 payload 对象
- [x] `decodeGatewayToken` — 段数不为 3 → undefined
- [x] `decodeGatewayToken` — payload 不是合法 JSON → undefined
- [x] `refreshGatewayAuthState` — HTTP 非 2xx → undefined（不抛错）
- [x] `refreshGatewayAuthState` — 响应缺少 accessToken/refreshToken → undefined
- [x] `refreshGatewayAuthState` — 成功 → 写入 auth.json（mode=0o600），返回新 state
- [x] `loadGatewayAuthState` — 全部上述链路场景（见 L6）→ `gateway-auth.test.ts`

#### P0 — relay/session-catalog.test.ts（新建）

`src/relay/session-catalog.ts` 是 Chat + PTY session 合并层，涉及 lost 判断和多租户数据正确性。

- [x] `listRelaySessions` — chat session 直接列出，不经过 live 检查
- [x] `listRelaySessions` — pty session status=running 且 ping 成功 → 列出
- [x] `listRelaySessions` — pty session status=running 但 ping 失败 → 标记 lost，不列出
- [x] `listRelaySessions` — pty session status=lost → 过滤掉
- [x] `listRelaySessions` — 同一 id 同时在 chat 和 pty registry → 以 chat 为准，不重复
- [x] `restoreRelaySessions` — pid 存活 → status=running
- [x] `restoreRelaySessions` — pid 不存活 → status=lost
- [x] `restoreRelaySessions` — 无 pid → 使用 relaySession.status
- [x] `markSessionLost` — 只对 status=running 触发，非 running 不重复 emit
- [x] `markSessionLost` — 触发后 `onSessionsChanged` 回调被调用
- [x] `markSessionLost` — emits `session.error` event，code=session_lost
- [x] `get` — chat registry 优先于同 id 的 pty session → `session-catalog.test.ts`

#### P0 — relay/subscription-manager.test.ts（新建）

`src/relay/subscription-manager.ts` — control/observe 权限是安全边界。

- [x] `SubscriptionManager.requireControlSession` — session 不存在 → `session_not_found`
- [x] `SubscriptionManager.requireControlSession` — client 未订阅 → `not_subscribed`
- [x] `SubscriptionManager.requireControlSession` — mode=observe → `observe_only`
- [x] `SubscriptionManager.requireControlSession` — mode=control → `{ ok: true, session }`
- [x] `SubscriptionManager.remove` — 调用 unsubscribe 回调后删除记录
- [x] `SubscriptionManager.clear` — 所有 unsubscribe 都被调用（Promise.allSettled，不抛）
- [x] `subscriptionKey` — 唯一性：相同参数相同 key，不同参数不同 key
- [x] `SubscriptionHandler.subscribeClient` — session 不存在 → `sendError(session_not_found)`
- [x] `SubscriptionHandler.subscribeClient` — pty session status!=running → `deferLostError`
- [x] `SubscriptionHandler.subscribeClient` — chat session → 发送 catchup（有 catchup 文本时）
- [x] `SubscriptionHandler.subscribeClient` — chat session 无 catchup → 不发 catchup，但注册订阅
- [x] `SubscriptionHandler.subscribeClient` — 重复 subscribe 同一 session → 先调旧的 unsubscribe
- [x] `SubscriptionHandler.subscribeClient` — control 模式 + 有效尺寸 → 调用 resize
- [x] `SubscriptionHandler.subscribeClient` — resize 失败 → markSessionLost + deferLostError，订阅被删除
- [x] `SubscriptionHandler.subscribeClient` — runnerClient.subscribeEvents 抛错 → markSessionLost + deferLostError → `subscription-manager.test.ts`

#### P0 — relay/pty-handler.test.ts（新建）

`src/relay/pty-handler.ts` — PTY 控制面，所有操作先过 control-mode 检查。

- [x] `writeInput` — 未订阅 → `sendError(not_subscribed)`，不写 PTY
- [x] `writeInput` — observe 模式 → `sendError(observe_only)`，不写 PTY
- [x] `writeInput` — runnerClient 存在 → 调 `runnerClient.write`
- [x] `writeInput` — `runnerClient.write` 失败 → `markSessionLost` + `sendError(session_lost)`
- [x] `writeInput` — 无 runnerClient，`ptySessions.write` 返回 false → `markSessionLost`
- [x] `resizePty` — cols/rows <= 0 → `sendError(bad_resize)`，不调 resize
- [x] `resizePty` — control + runnerClient → 调 `runnerClient.resize`
- [x] `resizePty` — resize 失败 → `markSessionLost`
- [x] `stopPty` — observe 模式 → `sendError(observe_only)`
- [x] `stopPty` — runnerClient 存在 → 调 `runnerClient.stop('relay-stop')`
- [x] `stopPty` — 无 runnerClient，`ptySessions.stop` false → `markSessionLost`
- [x] `handleNewSession` — 无 `onNewPtySession` → `error(session_create_not_supported)`
- [x] `handleNewSession` — launchMode=background → `sessionCreated` + `sendSessions`
- [x] `handleNewSession` — launchMode=local-terminal → `localTerminalOpened`
- [x] `handleNewSession` — `onNewPtySession` 抛错 → `error(session_create_failed)`，不抛出到调用方 → `pty-handler.test.ts`

#### P1 — relay/chat-handler.test.ts（新建）

- [x] `handleChat` — sessionId=null + provider 不支持 → `error(provider_not_supported)`
- [x] `handleChat` — sessionId=null + provider 支持 → `runner.run` 被调用（新建 session）
- [x] `handleChat` — sessionId 有值且 in-flight → `sendError(chat_in_progress)`
- [x] `handleChat` — sessionId 有值，无 session metadata → `error(missing_session_metadata)`
- [x] `handleChat` — 续聊，provider 不支持 → `error(provider_not_supported)`
- [x] `handleChat` — 续聊正常 → `upsertFromMetadata` + `markInFlight` + `runner.run`
- [x] `handleChat` — `runner.run` 抛错 → `releaseInFlight` + `sendError(chat_runner_failed)`
- [x] `handlePermissionResponse` — 未订阅 → `sendError(not_subscribed)`，不调 runner
- [x] `handlePermissionResponse` — session 不存在 → `sendError(session_not_found)`
- [x] `handlePermissionResponse` — 正常 → `runner.respondToPermission(sessionId, requestId, decision)`
- [x] `sendProviders` → 通过 `relaySender.event` 发出 `gateway.providers` 事件
- [x] `sendCwdSuggestions` → 通过 `relaySender.event` 发出 `gateway.cwd-suggestions` 事件 → `chat-handler.test.ts`

#### P1 — relay/frame-router.test.ts（新建）

`src/relay/frame-router.ts` — frame type 分发的完整性是整个链路的入口。

- [x] 全部 frame type 各路由到正确的 handler：
  `gateway.auth.ok`, `gateway.sessions-restore`, `gateway.auth.failed`,
  `client.list`, `client.subscribe`, `client.input`, `client.resize`,
  `client.stop`, `client.unsubscribe`, `client.detach`, `client.chat`,
  `client.list-providers`, `client.cwd-suggest`, `client.switch-model`,
  `client.permission_response`, `client.new-pty-session`
- [x] 每种 frame 路由到**且仅到**正确的 handler，不触发其他 handler → `frame-router.test.ts`

#### P1 — relay/relay-sender.test.ts（新建）

- [x] `sessions` — 发出 `gateway.sessions`，包含 `gatewayId`
- [x] `event` — 发出 `gateway.event`，包含 `gatewayId` 和 event
- [x] `error` — 发出 `gateway.error`，`clientRequestId` 有值时附带，无值时不附带该字段
- [x] `sessionCreated` — 发出 `gateway.session-created`，`clientRequestId` 可选
- [x] `chatCatchup` — 发出 `gateway.chat-catchup`
- [x] `replay` — 发出 `gateway.replay`，`done` 默认 true
- [x] `localTerminalOpened` — 发出 `gateway.local-terminal-opened`
- [x] gatewayId 来自构造时传入的 getter，每次 send 时调用，支持运行时更新 → `relay-sender.test.ts`

#### P1 — chat/chat-session-registry.test.ts（新建）

- [x] `upsertFromMetadata` — 新 session → status=running，transport=chat
- [x] `upsertFromMetadata` — 已存在 → 更新字段，保留 `createdAt`，更新 `updatedAt`
- [x] `markInFlight` / `releaseInFlight` / `isInFlight` — 状态流转正确
- [x] `list` — 返回所有已注册的 session
- [x] `has` — 存在/不存在返回正确 boolean
- [x] `updateAgentSessionId` — 更新 `agentSessionId` 和 `updatedAt`；session 不存在时静默返回 → `chat-session-registry.test.ts`

#### P1 — relay-client.test.ts 补充（扩展现有）

当前测试覆盖了基础连接和帧路由，以下场景未覆盖：

- [x] `relayGatewayUrl` — `http://` → `ws://`，`https://` → `wss://`
- [x] `relayGatewayUrl` — 末尾无 `/ws/gateway` → 自动补充
- [x] `relayGatewayUrl` — 已有 `/ws/gateway` → 不重复添加
- [x] `relayGatewayUrl` — 有 query string 和 hash → 清除（已有测试）
- [ ] `relayGatewayUrl` — 非 http/https/ws/wss 协议 → 抛 Error
- [ ] 重连退避：首次断开 1s，第二次 2s，第三次 4s，之后不超过 5s
- [ ] `auth_failed` permanent → 不重连
- [x] WS 断开 → `subscriptions.clear()` 被调用，旧订阅不复用 → L2

#### P1 — registry.test.ts（新建）

`src/registry.ts` 管理本机 Gateway 注册表（gateways.json），probe.ts 依赖它查找候选 URL。
（添加 `TETHER_REGISTRY_PATH` env var 支持以实现测试隔离，同 gateway-auth 的 `TETHER_AUTH_PATH` 模式）

- [x] `registerGateway` — 写入记录，同 id 的旧记录被替换
- [x] `registerGateway` — 同时清理过期（> 30s）和 PID 不存活的记录
- [x] `touchGateway` — 更新 `lastSeenAt`，id 不存在时静默返回
- [x] `unregisterGateway` — 移除指定 id，同时清理过期记录
- [x] `listGateways` — 按 `lastSeenAt` 倒序返回，过期的不返回
- [x] `listGateways` — 若有过期记录，自动写回裁剪后的列表
- [x] 原子写：使用 tmp 文件 + rename，不直接覆盖（防并发写损坏） → `registry.test.ts`

#### P2 — utils/ids.test.ts（新建）

- [x] `createSessionId` — 多次调用不重复，符合格式约定 → `ids.test.ts`

#### P2 — utils/mask.test.ts（新建）

- [x] 敏感字段（token、key、password 等）被掩码处理
- [x] 非敏感字段保留原值 → `mask.test.ts`

---

### apps/cli

#### P0 — auth/gateway-auth-store.test.ts（新建）

- [x] `readGatewayAuthState` — 文件不存在 → 抛出"缺少 auth.json"
- [x] `readGatewayAuthState` — JSON 格式无效 → 抛出"格式无效"（SyntaxError，无 try/catch）
- [x] `readGatewayAuthState` — 字段类型错误（expiresAt=string）→ 抛出"格式无效"
- [x] `readGatewayAuthState` — 正常文件 → 返回 GatewayAuthState
- [x] `readFreshGatewayAuthState` — token 已过期 → 抛出"已过期"
- [x] `readFreshGatewayAuthState` — token 未过期 → 正常返回
- [x] `writeGatewayAuthState` — 文件权限为 0o600，目录自动创建（mkdir recursive）
- [x] `gatewayAuthSummary` — 文件不存在 → `{ state: '未登录' }`
- [x] `gatewayAuthSummary` — JSON 解析失败 → `{ state: 'auth.json 无效' }`
- [x] `gatewayAuthSummary` — 已过期 → `{ state: '已过期', gatewayId, accountId }`
- [x] `gatewayAuthSummary` — 正常 → `{ state: '已登录', gatewayId, accountId, expiresAt }`
- [x] `gatewayAuthPath` — 尊重 `TETHER_AUTH_PATH` 环境变量 → `gateway-auth-store.test.ts`

#### P0 — auth/token.test.ts（新建）

- [x] `decodeTokenPayload` — 合法 3 段 JWT → 返回 payload 对象
- [x] `decodeTokenPayload` — 段数不为 3 → undefined
- [x] `decodeTokenPayload` — payload 非 base64url → undefined
- [x] `decodeTokenPayload` — payload 非 JSON → undefined → `token.test.ts`

#### P1 — attach/pty-attach.test.ts（新建）

使用本地 ws 服务器测试状态机逻辑。导出了 `closeReasonMessage`/`isAttachAuthError` 以支持直接单测。

- [x] `attachPtySession` — auth 失败（relay auth failed）→ 不重连，直接抛错
- [ ] `attachPtySession` — reconnect=false，连接失败 → 直接抛错
- [ ] `attachPtySession` — 连接断开，reconnect=true → 指数退避重连（500ms, 1000ms, ..., 5000ms 上限）
- [x] `attachPtySession` — 收到 `session.exited` → 返回 `'exited'`
- [x] `attachPtySession` — 收到 `error/session_lost` → 状态变 lost，不重连，抛 Error
- [ ] `attachPtySession` — 本地 Ctrl-C（0x03）→ 发 `client.stop`，返回 `'stopped'`（需 stdin 模拟）
- [ ] `attachPtySession` — 本地 Ctrl-A → 发 `client.detach`，返回 `'detached'`（需 stdin 模拟）
- [ ] `attachPtySession` — observe 模式，收到输入 → 不发 `client.input`（需 stdin 模拟）
- [x] auth 握手：`client.auth.ok` → 立即发 `client.subscribe`，包含 `after > 0` 时的字段
- [x] auth 握手：`client.auth.failed` → reject 并关闭 WS，不进入消息监听阶段
- [x] `closeReasonMessage` — reason 非空 → `WebSocket {code} {reason}`；为空 → `WebSocket {code}`
- [x] `isAttachAuthError` — message 含 "relay auth failed" → true；其他 Error → false → `pty-attach.test.ts`

#### P1 — gateway/probe.test.ts（新建）

使用真实 `node:http` 服务器测试。

- [x] `fetchGatewayStatusBody` — 网络错误（连接被拒）→ undefined
- [x] `fetchGatewayStatusBody` — HTTP 非 2xx → undefined
- [x] `fetchGatewayStatusBody` — 响应 ok=false → undefined
- [x] `fetchGatewayStatusBody` — ok=true → 返回 GatewayStatus 对象
- [x] `fetchFirstGatewayStatus` — 第一个 URL 成功 → 返回其 status，不检查后续 URL
- [x] `fetchFirstGatewayStatus` — 重复 URL 去重，不重复请求
- [x] `fetchFirstGatewayStatus` — 全部失败 → undefined → `probe.test.ts`
- [ ] `waitForStartedGateway` — profile=relay，`relay.state=connected` → 返回 status
- [ ] `waitForStartedGateway` — profile=relay，20 次轮询仍未 connected → 抛出包含错误原因的 Error
- [ ] `waitForStartedGateway` — profile=local（非 relay），Gateway HTTP 返回即成功，不等 relay.state
- [ ] `findPersistentGateway` — 返回 404 → 抛 `NonTetherGatewayError`

#### P1 — gateway/supervisor.test.ts（新建）

- [x] `ensureGatewayAuthForProfile` — profile=local → 不读 auth，直接 pass
- [x] `ensureGatewayAuthForProfile` — profile=relay，auth 有效 → pass
- [x] `ensureGatewayAuthForProfile` — profile=relay，auth 过期/不存在 → 抛错，提示 tether login
- [x] `gatewayProfileFromEnv` — 未设置 `TETHER_GATEWAY_PROFILE` → undefined
- [x] `gatewayProfileFromEnv` — 合法值（relay/direct/local）→ 返回对应值
- [x] `gatewayProfileFromEnv` — 非法值 → 抛 Error → `supervisor.test.ts`

#### P1 — gateway/urls.test.ts（新建）

- [x] `gatewayApiUrl` — host=`0.0.0.0` → 转为 `127.0.0.1`
- [x] `gatewayApiUrl` — host=`127.0.0.1` → 保持不变
- [x] `gatewayApiUrl` — 拼接 port，输出为 `http://host:port`（无尾斜杠）→ `urls.test.ts`

#### P2 — utils/values.test.ts（新建）

- [x] `stringValue` — string → 返回；非 string → undefined
- [x] `numberValue` — number → 返回；非 number → undefined → `values.test.ts`

#### P2 — utils/errors.test.ts（新建）

- [x] `isNodeError` — 带 `code` 属性的 Error → true
- [x] `isNodeError` — 普通 Error（无 code）→ false
- [x] `isNodeError` — 非 Error 值 → false → `errors.test.ts`

---

## 三、执行建议

```bash
# 先跑基线，确认现有测试全绿
pnpm --filter @tether/gateway test
pnpm --filter @tether-labs/cli test
pnpm --filter @tether/relay test

# 按优先级顺序补充：
# P0:   gateway-auth, session-catalog, subscription-manager, pty-handler (gateway)
#       gateway-auth-store, token (cli)
# 链路: L1~L7 建议以 relay-client.test.ts 扩展或新建 integration/ 目录承载
# P1:   chat-handler, frame-router, relay-sender, chat-session-registry, registry (gateway)
#       pty-attach, probe, supervisor, urls (cli)
# P2:   ids, mask, values, errors
```

---

## 四、不需要补的模块

| 模块 | 原因 |
|------|------|
| `apps/relay/relay.ts` | relay.test.ts 已全面覆盖多租户隔离、认证、心跳、速率限制 |
| `apps/gateway/relay-client.ts` | relay-client.test.ts 已覆盖基础连接，本文档仅要求补充缺失场景 |
| `apps/gateway/pty/manager.ts` | pty.test.ts 已覆盖 |
| `apps/gateway/pty/session-runner.ts` | session-runner.test.ts 已覆盖 |
| `apps/gateway/pty/replay.ts` | replay.test.ts 已覆盖 |
| `apps/gateway/pty/session-status-deriver.ts` | session-status-deriver.test.ts 已覆盖 |
| `apps/gateway/pty/agent-select-detector.ts` | agent-select.test.ts 已覆盖 |
| `apps/gateway/chat/chat-session-runner.ts` | chat-session-runner.test.ts 已覆盖 |
| `apps/gateway/chat/claude-hud-metrics.ts` | claude-hud-metrics.test.ts 已覆盖 |
| `apps/gateway/utils/provider-env.ts` | provider-env.test.ts 已覆盖 |
| `apps/cli/gateway/hooks.ts` | hooks.test.ts 已覆盖 |
| `apps/cli/launchd.ts` | launchd.test.ts 已覆盖 |
| `apps/gateway/src/daemon.ts` | daemon.test.ts 已覆盖 |
| 命令层 `commands/*.ts` | 薄编排层，业务下沉到 gateway/auth/attach，无独立测试价值 |
| 日志、sleep 等纯 util | 无副作用，无测试价值 |
