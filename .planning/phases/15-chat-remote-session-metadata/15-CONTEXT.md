# Phase 15: Chat Remote Session Metadata - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning
**Source:** PRD Express Path (docs/working/2026-05-11-chat-remote-session-metadata.md)

<domain>
## Phase Boundary

Chat 链路不再依赖 Gateway 本地 SQLite。

Relay 收到已有 session 的 `client.chat` 后，从 Server DB 补齐可信 metadata（provider / projectPath / agentSessionId / gatewayId），通过 `RelayToGatewayChatFrame.session` 转发给 Gateway。Gateway 续聊直接用 `frame.session` 执行 provider resume，不查本地 `store.getSession()`。新建 chat 时 Gateway 显式上报完整 metadata，不依赖 `sendSessions()` 间接同步。

**明确不在本阶段内：**
- PTY 去本地 DB（独立阶段）
- Direct 模式的 metadata 处理（另行设计）
- Chat session 标题和所有权（另行设计）
- Chat 内容事件（已完成，不再写本地 DB）

</domain>

<decisions>
## Implementation Decisions

### D-01: Protocol 扩展 — Relay → Gateway Chat 帧带可信 metadata

已有 chat 续聊时，Relay 向 Gateway 转发的帧格式必须包含 `session` 字段：

```typescript
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

Web → Relay 帧保持不变，已有 session 续聊只传 `sessionId / message / model?`，不携带 metadata。

### D-02: Web → Relay 帧类型约束

```typescript
type ClientChatFrame =
  | {
      type: 'client.chat';
      sessionId: string;    // 已有 session 续聊
      message: string;
      model?: string;
    }
  | {
      type: 'client.chat';
      sessionId: null;      // 新建 chat
      provider: string;
      model: string;
      cwd: string;
      message: string;
    };
```

Web **不允许**携带 `provider / projectPath / agentSessionId / accountId / userId / gatewayId`。

### D-03: Relay Metadata 来源 — Server 内部只读接口

Relay 用 `runtime sync secret` 调用新增 Server 内部接口：

```
GET /api/relay/gateway-sessions/:sessionId/metadata
Authorization: Bearer {relay-sync-secret}
```

Server 按 `accountId / userId / gatewayId` 校验后返回：
- provider
- projectPath
- agentSessionId
- gatewayId
- transport

不能只靠 `latestSessions` 内存缓存（Gateway 断开会丢失）。

### D-04: 新建 Chat 顺序 — 显式上报 session metadata

新建 chat 不依赖 `sendSessions()` 间接同步。目标顺序：

```
Web 发 sessionId=null
  ↓
Gateway 创建 provider 会话前生成 sessionId
  ↓
Gateway 立即发 gateway.chat-session-created 帧（带完整 metadata）
  ↓
Relay 先同步 Server gateway_sessions（upsert）
  ↓
Server ack 成功后 Relay 再通知 Web session-created
  ↓
首条 user.message / agent.result 再入 gateway_chat_messages
```

### D-05: Gateway 续聊不查本地 sessions

Gateway 处理已有 chat 时：
- 不调用 `store.getSession(sessionId)`
- 直接用 `frame.session` 中的 metadata 执行 provider resume
- 即使本地 SQLite 没有该 session 行也能续聊

### D-06: Gateway 新建 chat 不写本地 sessions

- `createChatSession()` 不调用 `store.insertSession()`
- 不调用 `store.touchSession()` / `store.updateAgentSessionId()`
- `last_active_at` 和 `agent_session_id` 只通过 Server DB 更新

### D-07: agent_session_id 更新带 scope 校验

`session.agent-id-updated` 的 PATCH 必须带 accountId / gatewayId / userId scope：

```sql
UPDATE gateway_sessions
SET agent_session_id = ?
WHERE id = ?
  AND account_id = ?
  AND gateway_id = ?
  AND user_id = ?
```

### D-08: Transport 校验 — client.chat 只服务 chat session

Relay 收到 `client.chat` 时，已有 session 必须 `transport = 'chat'`。PTY session 误发 `client.chat` 时返回明确错误，不走 chat runner。

### D-09: 新建 chat 的 provider/cwd 约束

- `provider` 仍受 Gateway provider 白名单限制
- `cwd` 必须经过 Gateway 侧路径校验
- Relay 只负责路由，不直接信任 cwd 可执行性

### D-10: Relay 断线/Server sync 失败策略

第一版明确失败并提示，不做静默 best-effort。不引入 outbox 机制（后续阶段再做）。

### D-11: last_active_at 更新

`user.message / agent.result` 入库时，同步更新 `gateway_sessions.last_active_at`。

### D-12: workspace_id schema 修复

验证 migration 002 + 007 在空库和旧库都能执行，确保 `upsertGatewaySession` 不因 `workspace_id NOT NULL` 约束失败。

### D-13: 权限校验

Relay 在转发 `client.chat` 前必须校验：
- session 归属当前 accountId / userId
- gatewayId 对应 Gateway 在线
- transport = 'chat'
- 非当前 account/user 的 session 返回 403
- gatewayId 不在线时返回 gateway_unavailable

### Claude's Discretion

- ULID vs UUID 作为 chat event 稳定幂等 id（选 ULID 优先，但具体实现交给执行者）
- `gateway.chat-session-created` 帧的具体字段结构（在 protocol 包中定义）
- Relay 可信缓存策略（第一版直接查 Server DB，不做额外缓存层）
- Server metadata 接口的 HTTP 状态码和错误结构

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 主设计文档
- `docs/working/2026-05-11-chat-remote-session-metadata.md` — 完整设计文档（目标协议、TODO 清单 17 项、风险分析 R1-R12、代码级验收 A1-A8、单测 T1-T14、人工 UAT）

### 关联工作文档（背景参考）
- `docs/working/2026-05-11-chat-session-title-ownership.md` — Chat 标题和所有权设计（本阶段不实现，但需要了解边界）
- `docs/working/2026-05-11-pty-remote-event-store.md` — PTY 去本地 DB 设计（独立阶段，避免混入）

### 项目规范
- `CLAUDE.md` — 编码原则、API 路由命名规范、Relay 多租户隔离规范（R1-R4 强制规则）

</canonical_refs>

<specifics>
## Specific Ideas

### 验收命令（来自 PRD）

```bash
# 代码级验收
rg -n "appendChatEvent|listChatEvents|session_chats_events" apps/gateway/src
rg -n "store\.getSession\(|insertSession\(|touchSession\(|updateAgentSessionId\(" apps/gateway/src/chat-session-runner.ts apps/gateway/src/relay-client.ts
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/server run typecheck
```

### 关键风险（来自 PRD R1-R12）

- R2: `latestSessions` 是内存缓存，Gateway 断开会丢失 → 必须从 Server DB 兜底
- R4: `session.agent-id-updated` PATCH 缺 scope → 需加 account/gateway/user 限定
- R8: `002` schema 仍声明 `workspace_id NOT NULL` → 需先修 migration 007 确保所有环境可跑
- R12: 新建 session 和首条 message 有顺序竞争 → 必须保证 `gateway_sessions` 先可见

### 本地测试拓扑

```bash
pnpm --filter @tether/server dev
pnpm --filter @tether/relay dev
pnpm tether gateway login --env local
pnpm tether gateway start
pnpm --filter @tether/web dev
```

</specifics>

<deferred>
## Deferred Ideas

- **PTY 去本地 DB** — 独立后续阶段，不能混入本阶段（PRD 明确边界）
- **Direct 模式 metadata 处理** — 另行设计（R7 标注为后续）
- **Chat event outbox / 重试机制** — 第一版只明确失败，outbox 是后续阶段
- **稳定 chat event id 的重试语义** — event id 幂等先做（D-13），重试流程后续
- **Chat session 标题和所有权** — 另一份设计文档，独立阶段

</deferred>

---

*Phase: 15-chat-remote-session-metadata*
*Context gathered: 2026-05-11 via PRD Express Path*
