# Chat 远程 Session Metadata 方案

本文记录 `chats` 链路从“Gateway 本地 `sessions` 表保存 chat 元数据”改成“Relay 从远程事实源补齐 metadata 后转发给 Gateway”的目标方案、TODO 和验收方式。

## 结论

Chat 链路最终不应该依赖 Gateway 本地 SQLite。

```text
Web
  只发 sessionId + message + model?
  ↓
Relay
  用 sessionId 查 Server DB / 可信缓存
  校验账号、用户、Gateway 归属
  补齐 provider / projectPath / agentSessionId / owner metadata
  ↓
Gateway
  不查本地 store.getSession(sessionId)
  不写本地 sessions
  直接用 Relay 给的可信 metadata 执行 provider resume
  ↓
Relay / Server
  保存 chat 历史、session 元数据、agent_session_id、last_active_at
```

边界：

- Web 不允许携带可执行 metadata，例如 `provider`、`projectPath`、`agentSessionId`。
- Relay 是信任边界，负责从 Server DB 或可信缓存补 metadata。
- Gateway 只执行 Relay 给的可信 metadata。
- Gateway 本地 DB 仍保留给 PTY / Terminal sessions、terminal replay、runner metadata 和本机控制面。
- 本方案只处理 chat 去本地 DB。
- PTY 去本地 DB 是后续独立阶段，不能混在本阶段。

## 当前状态

```text
┌──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ 项目                         │ 当前状态                     │ 说明                         │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Chat 内容事件                 │ 已不写本地 DB                 │ 不再创建 session_chats_events │
│ user.message / agent.result   │                              │ 只生成事件并上报 Relay/Server │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Chat session 元数据           │ 仍写 Gateway 本地 sessions    │ 续聊时 Gateway 还会查本地     │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ agent_session_id              │ 仍写 Gateway 本地 sessions    │ 下一轮 provider resume 需要   │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ updated_at / last_active_at   │ 仍写 Gateway 本地 sessions    │ Gateway 本地排序和上报使用    │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

当前本地写入残留：

- `ChatSessionRunner.createChatSession()` 调 `store.insertSession(...)`。
- 发送用户消息后调 `store.touchSession(sessionId)`。
- 解析到 provider `agentSessionId` 后调 `store.updateAgentSessionId(...)`。
- Agent 最终结果、工具事件、错误事件后调 `store.touchSession(sessionId)`。

## 为什么不能让 Web 带 Metadata

Web 只能发请求意图：

```json
{
  "type": "client.chat",
  "sessionId": "tth_xxx",
  "message": "继续",
  "model": "optional"
}
```

Web 不能发：

```json
{
  "provider": "codex",
  "projectPath": "/Users/dream/code/tether",
  "agentSessionId": "provider-session-id"
}
```

原因：

- `projectPath` 是本机执行目录，不能由客户端伪造。
- `agentSessionId` 可以关联 provider 侧上下文，不能由客户端伪造。
- `provider` 决定 Gateway 启动哪个 CLI，不能由客户端伪造。
- `accountId / userId / gatewayId` 是权限边界，必须由 Relay / Server 校验。

## 目标协议

### Web -> Relay

Web 仍然只发最小请求：

```ts
type ClientChatFrame =
  | {
      type: 'client.chat';
      sessionId: string;
      message: string;
      model?: string;
    }
  | {
      type: 'client.chat';
      sessionId: null;
      provider: string;
      model: string;
      cwd: string;
      message: string;
    };
```

新建 chat 的 `sessionId: null` 仍需要用户选择 provider / cwd。已有 chat 的续聊不允许 Web 带 metadata。

新建 chat 的 `provider / cwd` 也不能完全当成任意可信输入：

- `provider` 必须仍受 Gateway provider 白名单限制。
- `cwd` 必须来自 Gateway 返回的目录建议，或经过 Gateway 侧路径校验。
- Relay 只负责把新建请求路由到用户选定且已认证的 Gateway，不直接信任 cwd 可执行性。

### Relay -> Gateway

Relay 转发已有 chat 时补可信 metadata：

```ts
type TrustedChatSessionMetadata = {
  id: string;
  provider: string;
  projectPath: string;
  agentSessionId?: string;
  accountId: string;
  userId: string;
  gatewayId: string;
  transport: 'chat';
};

type RelayToGatewayChatFrame = {
  type: 'client.chat';
  clientId: string;
  sessionId: string;
  message: string;
  model?: string;
  session: TrustedChatSessionMetadata;
};
```

Gateway 只信 `frame.session`，不再查本地 `store.getSession(sessionId)`。

## 设计定案

以下定案是进入实现前必须先遵守的边界。后续 TODO、测试和验收都按这四组展开。

### A. Relay Metadata 来源

- Relay 不能只靠 `latestSessions`。
- 新增 Server 内部接口：

```text
GET /api/relay/gateway-sessions/:sessionId/metadata
```

- Relay 用 `runtime sync secret` 调这个接口。
- Server 按 `accountId / userId / gatewayId` 校验后返回：

```text
provider
projectPath
agentSessionId
gatewayId
transport
```

### B. 新建 Chat 顺序

新建 chat 不能依赖 Gateway 本地 `sessions` 再通过 `sendSessions()` 间接同步远程。

目标顺序：

```text
Web 发 sessionId=null
  ↓
Gateway 创建 provider 会话前生成 sessionId
  ↓
Gateway 立即发 gateway.chat-session-created，带完整 metadata
  ↓
Relay 先同步 Server gateway_sessions
  ↓
Server ack 成功后 Relay 再通知 Web session-created
  ↓
首条 user.message / agent.result 再入 gateway_chat_messages
```

### C. 安全边界

- Web 续聊只能传 `sessionId / message / model?`。
- Relay 补可信 metadata。
- 已有 session 必须 `transport = 'chat'`，PTY 不能走 `client.chat`。
- `agent_session_id` PATCH 必须带 scope，Server 更新必须限定：

```text
WHERE id = ?
  AND account_id = ?
  AND gateway_id = ?
  AND user_id = ?
```

- 新建 chat 的 `provider / cwd` 仍由 Gateway 校验白名单和路径，不信 Web。

### D. 可靠性

- Chat event 改成稳定 `eventId`，例如 ULID / UUID。
- Server 用 `(session_id, source_event_id)` 幂等。
- `last_active_at` 在 `user.message / agent.result` 入库时更新。
- Relay / Server sync 失败时，第一版先明确失败并提示，不做静默 best-effort。
- `workspace_id` schema 单独先修，确保空库和旧库都能跑。

## TODO

```text
┌──────┬────────────────────────────────────────────┬────────────────────────────────────────────┐
│ 状态 │ 任务                                       │ 验收                                       │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 已做 │ 删除 chat 内容本地表和内容事件写入          │ 本地不再创建 session_chats_events          │
│      │                                            │ appendChatEvent / listChatEvents 不存在    │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 扩展 packages/protocol 的 client.chat 类型  │ Relay -> Gateway 帧支持 session metadata   │
│      │                                            │ Web -> Relay 仍不允许带执行 metadata       │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 增加 Server 内部 metadata 查询接口          │ Relay 可按 sessionId + account/user 查到    │
│      │ 或等价可信缓存机制                         │ provider/projectPath/agentSessionId/gateway│
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ Relay 收到已有 session 的 client.chat 后    │ Relay 能从 gateway_sessions 或可信缓存     │
│      │ 查 Server DB / 缓存补齐 metadata            │ 找到 provider/projectPath/agentSessionId   │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 新建 chat 时显式上报 session metadata       │ 不依赖 Gateway 本地 listSessions           │
│      │                                            │ Server DB 能立刻 upsert gateway_sessions   │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 新建 chat 的 provider/cwd 约束              │ provider 白名单仍生效，cwd 经过 Gateway 校验│
│      │                                            │ 不能用 Web 任意路径直接执行                │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ Relay 转发前校验权限和路由                  │ 非当前 account/user 的 session 返回 403    │
│      │                                            │ gatewayId 不在线时返回 gateway_unavailable │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ Relay 转发前校验 transport                  │ 已有 session 续聊只允许 transport='chat'   │
│      │                                            │ PTY session 继续走 client.input            │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ Gateway 处理已有 chat 时不查本地 sessions   │ 续聊路径不调用 store.getSession(sessionId) │
│      │                                            │ 直接用 frame.session 执行 provider resume  │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 新建 chat session 不再写本地 sessions       │ createChatSession 不调用 store.insertSession│
│      │                                            │ 新建后只上报 Relay/Server                  │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 删除 chat 链路 touchSession 本地写入        │ user.message/result/tool/error 后          │
│      │                                            │ 不再调用 store.touchSession                │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 删除 chat 链路 updateAgentSessionId 本地写入│ agentSessionId 只通过 Relay/Server 同步    │
│      │                                            │ 本地 sessions 不再保存 chat agent id       │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ Server 更新 chat session 活跃时间           │ user.message / agent.result 入库后         │
│      │                                            │ gateway_sessions.last_active_at 更新       │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ agent_session_id 更新带 scope 校验           │ Relay PATCH 带 accountId/gatewayId         │
│      │                                            │ Server WHERE 限定 session 归属             │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 明确 Relay 断线时的 chat 事件处理策略       │ 断线期间不会静默丢 user/result 或明确失败  │
│      │                                            │                                            │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 定义可重试的 chat event id                  │ user/result/tool/error 使用稳定幂等 id     │
│      │                                            │ 不能只依赖进程内自增或时间戳碰运气        │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 定义新建 session 的 ack 顺序                │ Server upsert session 成功后再让 Web 进入  │
│      │                                            │ 或前端能处理短暂 metadata 未就绪状态       │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ 待做 │ 补测试                                     │ Relay metadata 补齐、权限校验、Gateway     │
│      │                                            │ 无本地 DB 续聊都要有覆盖                   │
└──────┴────────────────────────────────────────────┴────────────────────────────────────────────┘
```

## 额外隐患检查

这部分是按当前代码核对后的硬风险，不能在实现时跳过。

```text
┌──────┬────────────────────────────────────────────┬────────────────────────────────────────────┐
│ 编号 │ 隐患                                       │ 必须补的设计                               │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R1   │ Relay 目前只有 syncToServer 写接口          │ 增加 Server 内部只读 metadata 接口，或     │
│      │ 没有按 sessionId 读取 gateway_sessions 能力 │ Relay 维护可恢复的可信缓存                 │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R2   │ latestSessions 是内存缓存，Gateway 断开会丢 │ 不能只靠 Relay 内存缓存做事实源            │
│      │                                            │ Gateway 重启后仍要能从 Server DB 续聊      │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R3   │ 新建 chat 如果不写本地 sessions             │ 不能再依赖 sendSessions()/listSessions     │
│      │ Server 可能拿不到 gateway_sessions 首条记录 │ 需要新建时显式上报完整 session metadata    │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R4   │ session.agent-id-updated 当前 PATCH 只带 id  │ PATCH 必须带 Relay auth scope，并在 Server │
│      │ Server 只按 sessionId 更新                  │ 按 accountId/gatewayId/userId 限定 UPDATE  │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R5   │ user.message / agent.result 入库时          │ 派生 chat message 同时更新                 │
│      │ 当前不会自动推进 last_active_at             │ gateway_sessions.last_active_at            │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R6   │ chat 内容不落本地后没有 outbox              │ Relay 断线/Server sync 失败时，必须明确    │
│      │                                            │ 是失败重试、阻止发送，还是接受丢失风险      │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R7   │ Direct 模式没有 Relay 补 metadata           │ 要么 chats 明确只走 Relay，要么 Direct     │
│      │                                            │ 也必须通过 Server 查询可信 metadata        │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R8   │ 002 schema 仍声明 workspace_id NOT NULL     │ 007_remove_workspace 必须在所有环境可靠执行│
│      │ upsertGatewaySession 当前不写 workspace_id  │ 否则 fresh/旧库可能 upsert gateway_sessions失败│
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R9   │ 当前 relay client.chat 测试用的是 PTY session│ 未来必须拆清楚：chat 用 client.chat，PTY   │
│      │                                            │ 用 client.input，不能混用                  │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R10  │ 新建 chat 的 cwd/provider 仍来自 Web        │ provider/cwd 必须由 Gateway 白名单和路径   │
│      │                                            │ 校验兜住，不允许任意本机路径执行           │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R11  │ 当前 chat event id 是进程内生成             │ 如果要支持重试/outbox，需要 ULID/UUID      │
│      │                                            │ 或 Server 可幂等识别的稳定 source_event_id │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ R12  │ 新建 session 和首条 message 有顺序竞争      │ 必须保证 gateway_sessions 先可见，避免     │
│      │                                            │ 刷新列表/消息时远程 metadata 尚未入库      │
└──────┴────────────────────────────────────────────┴────────────────────────────────────────────┘
```

## 验收清单

### 代码级验收

```text
┌──────┬────────────────────────────────────────────┬────────────────────────────────────────────┐
│ 编号 │ 验收项                                     │ 检查方式                                   │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ A1   │ chat 内容不写本地 DB                       │ rg 不存在 appendChatEvent/listChatEvents   │
│ A2   │ Gateway 续聊不查本地 session               │ client.chat(sessionId) 分支不调用          │
│      │                                            │ store.getSession(sessionId)                │
│ A3   │ Gateway 新建 chat 不写本地 sessions         │ createChatSession 不调用 insertSession     │
│ A4   │ chat 活跃时间不写本地                       │ chat runner 不调用 touchSession            │
│ A5   │ agentSessionId 不写本地                     │ chat runner 不调用 updateAgentSessionId    │
│ A6   │ PTY 本地 DB 不受影响                        │ pty/session_events 相关测试继续通过        │
│ A7   │ client.chat 不再作用于 PTY session           │ transport!='chat' 时 Relay/Gateway 拒绝    │
│ A8   │ 新建 chat 不接受任意 provider/cwd            │ provider 白名单和 cwd 校验测试覆盖         │
└──────┴────────────────────────────────────────────┴────────────────────────────────────────────┘
```

建议命令：

```bash
rg -n "appendChatEvent|listChatEvents|session_chats_events" apps/gateway/src
rg -n "store\\.getSession\\(|insertSession\\(|touchSession\\(|updateAgentSessionId\\(" apps/gateway/src/chat-session-runner.ts apps/gateway/src/relay-client.ts
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/server run typecheck
```

### 单测验收

```text
┌──────┬────────────────────────────────────────────┬────────────────────────────────────────────┐
│ 编号 │ 测试                                       │ 应覆盖                                     │
├──────┼────────────────────────────────────────────┼────────────────────────────────────────────┤
│ T1   │ Relay client.chat metadata 补齐             │ Web 只传 sessionId，Gateway 收到完整 metadata│
│ T2   │ Relay 权限校验                              │ A 用户不能续聊 B 用户 chat session          │
│ T3   │ Relay Gateway 路由                          │ session.gatewayId 指向离线 Gateway 时失败   │
│ T4   │ Gateway 无本地 session 续聊                 │ 本地没有 sessions 行也能 provider resume   │
│ T5   │ 新建 chat session 不写本地                  │ 本地 SQLite 没有 chat session 行            │
│ T6   │ agent_session_id 远程更新                   │ session.agent-id-updated 后 Server DB 更新  │
│ T7   │ last_active_at 远程更新                     │ user.message / agent.result 后列表排序更新 │
│ T8   │ Gateway 重启后续聊                          │ Relay 从 Server DB 补 metadata，不靠缓存    │
│ T9   │ Relay 断线/Server sync 失败                 │ 不静默丢消息，错误或重试行为可观察          │
│ T10  │ 旧库和空库 schema                            │ gateway_sessions upsert 不受 workspace_id影响│
│ T11  │ PTY session 误发 client.chat                 │ 返回明确错误，不走 chat runner             │
│ T12  │ 新建 chat cwd/provider 安全                  │ 非白名单 provider / 非法 cwd 被拒绝        │
│ T13  │ chat event id 幂等                           │ 重试同一事件不会重复插入消息               │
│ T14  │ 新建 chat 首条消息刷新竞争                   │ 立即刷新也能读到 session 和第一条消息      │
└──────┴────────────────────────────────────────────┴────────────────────────────────────────────┘
```

### 人工 UAT

本地模拟生产拓扑：

```bash
pnpm --filter @tether/server dev
pnpm --filter @tether/relay dev
pnpm tether gateway login --env local
pnpm tether gateway start
pnpm --filter @tether/web dev
```

验收步骤：

1. 登录 Web，进入 `/chats`。
2. 新建一个 chat，发送第一条消息。
3. 刷新页面，确认消息历史从 Server DB 恢复。
4. 停止 Gateway，再启动 Gateway。
5. 对同一个 chat 继续发送消息，确认 Gateway 本地没有 chat session 行也能续聊。
6. 查询 Server DB，确认：
   - `gateway_sessions` 有该 chat session。
   - `gateway_sessions.agent_session_id` 已更新。
   - `gateway_sessions.last_active_at` 随新消息更新。
   - `gateway_chat_messages` 有用户消息和 Agent 回复。
7. 查询本地 SQLite，确认：
   - 没有 `session_chats_events` 表。
   - chat 链路没有新增本地 `sessions` 行。
   - PTY sessions 仍正常写 `sessions` / `session_events`。

本地 SQLite 检查示例：

```bash
sqlite3 ~/.tether/tether.db ".tables"
sqlite3 ~/.tether/tether.db "select id, transport, provider, title from sessions where transport = 'chat';"
```

预期：

- `.tables` 不包含 `session_chats_events`。
- 第二条查询返回空。
- PTY / Terminal session 仍可 attach、replay、send input。

## 风险和回滚

```text
┌──────────────────────────────┬────────────────────────────────────────────┐
│ 风险                         │ 处理                                       │
├──────────────────────────────┼────────────────────────────────────────────┤
│ Relay / Server 不可用         │ chat 续聊不可用，返回明确错误              │
│ Server DB metadata 不完整     │ Relay 不转发，提示 session metadata 缺失    │
│ Gateway 收到伪造 metadata     │ metadata 只能由 Relay 注入，Web 不可传      │
│ Direct 模式行为不一致         │ chat 续聊默认走 Relay；Direct 另行设计      │
│ Relay 内存缓存丢失             │ 必须从 Server DB 兜底读取 metadata          │
│ 新建 session 没有首条 metadata │ 新建成功时显式 upsert gateway_sessions      │
│ agent_session_id 串写          │ Server 更新必须带 scope 条件                │
│ chat 事件无 outbox             │ 明确失败/重试策略，不做静默 best-effort     │
│ workspace_id 迁移漂移          │ 验证 002 + 007 在空库和旧库都能执行          │
│ PTY / chat 协议混用             │ client.chat 只服务 transport='chat'         │
│ Web 新建请求携带 cwd/provider   │ Gateway 侧白名单和路径校验必须保留          │
│ chat event id 不稳定            │ 使用稳定幂等 id，再谈失败重试               │
│ 新建后立即刷新读不到 session    │ 明确 session upsert ack 或前端 pending 状态 │
└──────────────────────────────┴────────────────────────────────────────────┘
```

临时回滚方式：

- 保留当前轻量本地 `sessions` 缓存路径。
- Relay metadata 补齐失败时，允许 Gateway fallback 到 `store.getSession(sessionId)`。
- 回滚只作为过渡开关，最终目标仍是 chat 链路不依赖本地 DB。
