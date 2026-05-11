# Phase 16: Chat Runtime Raw Events - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

为 chat 链路的所有过程事件建立完整的入库路径，支持调试、审计和断线回放。

具体交付：
1. 新建 `gateway_runtime_chats_events` MySQL 表，存储所有 chat event 的完整 raw JSON（含 agent.delta）
2. `gateway_chat_messages` 补 `raw_json` 字段，写入 user.message / agent.result 的完整事件 JSON
3. Gateway 侧 agent.delta 从 event.id=0 改为真实的 per-session 递增 id
4. Relay 侧 agent.delta 进入 runtime sync（调用 syncToServer）
5. Server 侧新增独立写入路径，chat events 只写新表，不再写旧的 `gateway_runtime_events`
6. **断线 catch-up**：客户端重连时携带 `lastDeltaEventId`，Relay 从 Server 拉取缺口 delta 补给客户端

**明确不在本阶段内：**
- PTY terminal events 写入路径不变（仍走 `gateway_runtime_events`）
- 历史存量数据不做迁移（旧行留在 gateway_runtime_events）
- delta buffer / batch insert（直写 MySQL，后续如有压力再加）
- 聊天历史展示逻辑不变（仍读 gateway_chat_messages，但 messages API 响应新增 `lastEventId` 元数据字段供 catch-up 使用）
- gateway_runtime_events 表不删除

</domain>

<decisions>
## Implementation Decisions

### 旧表 gateway_runtime_events 的定位

- **D-01:** Phase 16 完成后，chat events（user.message / agent.result / agent.tool / session.error）**只写**新表 `gateway_runtime_chats_events`，不再写 `gateway_runtime_events`。
- **D-02:** 切换在 Phase 16 同一次 PR 完成，不分两阶段。
- **D-03:** `gateway_runtime_events` 中已有的 chat event 历史行保留不动，不做迁移脚本。

### agent.delta event id 生成策略

- **D-04:** Gateway 侧 delta 使用 **per-session 递增计数器**，从 1 开始，**与 PTY event id 序列完全独立**。
- **D-05:** 计数器维护在 `ChatSessionRunner` 的内部属性（如 `private nextDeltaId = 1`），生命周期随 ChatSessionRunner 实例。

### Relay 同步 delta 的代码路径

- **D-06:** 在 relay.ts 现有 `agent.delta` handler（L375）中，**break 之前**插入 `syncToServer` 调用，走现有 `/api/relay/runtime-sync/gateway/event` 端点。不需要新端点，不需要把 delta 加入 RUNTIME_EVENT_WHITELIST。
- **D-07:** Relay 向 Server 传的 `body.event` 是**完整原始 event object**（frame.event，含 id/type/sessionId/ts/payload），Server 用它构建 raw_json，不能只传 payload.text。
- **D-08:** Relay 的 `body.scope` 中**补充 `transport: 'chat'` 字段**，Server 用这个字段判断写新表还是旧表，不需要 Server 再去查 gateway_sessions.transport。

### Server 写路径

- **D-09:** 在 `runtimeSyncRepository` 中**新建独立方法 `upsertChatRuntimeEvent`**，完全不修改现有 `upsertRuntimeEvent`（两路径解耦）。
- **D-10:** `upsertChatRuntimeEvent` 在**同一个 MySQL transaction** 里同时写入：
  1. `gateway_runtime_chats_events`（所有 chat event，含 delta）
  2. `gateway_chat_messages` 的 `raw_json` 字段更新（仅 user.message / agent.result）
- **D-11:** `upsertRuntimeEvent` 的 transport 判断：runtime-sync controller 在 `body.scope.transport === 'chat'` 时调用 `upsertChatRuntimeEvent`，否则调用原有 `upsertRuntimeEvent`。

### 断线 catch-up

- **D-12:** Server 新增读接口 `GET /api/relay/chat-events/:sessionId?after=N`，从 `gateway_runtime_chats_events` 读 `event_type = 'agent.delta' AND event_id > N` 的行，按 `event_id` 升序返回。该接口加入 Relay 的 `serverSyncUrl` 白名单（与现有 runtime-sync 接口同源）。
- **D-13:** Relay 在处理 `client.subscribe` for chat session 时，若 session 状态为 `running`，调用上述接口拉取 `after = frame.after`（可为 0）的缺口 delta，逐条以 `agent.delta` 帧格式推给客户端，之后恢复正常实时流。session 为非 running 状态时跳过 catch-up。
- **D-14:** Client（chat-panel.tsx）维护 `lastDeltaEventIdRef`，有两个写入点：
  1. 每次收到 `agent.delta` 帧时，若帧携带 `eventId` 且大于当前值则更新（实时跟踪；帧需携带 `eventId`，见 D-17）
  2. 加载聊天历史时（`fetchChatMessages` 返回后），用最后一条 assistant 消息的 `lastEventId` 初始化（页面刷新后仍有正确起点）
  发 `client.subscribe` 时将 `lastDeltaEventIdRef.current` 作为 `after` 字段传出（无历史时传 0）。
- **D-15:** catch-up 只补 delta 事件。`agent.result` 由正常的聊天历史 REST 接口加载，不走此路径。
- **D-16:** `GET /api/server/sessions/:id/messages` 响应在顶层补 `lastEventId` 字段（取最后一条 assistant 消息 `gateway_chat_messages.raw_json` 里的 `id`），供 Client 初始化 `lastDeltaEventIdRef`。若 `raw_json` 为空或无 assistant 消息则返回 0。
- **D-17:** Relay 发给 Client 的 `agent.delta` 帧新增 `eventId` 字段（来自 `frame.event.id`）。Client 用此字段去重：收到 `eventId <= lastDeltaEventIdRef.current` 的帧时丢弃，防止 catch-up 补发和实时流重叠产生重复。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 设计文档（主要参考）
- `docs/working/2026-05-11-chat-runtime-raw-events.md` — 完整设计：表职责、写入规则、SQL schema 草案、TODO、验收项、风险分析。**MUST read first.**

### 现有 Server 代码（改动目标）
- `apps/server/app/service/runtimeSyncRepository.ts` — 现有 `upsertRuntimeEvent`、`insertDerivedChatMessage`、mask/truncate 逻辑，新方法 `upsertChatRuntimeEvent` 在此添加
- `apps/server/app/controller/runtime-sync.ts` — `event()` 方法，新增 transport 分支在此
- `apps/server/app/service/chatRepository.ts` — `gateway_chat_messages` 读取路径，确认 Phase 16 不影响它

### 现有 Relay 代码（改动目标）
- `apps/relay/src/relay.ts` — agent.delta 特殊处理块（syncToServer 插入点）；catch-up 逻辑（chat subscribe with after>0 时查 Server）

### 现有 Gateway 代码（改动目标）
- `apps/gateway/src/chat-session-runner.ts` — ChatSessionRunner，delta id 计数器在此添加

### catch-up 新增代码
- `apps/server/app/controller/chat-events.ts`（新建）— `GET /api/relay/chat-events/:sessionId` 控制器，鉴权用 relay runtime-sync secret
- `apps/server/app/service/chatEventsRepository.ts`（新建）— 从 `gateway_runtime_chats_events` 按 session_id + event_type = 'agent.delta' + event_id > after 读取
- `apps/web/src/components/chats/chat-panel.tsx` — 新增 `lastDeltaEventIdRef`，subscribe 时带 `after`，收 delta 时去重
- `packages/protocol/src/` — `RelayServerToClientFrame` 的 `agent.delta` 帧新增 `eventId?: number` 字段（D-17）

### 测试参考
- `apps/server/test/runtime-sync.test.ts` — 现有 runtime sync 测试，Phase 16 测试在此扩展

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `maskPayload` + `truncatePayload`（runtimeSyncRepository.ts）— 现有敏感信息掩码和长度截断函数，Phase 16 的 raw_json 必须复用，不要自己再写一套
- `MASK_PATTERNS`（runtimeSyncRepository.ts）— sk-xxx / github_pat_ 等模式已覆盖，Phase 16 直接复用
- `db.transaction()`（runtimeSyncRepository.ts）— MySQL 事务封装，D-10 的同一事务写入用这个

### Established Patterns
- runtime-sync controller 收 `body.scope`（含 accountId/gatewayId）+ `body.event` 传给 repository；Phase 16 在 scope 里补 transport 字段，controller 根据它分发到新旧方法
- `ON DUPLICATE KEY UPDATE`（runtime-sync）— 所有 upsert 走这个模式，`gateway_runtime_chats_events` 的唯一键 `(session_id, event_id)` 同样用这个实现幂等
- `insertDerivedChatMessage` 里有 `if (sourceEventId <= 0) return` guard；Phase 16 后 delta 有真实 id，但 delta 不写 gateway_chat_messages，这个 guard 对 delta 不适用（delta 直接进 gateway_runtime_chats_events）

### Integration Points
- Relay RUNTIME_EVENT_WHITELIST（relay.ts L67）— Phase 16 **不修改**这个白名单，delta 通过 delta handler 内部直接调用 syncToServer
- `gateway_chat_messages` 的读取 API（`/api/server/sessions/:id/messages`）— Phase 16 不改读取路径，只加 `raw_json` 列，读取时不暴露它
- `apps/server/sql/` — Phase 16 需要在这里加 migration SQL（新表 + ALTER TABLE raw_json）和更新空库建表 SQL
- **catch-up API 白名单**：`/api/relay/chat-events/:sessionId` 需加入 Server 路由（按 `/api/relay/` 前缀规范），Relay 用 `runtimeSyncSecret` 调用，与现有 `/api/relay/runtime-sync/` 接口同源同鉴权方式

</code_context>

<specifics>
## Specific Ideas

- `gateway_runtime_chats_events.raw_json` 存的是完整 event JSON（id/type/sessionId/ts/payload），不只是 payload。敏感信息脱敏用现有 maskPayload 函数。
- Relay 在调用 syncToServer 传 delta 时，`body.scope` 里带 `transport: 'chat'`；这个字段是 Phase 16 新增的，Server 用它区分写路径。
- delta 的 per-session 计数器从 1 开始，与 PTY event id 独立；`(session_id, delta_event_id)` 唯一，gateway_runtime_chats_events 的唯一键约束能保证幂等重试。
- `agent.delta` 帧的协议变更（D-17）需同步更新 `@tether/protocol` 里的 `RelayServerToClientFrame` 类型定义，新增可选字段 `eventId?: number`。

</specifics>

<deferred>
## Deferred Ideas

- delta buffer / 100-200ms batch insert：设计文档已明确首版直写 MySQL，有写入压力再加
- 历史数据迁移（从 gateway_runtime_events 迁到 gateway_runtime_chats_events）：保留旧行，按需单独决策
- PTY terminal events 的 raw_json 入库：独立需求，不在本阶段

</deferred>

---

*Phase: 16-Chat Runtime Raw Events*
*Context gathered: 2026-05-11*
