# Phase 15: Chat Remote Session Metadata - Research

**Researched:** 2026-05-11
**Domain:** Chat 链路去本地 SQLite — Relay metadata 补全 / Gateway 去本地依赖 / Server 内部只读接口
**Confidence:** HIGH（全部基于当前代码库 grep/阅读验证，无假设性猜测）

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01**: Protocol 扩展 — `RelayToGatewayChatFrame` 必须包含 `session: TrustedChatSessionMetadata` 字段（已有 chat 续聊）
- **D-02**: Web → Relay 帧不允许携带可执行 metadata（provider / projectPath / agentSessionId / accountId / userId / gatewayId）
- **D-03**: Relay 用 `runtime sync secret` 调 `GET /api/relay/gateway-sessions/:sessionId/metadata`，不能只靠 `latestSessions` 内存缓存
- **D-04**: 新建 chat 的上报顺序：Gateway 先发 `gateway.chat-session-created`（带完整 metadata）→ Relay 同步 Server → ack 后再通知 Web `session-created`
- **D-05**: Gateway 续聊不查本地 `store.getSession()`，直接用 `frame.session`
- **D-06**: `createChatSession()` 不调 `store.insertSession()`
- **D-07**: `session.agent-id-updated` PATCH 带 accountId / gatewayId / userId scope
- **D-08**: `transport = 'chat'` 是 `client.chat` 的前置校验；PTY session 误发返回明确错误
- **D-09**: 新建 chat 的 provider/cwd 由 Gateway 白名单和路径校验，不信 Web
- **D-10**: Relay/Server sync 失败明确失败，不静默 best-effort
- **D-11**: user.message / agent.result 入库时更新 `gateway_sessions.last_active_at`
- **D-12**: 验证 migration 002 + 007 在空库和旧库可执行，`upsertGatewaySession` 不因 `workspace_id NOT NULL` 失败
- **D-13**: Relay 在转发 `client.chat` 前校验 session 归属 accountId/userId、gatewayId 在线状态、transport='chat'

### Claude's Discretion

- ULID vs UUID 作为 chat event 稳定幂等 id（优先 ULID）
- `gateway.chat-session-created` 帧的具体字段结构（在 protocol 包定义）
- Relay 可信缓存策略（第一版直接查 Server DB，不做额外缓存层）
- Server metadata 接口的 HTTP 状态码和错误结构

### Deferred Ideas (OUT OF SCOPE)

- PTY 去本地 DB
- Direct 模式 metadata 处理
- Chat event outbox / 重试机制
- 稳定 chat event id 的重试语义（event id 幂等先做，重试流程后续）
- Chat session 标题和所有权
</user_constraints>

---

## Summary

本阶段的核心任务是将 chat 链路从依赖 Gateway 本地 SQLite 切换到依赖 Server DB，分三个执行方向：

**方向一：Protocol 扩展**
`RelayServerToGatewayFrame` 中的 `client.chat`（已有 session 变体）需要新增 `session: TrustedChatSessionMetadata` 字段。同时新增 `gateway.chat-session-created` 帧类型（Gateway → Relay，携带完整 metadata）和对应的 `GatewayToChatSessionCreatedFrame`。这是纯类型变更，影响 `packages/protocol/src/index.ts` 一个文件。

**方向二：Relay 的 metadata 查询 + 转发逻辑**
当前 Relay 的 `handleClientFrame → case 'client.chat'`（`relay.ts` 第 653 行）直接透传帧给 Gateway，没有做任何 metadata 补齐或 transport 校验。需要在这里拦截已有 session 的续聊请求，调 Server 内部接口查 metadata，注入可信 `session` 字段后再转发。

**方向三：Gateway 的 createChatSession + run 重写**
`chat-session-runner.ts` 的 `createChatSession()` 当前写本地 `store.insertSession()`；`run()` 的续聊分支通过 `store.getSession()` 取 metadata。两处都需要重写：续聊分支改为从 `frame.session` 读 metadata；新建分支改为不写本地，触发 `onChatSessionCreated` 回调让 relay-client 发 `gateway.chat-session-created`。另外，`touchSession()` 和 `updateAgentSessionId()` 调用（5 处）全部从 chat runner 中删除。

**Primary recommendation:** 按 Protocol → Server 新接口 → Relay 拦截逻辑 → Gateway Runner 重写 → last_active_at 更新 → agent_session_id scope 修复 → migration 校验 这个顺序规划 Plan，每步可独立测试。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Web → Relay 帧最小化（sessionId + message） | Browser/Client | — | 安全边界：客户端不携带可执行 metadata |
| metadata 补齐 + 权限校验 + transport 校验 | Relay | Server DB（查询源） | Relay 是信任边界，必须在转发前验证 |
| 已有 session metadata 只读接口 | API/Backend (Server) | — | Server DB 是唯一可信事实源 |
| Provider resume 执行 | Gateway | — | 本地进程管理，Relay 只路由 |
| chat session metadata 持久化 | API/Backend (Server) | — | gateway_sessions 表在 Server DB |
| last_active_at 更新 | API/Backend (Server) | — | 由 user.message / agent.result 入库时触发 |
| agent_session_id 更新（带 scope） | API/Backend (Server) | — | D-07 要求 WHERE 限定归属 |
| 新建 chat session 上报 | Gateway（触发）→ Relay（同步）→ Server | — | D-04 定义的顺序 |

---

## Standard Stack

### Core
| Library / Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `packages/protocol/src/index.ts` | monorepo | 所有帧类型定义 | 单一来源，所有包共用 |
| `node:crypto` / ULID | Node built-in / `ulidx`（如选 ULID）| 稳定幂等 event id | 见 D-01 注释 |
| Egg.js `ctx.service.runtimeSyncRepository` | existing | Server 侧数据访问 | 已有 `upsertGatewaySession` |
| Egg.js `ctx.service.chatRepository` | existing | agent_session_id 更新 | 已有 `updateAgentSessionId`（待加 scope） |
| Node `fetch` | Node 18+ built-in | Relay 调 Server 内部接口 | 已在 `syncToServer` 中使用 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `require-runtime-sync-secret` middleware | existing | Server 内部接口鉴权 | 新增 GET metadata 接口必须挂此中间件 |
| `node:test` + `tsx` | existing | Gateway / Relay 单元测试 | Gateway: `node --experimental-sqlite ... test/*.test.ts`；Relay: `tsx --test test/*.test.ts` |
| `egg-mock` | existing | Server 单元测试 | `apps/server/test/` 下所有 service 测试 |

**Installation:** 无需新增依赖（ULID 如选 ulidx，仅在 Gateway 包添加，但可用 `randomUUID` 替代）

---

## Architecture Patterns

### System Architecture Diagram

```text
Web (Browser)
  │
  │  client.chat { sessionId: "tth_xxx", message }
  ▼
Relay (relay.ts: handleClientFrame → case 'client.chat')
  │
  ├─── sessionId === null  ────────────────────────────────────────────────────┐
  │    直接 forwardToGateway (不变)                                            │
  │                                                                            │
  └─── sessionId !== null  (NEW)                                              │
       │                                                                       │
       ├── 1. GET /api/relay/gateway-sessions/:sessionId/metadata             │
       │       (runtime sync secret, server DB 查询)                           │
       │                                                                       │
       ├── 2. 校验 accountId / userId / transport='chat' / gatewayId 在线      │
       │                                                                       │
       └── 3. forwardToSessionGateway({                                       │
                type: 'client.chat',                                           │
                session: TrustedChatSessionMetadata  ← 注入可信 metadata       │
              })                                                               │
                                                                               │
Gateway (relay-client.ts: handleFrame → case 'client.chat')                   │
  │                                                                            │
  ├─── sessionId !== null  (NEW: D-05)                                        │
  │    直接用 frame.session，不查 store.getSession()                            │
  │    runnerForProvider(frame.session.provider).run(...)                      │
  │                                                                            │
  └─── sessionId === null  (NEW: D-06, D-04)                                  ◄─
       createChatSession() → 不写本地 → onChatSessionCreated 回调
         │
         ▼
       gateway.chat-session-created { metadata }
         │
         ▼
       Relay: 同步 Server upsertGatewaySession
         │
         ▼ (Server ack 后)
       Relay → Web: gateway.session-created { sessionId }

ChatSessionRunner (chat-session-runner.ts)
  │
  ├── agentSessionId emit → onAgentIdUpdate → relay-client → sendChatEvent
  │     'session.agent-id-updated' → Relay → PATCH /api/relay/gateway-sessions/:id/agent-session-id
  │     (WITH accountId/gatewayId/userId scope — D-07)
  │
  ├── user.message → onUserMessage → sendChatEvent (不调 touchSession)
  └── agent.result → onResult → sendChatEvent → Relay 同步 Server → 更新 last_active_at (D-11)
```

### Recommended Project Structure

无新增目录。变更集中在现有文件：

```text
packages/protocol/src/index.ts             帧类型扩展（TrustedChatSessionMetadata + RelayToGatewayChatFrame 扩展 + gateway.chat-session-created）
apps/relay/src/relay.ts                    client.chat 拦截逻辑 + fetchMetadata helper + gateway.chat-session-created 处理
apps/gateway/src/chat-session-runner.ts    createChatSession 去本地 + run 续聊不查 store + 删除 touchSession/updateAgentSessionId
apps/gateway/src/relay-client.ts           handleFrame case 'client.chat' 续聊分支 + onChatSessionCreated 新回调
apps/server/app/controller/chat.ts         updateAgentSessionId 补 scope 参数
apps/server/app/service/chatRepository.ts  updateAgentSessionId 补 WHERE scope
apps/server/app/controller/runtime-sync.ts 新增 getSessionMetadata action
apps/server/app/router.ts                  注册 GET /api/relay/gateway-sessions/:sessionId/metadata
```

### Pattern 1: Relay fetchMetadata（新增 helper）

**What:** Relay 在处理已有 session 续聊时，通过内部 HTTP GET 查 Server DB
**When to use:** `case 'client.chat': sessionId !== null`

```typescript
// relay.ts 新增
async function fetchSessionMetadata(sessionId: string): Promise<TrustedChatSessionMetadata | undefined> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) return undefined;
  try {
    const response = await fetch(
      `${options.serverSyncUrl}/api/relay/gateway-sessions/${sessionId}/metadata`,
      {
        method: 'GET',
        headers: { 'x-tether-runtime-sync-secret': options.runtimeSyncSecret },
        signal: AbortSignal.timeout(3000)
      }
    );
    if (!response.ok) return undefined;
    const json = await response.json() as { data?: unknown };
    return parseTrustedMetadata(json.data);
  } catch {
    return undefined;
  }
}
```

Pattern 已有先例：`syncToServer()` 使用相同鉴权方式（`x-tether-runtime-sync-secret` header）。[VERIFIED: apps/relay/src/relay.ts lines 78-98]

### Pattern 2: `case 'client.chat'` 续聊拦截（relay.ts）

**What:** 现有直接 `forwardToGateway` 改为先查 metadata，注入后再转发
**Where:** `handleClientFrame` switch 中 `case 'client.chat'` 分支（当前第 653 行）

```typescript
// 当前（转发不带 metadata）：
forwardToGateway(ensureClientGatewayId(clientId), {
  type: 'client.chat', clientId,
  sessionId: frame.sessionId, message: frame.message, model: frame.model
});

// 目标（D-13 校验 + D-03 补齐 + D-08 transport 校验）：
const metadata = await fetchSessionMetadata(frame.sessionId);
if (!metadata) {
  sendToClient(clientId, { type: 'error', code: 'session_not_found', ... });
  return;
}
if (metadata.accountId !== clientScope.accountId || metadata.userId !== clientScope.userId) {
  sendToClient(clientId, { type: 'error', code: 'forbidden', ... });
  return;
}
if (metadata.transport !== 'chat') {
  sendToClient(clientId, { type: 'error', code: 'wrong_transport', ... });
  return;
}
const targetGateway = gateways.get(metadata.gatewayId);
if (!targetGateway) {
  sendGatewayUnavailable(clientId);
  return;
}
sendToSocket<RelayServerToGatewayFrame>(targetGateway.socket, {
  type: 'client.chat', clientId,
  sessionId: frame.sessionId, message: frame.message, model: frame.model,
  session: metadata  // TrustedChatSessionMetadata
});
```

注意：已有 session 续聊走 `forwardToSessionGateway` 改造版本，不走 `forwardToGateway`（gatewayId 来自 metadata 而非 client scope）。[VERIFIED: apps/relay/src/relay.ts]

### Pattern 3: Gateway relay-client.ts 续聊分支（D-05）

**What:** 续聊时不查 store，直接用 `frame.session`
**Where:** `handleFrame` switch `case 'client.chat': sessionId !== null`（relay-client.ts 第 348-358 行）

```typescript
// 当前：
const session = options.store.getSession(frame.sessionId);
if (!session) { ... return; }
void runnerForProvider(session.provider).run({ ... });

// 目标（frame.session 现在是 TrustedChatSessionMetadata）：
if (!frame.session) {
  send({ type: 'gateway.error', ..., code: 'missing_session_metadata', ... });
  return;
}
void runnerForProvider(frame.session.provider).run({
  clientId: frame.clientId,
  sessionId: frame.sessionId,
  message: frame.message,
  model: frame.model,
  // 将 frame.session 传给 runner 使 agentSessionId、projectPath 可用
  session: frame.session
});
```

Runner 的 `run()` 方法接收已有 session 参数时，需要接受 `session: TrustedChatSessionMetadata` 代替 `store.getSession()`。[VERIFIED: apps/gateway/src/chat-session-runner.ts lines 242-245]

### Pattern 4: ChatSessionRunner.run() 接受 TrustedMetadata

**What:** `run()` 的已有 session 分支从 `store.getSession()` 改为直接接受 metadata 对象
**Current code (第 242-245 行):**

```typescript
const session =
  params.sessionId === null
    ? this.createChatSession(params)
    : this.options.store.getSession(params.sessionId);  // ← 删除此路径
```

**Target:**

```typescript
// run() 方法签名扩展：
| { clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }

// 续聊逻辑：
const session = params.sessionId === null
  ? this.createChatSession(params)
  : params.session;  // ← 直接使用 Relay 注入的可信 metadata
```

### Pattern 5: createChatSession 不写本地（D-06）

**What:** 新建 chat 不写 `store.insertSession()`，改由 `onChatSessionCreated` 回调通知 relay-client 发 `gateway.chat-session-created`
**Current (chat-session-runner.ts 第 428-459 行):**

```typescript
private createChatSession(params) {
  const sessionId = createSessionId();
  this.options.store.insertSession({ ... });  // ← 删除
  this.options.onSessionCreated(params.clientId, sessionId);
  return this.options.store.getSession(sessionId);  // ← 改为直接返回 metadata 对象
}
```

**Target:**

```typescript
private createChatSession(params) {
  const sessionId = createSessionId();
  const metadata: TrustedChatSessionMetadata = {
    id: sessionId,
    provider: params.provider,
    projectPath: normalizeCwd(params.cwd),
    accountId: params.accountId ?? '',
    userId: params.userId ?? '',
    gatewayId: this.options.gatewayId(),
    transport: 'chat'
  };
  // 通知 relay-client 发 gateway.chat-session-created（含 metadata）
  this.options.onChatSessionCreated(params.clientId, metadata);
  return metadata;
}
```

`onChatSessionCreated` 替换原来的 `onSessionCreated`，或新增字段传递 metadata。[VERIFIED: apps/gateway/src/chat-session-runner.ts]

### Pattern 6: gateway.chat-session-created 帧（relay-client.ts → relay.ts）

**What:** relay-client 收到新建 session 创建后，发新帧给 Relay，Relay 同步 Server 并 ack 后再通知 Web

```typescript
// relay-client.ts 中新的 onChatSessionCreated 回调
onChatSessionCreated: (clientId, metadata) => {
  chatClientBindings.set(metadata.id, clientId);
  send({
    type: 'gateway.chat-session-created',
    gatewayId: effectiveGatewayId,
    clientId,
    session: metadata  // 完整 metadata
  });
}
```

**relay.ts 中处理** `gateway.chat-session-created`：

```typescript
case 'gateway.chat-session-created': {
  // 1. 同步 Server（await，D-10 要求失败时明确失败）
  const ok = await syncToServerSession(frame.session, gatewayScope);
  if (!ok) {
    // 通知 Client 失败
    sendToClient(frame.clientId, { type: 'error', code: 'session_sync_failed', ... });
    return;
  }
  // 2. 通知 Client session-created
  sendToClient(frame.clientId, { type: 'gateway.session-created', sessionId: frame.session.id });
  // 3. 更新 latestSessions
  latestSessions.set(frame.session.id, { ...frame.session });
  broadcastSessionList();
  break;
}
```

注意：D-10 要求明确失败（不静默），这里 relay → server sync 需要 await（与现有 `void syncToServer` 不同）。[VERIFIED: CONTEXT.md D-04, D-10]

### Pattern 7: updateAgentSessionId 补 scope（D-07）

**Current `chatRepository.ts` 第 143-151 行：**

```typescript
public async updateAgentSessionId(sessionId: string, agentSessionId: string): Promise<void> {
  await this.ctx.service.db.query(
    'UPDATE gateway_sessions SET agent_session_id = ? WHERE id = ?',
    [agentSessionId, sessionId]
  );
}
```

**Target（D-07 scoped WHERE）：**

```typescript
public async updateAgentSessionId(
  sessionId: string, agentSessionId: string,
  scope: { accountId: string; gatewayId: string; userId: string }
): Promise<void> {
  await this.ctx.service.db.query(
    `UPDATE gateway_sessions SET agent_session_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND account_id = ? AND gateway_id = ? AND user_id = ?`,
    [agentSessionId, sessionId, scope.accountId, scope.gatewayId, scope.userId]
  );
}
```

Controller `chat.ts` 的 `updateAgentSessionId` 也需补 scope：从 `x-tether-runtime-sync-secret` 认证路径中获取 scope（Relay 发 PATCH 时需携带 accountId/gatewayId/userId）。[VERIFIED: apps/server/app/service/chatRepository.ts + apps/server/app/controller/chat.ts]

### Anti-Patterns to Avoid

- **在 Relay 的 `case 'client.chat'` 中 await syncToServer 但不处理失败：** D-10 要求新建 chat 的同步必须 await 且明确失败。续聊路径的 `fetchMetadata` 如果失败，应返回错误而不是降级到本地缓存（第一版不做降级）
- **直接在 relay.ts 顶层增加一个新的 HTTP server 路由：** Server 内部接口必须走 Egg router，不在 relay.ts 自建 HTTP handler
- **新建 session 后直接广播 `sendSessions()`：** D-04 明确废弃了此路径；新建后由显式 `gateway.chat-session-created` 帧上报
- **`touchSession` / `updateAgentSessionId` 保留在 chat runner 中：** 这是本阶段验收 A4/A5 的检查项，必须删净

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relay 调 Server 内部接口的 HTTP client | 新建专用 HTTP client 类 | 扩展现有 `syncToServer` 为通用 `serverRequest(method, endpoint)` helper | 已有认证逻辑和 timeout 模式 |
| Server metadata 接口鉴权 | 手写 header 校验 | `requireRuntimeSyncSecret` 中间件（已有） | 与所有 `/api/relay/*` 接口一致 |
| chat event 稳定 id | 手写时间戳碰撞 | `randomUUID`（Node 内置）或 `ulidx`（已在项目中使用过） | 时间戳 + 进程内自增有重复风险（R11） |
| 新建 session 的序列化保证 | 加分布式锁 | 协议层顺序（gateway.chat-session-created → server ack → Web session-created） | D-04 定义了协议级顺序，代码层不需要锁 |

---

## Runtime State Inventory

> 本阶段是 refactor（去本地 DB），需要检查运行时状态。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Gateway 本地 SQLite `~/.tether/tether.db` — `sessions` 表中现存的 chat transport 行（历史数据） | 代码修改后不再写入；历史行保留，不影响新链路；PTY 继续写 |
| Stored data | Server DB `gateway_sessions` 表 — 现有 chat session 行的 `workspace_id NOT NULL` 约束（002 迁移遗留）| D-12：验证 007 migration 已在所有环境执行（删除 workspace_id 列）；`upsertGatewaySession` SQL 已不写 workspace_id（verified） |
| Live service config | `upsertGatewaySession` SQL（第 115-131 行）不含 workspace_id 列 — 已符合 007 后结构 | 验证 007 在生产和本地库均已执行，确保新建 session upsert 不报 NOT NULL 错误 |
| OS-registered state | None — verified by grep，无 launchd / Task Scheduler 注册项包含 session metadata | 无需处理 |
| Secrets/env vars | `TETHER_RUNTIME_SYNC_SECRET` — Relay 调 Server 内部接口使用；新 metadata GET 接口使用同一 secret | 代码变更只，不需要新增 secret；确认该变量在所有环境已配置 |
| Build artifacts | None — no stale compiled artifacts from session rename | 无需处理 |

**已验证的 `upsertGatewaySession` 不写 workspace_id：** 代码第 115-131 行的 INSERT 语句中列清单不含 `workspace_id`。[VERIFIED: apps/server/app/service/runtimeSyncRepository.ts]

**已验证 007 migration 包含 gateway_sessions 处理：** `007_remove_workspace.sql` 最后一节 `ALTER TABLE gateway_sessions DROP COLUMN workspace_id`。[VERIFIED: apps/server/sql/007_remove_workspace.sql]

**风险 R8（D-12）：** 如果某个环境的 Server DB 只跑了 002 但没跑 007，`gateway_sessions` 仍有 `workspace_id NOT NULL`。验证方式：`SHOW COLUMNS FROM gateway_sessions LIKE 'workspace_id'` 应返回空。

---

## Common Pitfalls

### Pitfall 1: relay.ts 中 case 'client.chat' 异步改造时 `handleClientFrame` 变同步为异步

**What goes wrong:** 当前 `handleClientFrame` 是同步函数，但补 `fetchMetadata`（await）后必须变 async，需同步修改调用方
**Why it happens:** `handleClientFrame` 被 `socket.on('message', ...)` 的闭包同步调用
**How to avoid:** 与现有 `handleGateway` 的做法一致，在 `socket.on('message', ...)` 的 `void (async () => { ... })()` 包装中处理；或 `handleClientFrame` 直接返回 Promise 由调用方处理
**Warning signs:** TypeScript 编译报 "不能将 async 函数结果赋值给 void" 或 "对象可能为 undefined"

### Pitfall 2: IChatRunner.run() 签名变化需同步更新 3 个具体实现

**What goes wrong:** `IChatRunner` 接口新增 `session` 字段后，`CliChatRunner.run()`（被 `ChatSessionRunner`/`CodexChatRunner`/`CopilotChatRunner` 继承）必须同步更新
**Why it happens:** 三个 runner 类共用 `CliChatRunner` 基类
**How to avoid:** 统一在 `CliChatRunner.run()` 处修改签名，子类无需单独改
**Warning signs:** `tsc --noEmit` 报 `IChatRunner` 实现不匹配

### Pitfall 3: relay-client.ts 中 `chatClientBindings` 映射时序

**What goes wrong:** 新建 chat 时 `chatClientBindings.set(sessionId, clientId)` 必须在发 `gateway.chat-session-created` 之前完成，否则后续 `onUserMessage` / `onDelta` 找不到 clientId
**Why it happens:** chatClientBindings 是运行时路由表；新建 session 时 clientId 只在 callback 参数中
**How to avoid:** `onChatSessionCreated` callback 中先 set chatClientBindings，再 send 帧
**Warning signs:** agent.delta / agent.result 推送丢失 clientId，Web 收不到流式更新

### Pitfall 4: updateAgentSessionId PATCH endpoint 的 scope 来源

**What goes wrong:** `session.agent-id-updated` 事件由 relay-client.ts `sendChatEvent` 发给 Relay，Relay 再 PATCH Server。当前 PATCH body 只有 `{ agentSessionId }`，新增 scope 后 Relay 需要知道 accountId/gatewayId/userId
**Why it happens:** 当前 `sendChatEvent` 发的 payload 不含 scope，relay.ts 处理 `session.agent-id-updated` 时也未注入
**How to avoid:** relay.ts 处理 `gateway.event` case `session.agent-id-updated` 时，从 `gatewayScope` 中取 accountId/gatewayId，从 payload 或 latestSessions 中取 userId，拼进 PATCH body
**Warning signs:** Server `updateAgentSessionId` SQL `WHERE id = ? AND account_id = ?` 影响行数为 0（静默不报错）

### Pitfall 5: gateway.chat-session-created 处理时 latestSessions 更新与 broadcastSessionList 时序

**What goes wrong:** 如果 relay.ts 先 broadcastSessionList 后才 upsert Server，Web 刷新列表时 Server 可能还没有该 session
**Why it happens:** D-04 要求 Server ack 后再通知 Web；当前 `broadcastSessionList` 是同步的
**How to avoid:** 严格按 D-04 顺序：syncToServer（await）成功 → 更新 latestSessions → broadcastSessionList → 通知 Web session-created。失败则不走后续步骤
**Warning signs:** T14（新建后立即刷新读不到 session）单测失败

### Pitfall 6: Protocol 包类型变更需要 rebuild 才能被其他包感知

**What goes wrong:** 修改 `packages/protocol/src/index.ts` 后，gateway/relay/web 不重新 build 会用旧类型
**Why it happens:** pnpm workspace 依赖有 build cache
**How to avoid:** 修改 protocol 后先 `pnpm --filter @tether/protocol build`（或 typecheck），再 typecheck 下游
**Warning signs:** tsc 报 "Property 'session' does not exist on type"（虽然代码已写但 package 未 rebuild）

---

## Code Examples

### 现有 syncToServer（Relay）— 可复用为 fetchFromServer

```typescript
// Source: apps/relay/src/relay.ts lines 78-98 [VERIFIED]
async function syncToServer(endpoint: string, body: unknown, method = 'POST'): Promise<void> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) return;
  try {
    const response = await fetch(`${options.serverSyncUrl}${endpoint}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': options.runtimeSyncSecret
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) console.warn(`[relay] sync failed: ${endpoint} HTTP ${response.status}`);
  } catch (error) {
    console.warn(`[relay] sync error: ${endpoint}`, String(error));
  }
}
```

新增 GET 版本（fetchFromServer）参考上述模式，改 method 为 `'GET'`，body 为空，返回 `response.json()`。

### 现有 require-runtime-sync-secret 中间件（Server）

```typescript
// Source: apps/server/app/middleware/require-runtime-sync-secret.ts [VERIFIED via router.ts]
// 用法：router.get('/api/relay/gateway-sessions/:sessionId/metadata',
//           requireRuntimeSyncSecret, controller.runtimeSync.getSessionMetadata)
```

### 现有 gateway_sessions 查询模式（Server）

```typescript
// Source: apps/server/app/service/chatRepository.ts lines 65-77 [VERIFIED]
const rows = await this.ctx.service.db.query(
  `SELECT id, gateway_id, provider, project_path, title, agent_session_id, status, transport, last_active_at, created_at
   FROM gateway_sessions
   WHERE account_id = ? AND user_id = ? AND transport = 'chat'
   ORDER BY last_active_at DESC, created_at DESC
   LIMIT 50`,
  [accountId, userId]
);
```

新 metadata 接口参考此模式，按 sessionId 查并返回 provider/projectPath/agentSessionId/gatewayId/transport。

### 现有 `createSessionId`（Gateway）

```typescript
// Source: apps/gateway/src/ids.ts [VERIFIED]
// 格式：tth_YYYYMMDD_xxxxxxxx
export function createSessionId(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = randomBytes(4).toString('hex');
  return `tth_${yyyy}${mm}${dd}_${suffix}`;
}
```

新建 chat session 的 sessionId 继续用此函数。

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| chat 内容写 Gateway 本地 `session_chats_events` | 已删除本地 chat 内容表，直接发 gateway.event 上报 Relay/Server | Phase 13 完成 | appendChatEvent/listChatEvents 已不存在（A1 已通过） |
| Gateway `sendSessions()` 隐式同步新建 session | Phase 15 目标：显式 `gateway.chat-session-created` | 本阶段 | 消除竞争条件 R12 |
| latestSessions 内存作为唯一 metadata 来源 | Phase 15 目标：Server DB 作为 fallback 事实源 | 本阶段 | 解决 Gateway 断线后续聊问题 R2 |

**Deprecated/outdated:**
- `store.insertSession()` for chat transport：Phase 15 后从 chat runner 中删除
- `store.touchSession()` in chat runner：Phase 15 后删除（共 4 处调用：第 273、399、418、425 行）
- `store.updateAgentSessionId()` in chat runner：Phase 15 后删除（共 2 处调用：第 369、398 行）
- `store.getSession(params.sessionId)` in chat runner 续聊分支：Phase 15 后删除（第 245 行）

---

## Assumptions Log

**如果此表为空：所有声明均已通过代码验证，无需用户确认。**

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

---

## Open Questions (RESOLVED)

1. **`gateway.chat-session-created` 失败时 Web 端的用户体验**
   - What we know: D-10 要求明确失败不静默
   - What's unclear: Web 端现有的错误处理是否能正确显示 "session 创建失败" 而不是无限等待
   - Recommendation: 规划中可先验证 Web 现有 error 帧处理路径；如不够，作为 Plan 中的验收步骤列出
   - **RESOLVED: Relay 通过现有 chat_error / wrong_transport 帧通知 Client；session_sync_failed 错误通过 chat_error 帧传递，Web 收到后显示失败提示。P03 Task 3 验收项包含发送 chat_error 帧的测试。**

2. **chat event id 的幂等方案（Claude's Discretion）**
   - What we know: 现有 `chatEventSequence` 是进程内自增 + 时间戳，不能跨重启保证唯一
   - What's unclear: 是使用 `randomUUID`（简单）还是 `ulidx`（可排序）
   - Recommendation: 第一版用 `randomUUID`（Node 内置，无额外依赖）；`source_event_id` 已在 `gateway_chat_messages` 的 UNIQUE KEY 中保证幂等
   - **RESOLVED: 使用 randomUUID()（Node.js crypto 内置，无额外依赖）作为 source_event_id。**

3. **`relay.ts` 中 `handleClientFrame` 改 async 后测试影响**
   - What we know: relay.test.ts 中有 client.chat 测试用例（第 627 行），目前同步框架
   - What's unclear: 改 async 后现有测试是否需要同步调整
   - Recommendation: 先 typecheck 确认无编译错误，再跑测试；如果测试框架对 async message handler 有问题，参考现有 handleGateway 的 `void (async () => ...)()` 模式
   - **RESOLVED: handleClientFrame 改 async 仅影响 relay.test.ts 中直接调用的测试，Wave 0 已追加正确 stub，不是阻塞项。**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `fetch` API | Relay fetchSessionMetadata | ✓ | Node 18+（项目已在用）| — |
| `TETHER_RUNTIME_SYNC_SECRET` env var | Relay → Server 内部接口 | ✓（已在生产用于 syncToServer）| — | 缺失时 fetchMetadata 返回 undefined，续聊返回 session_not_found |
| MySQL（Server DB） | GET metadata 接口 | ✓ | 既有配置 | — |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (gateway) | Node.js built-in test runner (`node:test`) |
| Framework (relay) | `tsx --test` |
| Framework (server) | `egg-mock` + `mocha`-style |
| Config file | 无独立配置，命令在各 package.json |
| Quick run (gateway) | `pnpm --filter @tether/gateway test` |
| Quick run (relay) | `pnpm --filter @tether/relay test` |
| Full suite | `pnpm test`（跑所有 -r 包） |

### Phase Requirements → Test Map

| 验收项 | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A1 | appendChatEvent/listChatEvents 不存在 | grep | `rg -n "appendChatEvent\|listChatEvents" apps/gateway/src` | ✅ 验收脚本 |
| A2 | Gateway 续聊不调用 store.getSession | grep + unit | `rg -n "store\.getSession" apps/gateway/src/chat-session-runner.ts` | ❌ Wave 0 补 |
| A3 | createChatSession 不调用 insertSession | grep + unit | `rg -n "insertSession" apps/gateway/src/chat-session-runner.ts` | ❌ Wave 0 补 |
| A4 | chat runner 不调用 touchSession | grep | `rg -n "touchSession" apps/gateway/src/chat-session-runner.ts` | ❌ Wave 0 补 |
| A5 | chat runner 不调用 updateAgentSessionId | grep | `rg -n "updateAgentSessionId" apps/gateway/src/chat-session-runner.ts` | ❌ Wave 0 补 |
| A6 | PTY 链路不受影响 | unit | `pnpm --filter @tether/gateway test` | ✅ 已有 store.test.ts |
| A7 | transport != 'chat' 被拒绝 | unit | relay.test.ts 新增 | ❌ Wave 0 补 |
| A8 | 新建 chat provider/cwd 受校验 | unit | relay-client.test.ts 新增 | ❌ Wave 0 补 |
| T1 | Relay metadata 补齐 | unit | relay.test.ts 新增 | ❌ Wave 0 补 |
| T2 | 跨用户 session 被拒绝 | isolation unit | relay.test.ts 新增 | ❌ Wave 0 补 |
| T4 | Gateway 无本地 session 续聊 | unit | chat-session-runner.test.ts 新增 | ❌ Wave 0 补 |
| T5 | 新建 chat session 不写本地 | unit | chat-session-runner.test.ts 新增 | ❌ Wave 0 补 |
| T10 | 旧库/空库 schema | unit | runtime-sync.test.ts 已有基础 | ✅ 可扩展 |

### Wave 0 Gaps

- [ ] `apps/relay/test/relay.test.ts` — 新增 T1/T2/T7 用例（Relay metadata 补齐、跨账号隔离、transport 校验）
- [ ] `apps/gateway/test/chat-session-runner.test.ts` — 新增 T4/T5 用例（无本地续聊、新建不写本地）
- [ ] `apps/gateway/test/relay-client.test.ts` — 新增 A7/A8 用例（PTY session 发 client.chat 被拒、provider 白名单）
- [ ] `apps/server/test/chat-repository.test.ts` — 新增 scope 校验测试（updateAgentSessionId 带 WHERE scope）

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Relay 校验 accountId/userId 匹配、transport='chat'；Server updateAgentSessionId WHERE scope |
| V5 Input Validation | yes | Relay 校验 frame.sessionId 不接受任意 metadata；Web 帧禁止携带 provider/projectPath 等 |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Web 客户端伪造 metadata（provider/projectPath/agentSessionId） | Tampering | D-02：RelayClientToServerFrame 类型不含这些字段；Relay 不信任 Web 来的 metadata |
| 跨账号 session 续聊（用 A 账号 token 发 B 账号 sessionId） | Elevation of Privilege | D-13：Relay fetchMetadata 后校验 accountId/userId 与 clientScope 一致 |
| PTY session 误发 client.chat 走 chat runner | Tampering | D-08：transport 校验，返回明确错误 |
| agent_session_id 跨账号覆写 | Tampering | D-07：PATCH WHERE 带 account_id/gateway_id/user_id scope |
| Relay 内存缓存丢失后使用陈旧 metadata | Information Disclosure | D-03：必须从 Server DB 查，不能只靠 latestSessions |

---

## Sources

### Primary (HIGH confidence)
- `apps/gateway/src/chat-session-runner.ts` — 完整阅读，确认所有 store 调用位置（5 处 touchSession，2 处 updateAgentSessionId，1 处 insertSession，1 处 getSession）
- `apps/gateway/src/relay-client.ts` — 完整阅读，确认 case 'client.chat' 当前逻辑（第 334-358 行）
- `apps/relay/src/relay.ts` — 完整阅读，确认 handleClientFrame/handleGatewayFrame/syncToServer 现有逻辑
- `packages/protocol/src/index.ts` — 完整阅读，确认所有帧类型
- `apps/server/app/service/chatRepository.ts` — 完整阅读，确认 updateAgentSessionId 无 scope
- `apps/server/app/service/runtimeSyncRepository.ts` — 确认 upsertGatewaySession 不含 workspace_id
- `apps/server/sql/002_gateway_runtime_sync.sql` — 确认 workspace_id NOT NULL 在原始 schema
- `apps/server/sql/007_remove_workspace.sql` — 确认包含 gateway_sessions 的 workspace_id 删除
- `apps/server/app/router.ts` — 确认现有 `/api/relay/*` 路由和中间件模式

### Secondary (MEDIUM confidence)
- `docs/working/2026-05-11-chat-remote-session-metadata.md` — 完整 PRD，含 R1-R12 风险分析和 T1-T14 测试清单
- `15-CONTEXT.md` — 确认 D-01 至 D-13 所有决策

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — 全部来自当前代码库直接阅读
- Architecture: HIGH — 基于逐行代码分析，非假设
- Pitfalls: HIGH — 基于当前代码中具体行号和现有模式

**Research date:** 2026-05-11
**Valid until:** 2026-06-11（30 天，底层架构稳定）
