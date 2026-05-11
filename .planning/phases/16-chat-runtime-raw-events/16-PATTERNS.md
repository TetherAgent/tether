# Phase 16: Chat Runtime Raw Events - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 11
**Analogs found:** 10 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/gateway/src/chat-session-runner.ts` | runner (modify) | event-driven | self — 现有 `CliChatRunner` + `createEmitter` | exact |
| `apps/relay/src/relay.ts` | relay (modify) | event-driven / request-response | self — 现有 `handleGatewayFrame` + `syncToServer` | exact |
| `apps/server/app/service/runtimeSyncRepository.ts` | repository (modify) | CRUD / transaction | self — 现有 `upsertRuntimeEvent` + `insertDerivedChatMessage` | exact |
| `apps/server/app/controller/runtime-sync.ts` | controller (modify) | request-response | self — 现有 `event()` 方法 | exact |
| `apps/server/app/service/chatRepository.ts` | repository (read-confirm) | CRUD | self — 只确认读路径不变 | exact |
| `apps/server/app/controller/chat-events.ts` | controller (new) | request-response | `apps/server/app/controller/runtime-sync.ts` | role-match |
| `apps/server/app/service/chatEventsRepository.ts` | repository (new) | CRUD | `apps/server/app/service/chatRepository.ts` | role-match |
| `apps/server/app/router.ts` | route (modify) | — | self — 现有 `requireRuntimeSyncSecret` 路由 | exact |
| `apps/server/sql/` | migration (new) | — | `apps/server/app/service/db.ts` 读取 sql/ 目录 | partial |
| `apps/web/src/components/chats/chat-panel.tsx` | component (modify) | event-driven | self — 现有 `useRef` 游标模式 | exact |
| `packages/protocol/src/index.ts` | type definition (modify) | — | self — 现有 `RelayServerToClientFrame` 定义 | exact |

---

## Pattern Assignments

### `apps/gateway/src/chat-session-runner.ts` (modify)

**改动目标：** 在 `CliChatRunner` 中新增 per-session delta id 计数器（D-04/D-05），并在 `finishResult` 里向 `agent.result` payload 注入 `lastDeltaEventId`（D-16）。

**Analog:** `apps/gateway/src/chat-session-runner.ts` 自身

**现有 delta 发射点** (lines 369-373):
```typescript
delta: (text) => {
  active.accumulatedText += text;
  this.options.onDelta({ clientId: active.clientId, sessionId, text });
},
```
Phase 16 在这里递增 `nextDeltaId`，将 id 随 `onDelta` 携带出去（或直接嵌入 event 创建逻辑）。

**现有 finishResult agent.result 构建** (lines 398-423):
```typescript
const resultEvent = createChatEvent(sessionId, 'agent.result', {
  text,
  usage,
  ...(stopReason ? { stop_reason: stopReason } : {})
});
this.options.onResult({
  clientId: active.clientId,
  sessionId,
  event: resultEvent,
  text,
  usage,
  stopReason,
  contextWindow: active.contextWindow,
  rateLimitInfo: active.rateLimitInfo,
  contextInputTokens: active.contextInputTokens,
  nextSuggestions
});
```
Phase 16 在 `resultEvent` payload 里追加 `lastDeltaEventId: nextDeltaId - 1`，计数器维护为 `CliChatRunner` 的私有属性，per-session（不是全局）。

**计数器作用域规则：** `activeSubprocesses` map 已按 `sessionId` 隔离。delta id 计数器也应与 session 绑定，可放入 `ActiveSubprocess` 结构中（如 `nextDeltaId: 1`），或放在 `CliChatRunner` 的 `Map<string, number>` 里，随 `activeSubprocesses.delete(sessionId)` 一起清理。

---

### `apps/relay/src/relay.ts` (modify)

**改动目标 1：** `agent.delta` handler (lines 386-397) 在 `break` 前插入 `syncToServer` 调用，将完整 event object 传给 Server，并在 scope 里携带 `transport: 'chat'`（D-06/D-07/D-08）。

**改动目标 2：** `client.subscribe` handler (lines 719-767) 在 chat session 为 `running` 状态时调用 catch-up 接口（D-13）。

**Analog:** `apps/relay/src/relay.ts` 自身

**现有 syncToServer 调用模式** (lines 81-103):
```typescript
async function syncToServer(endpoint: string, body: unknown, method = 'POST'): Promise<boolean> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) {
    return false;
  }
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
    if (!response.ok) {
      console.warn(`[relay] sync failed: ${endpoint} HTTP ${response.status}`);
    }
    return response.ok;
  } catch (error) {
    console.warn(`[relay] sync error: ${endpoint}`, String(error));
    return false;
  }
}
```

**现有 agent.delta handler** (lines 386-397) — Phase 16 在 `break` 前插入 syncToServer:
```typescript
if (frame.event.type === 'agent.delta') {
  const clientId = chatSessionOwners.get(frame.event.sessionId)
    ?? (typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined);
  if (clientId) {
    sendToClient(clientId, {
      type: 'agent.delta',
      sessionId: frame.event.sessionId,
      text: String(frame.event.payload.text ?? '')
    });
  }
  // Phase 16: 插入点，break 之前
  break;
}
```
Phase 16 的插入 body 格式参照 gateway.event whitelist 路径 (lines 498-504):
```typescript
void syncToServer('/api/relay/runtime-sync/gateway/event', {
  gatewayId: frame.gatewayId,
  event: frame.event,           // 完整原始 event，含 id/type/sessionId/ts/payload
  scope: {
    ...gatewayScope,
    transport: 'chat'           // D-08: Server 用此字段区分写路径
  }
});
```

**现有 fetchSessionMetadata GET 调用模式** (lines 105-142) — catch-up 接口调用复用此模式:
```typescript
const response = await fetch(
  `${options.serverSyncUrl}/api/relay/chat-events/${encodeURIComponent(sessionId)}?after=${after}`,
  {
    method: 'GET',
    headers: { 'x-tether-runtime-sync-secret': options.runtimeSyncSecret },
    signal: AbortSignal.timeout(3000)
  }
);
```

**现有 client.subscribe chat 分支** (lines 763-767):
```typescript
if (session.transport === 'chat') {
  chatSessionOwners.set(frame.sessionId, clientId);
  break;  // Phase 16: 在 break 之前插入 catch-up 逻辑
}
```

**现有 gateway.chat-catchup 推送给 Client** (lines 516-526):
```typescript
case 'gateway.chat-catchup': {
  const targetClient = clients.get(frame.clientId);
  if (targetClient) {
    sendToSocket<RelayServerToClientFrame>(targetClient.socket, {
      type: 'gateway.chat-catchup',
      sessionId: frame.sessionId,
      text: frame.text
    });
  }
  break;
}
```
Phase 16 catch-up 直接调用 `sendToClient(clientId, { type: 'gateway.chat-catchup', sessionId: frame.sessionId, text: blob, lastEventId: N })`。

---

### `apps/server/app/service/runtimeSyncRepository.ts` (modify)

**改动目标：** 新增 `upsertChatRuntimeEvent` 方法，不修改 `upsertRuntimeEvent`（D-09/D-10）。

**Analog:** `apps/server/app/service/runtimeSyncRepository.ts` 自身

**复用函数** (lines 23-33):
```typescript
function maskPayload(payload: unknown): string {
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return MASK_PATTERNS.reduce((text, pattern) => text.replace(pattern, MASK), value);
}

function truncatePayload(value: string): string {
  if (value.length <= MAX_PAYLOAD_BYTES) {
    return value;
  }
  return `${value.slice(0, MAX_PAYLOAD_BYTES)}...[TRUNCATED]`;
}
```

**事务模板** (lines 160-188) — `upsertChatRuntimeEvent` 事务结构复用此模式:
```typescript
await this.ctx.service.db.transaction(async connection => {
  // 1. 查 user_id
  const sessionRows = await connection.query(
    `SELECT user_id FROM gateway_sessions WHERE id = ? AND gateway_id = ? AND account_id = ? LIMIT 1`,
    [sessionId, scope.gatewayId, scope.accountId]
  );
  // 2. 检查 deleted
  if (await this.sessionDeleted(sessionId, scope, userId, connection)) { return; }
  // 3. 检查 scope 冲突
  if (await this.sessionScopeConflict(sessionId, scope, connection)) { return; }
  // 4. 脱敏 raw_json
  const rawJson = truncatePayload(maskPayload(event));
  // 5. 写 gateway_runtime_chats_events (ON DUPLICATE KEY UPDATE)
  await connection.query(
    `INSERT INTO gateway_runtime_chats_events (session_id, event_id, event_type, raw_json)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       event_type = VALUES(event_type),
       raw_json = VALUES(raw_json),
       updated_at = CURRENT_TIMESTAMP`,
    [sessionId, eventId, eventType, rawJson]
  );
  // 6. 若 user.message / agent.result，同时更新 gateway_chat_messages.raw_json
  //    (仅 ON DUPLICATE KEY UPDATE raw_json，不 INSERT 新行)
});
```

**ON DUPLICATE KEY UPDATE 惯用法** — 参照现有 `upsertRuntimeEvent` (lines 177-185) 和 `insertDerivedChatMessage` (lines 248-265)。

**`insertDerivedChatMessage` 中的 guard** (line 240):
```typescript
if (!Number.isFinite(sourceEventId) || sourceEventId <= 0) { return; }
```
Phase 16 `upsertChatRuntimeEvent` 不调用 `insertDerivedChatMessage`，delta 直接进 `gateway_runtime_chats_events`；对 user.message / agent.result 只更新 `raw_json` 字段（`UPDATE gateway_chat_messages SET raw_json = ? WHERE session_id = ? AND source_event_id = ?`）。

**`RuntimeSyncScope` 类型** (lines 35-38) — Phase 16 扩展为:
```typescript
type RuntimeSyncScope = {
  accountId: string;
  gatewayId: string;
  transport?: string;   // Phase 16 新增，'chat' | undefined
};
```

---

### `apps/server/app/controller/runtime-sync.ts` (modify)

**改动目标：** `event()` 方法中根据 `body.scope.transport === 'chat'` 分发到 `upsertChatRuntimeEvent`，否则走原有 `upsertRuntimeEvent`（D-11）。

**Analog:** `apps/server/app/controller/runtime-sync.ts` 自身

**现有 event() 方法** (lines 63-80):
```typescript
public async event(): Promise<void> {
  const { ctx } = this;
  const body = ctx.request.body as Record<string, unknown>;
  const scope = requireScope(ctx, body.scope);
  const event = requireEvent(ctx, body.event);
  const eventType = String(event.type ?? '');
  const sessionId = String(event.sessionId ?? '');
  const eventId = Number(event.id ?? 0);
  await ctx.service.runtimeSyncRepository.upsertRuntimeEvent(
    sessionId, eventId, eventType, event.payload, scope, event.ts
  );
  ctx.success({ ok: true });
}
```
Phase 16 改为:
```typescript
const scopeRaw = body.scope as Record<string, unknown>;
const transport = typeof scopeRaw?.transport === 'string' ? scopeRaw.transport : undefined;
if (transport === 'chat') {
  await ctx.service.runtimeSyncRepository.upsertChatRuntimeEvent(sessionId, eventId, eventType, event, scope, event.ts);
} else {
  await ctx.service.runtimeSyncRepository.upsertRuntimeEvent(sessionId, eventId, eventType, event.payload, scope, event.ts);
}
```
注意：`upsertChatRuntimeEvent` 接收完整 `event`（含 id/type/sessionId/ts/payload），不只是 `event.payload`，用于构建 raw_json。

**parseScope** (lines 8-27) — Phase 16 不修改此函数，transport 字段不是 scope 的强制字段。

---

### `apps/server/app/controller/chat-events.ts` (new)

**改动目标：** GET `/api/relay/chat-events/:sessionId?after=N` 接口（D-12），鉴权用 `requireRuntimeSyncSecret`。

**Analog:** `apps/server/app/controller/runtime-sync.ts`（同样是 relay 内部接口，同鉴权方式）

**Controller 结构** — 完全对齐 Egg controller 规范:
```typescript
import { Controller } from 'egg';

export default class ChatEventsController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const sessionId = String(ctx.params['sessionId'] ?? '');
    if (!sessionId) {
      ctx.throw(400, 'Missing sessionId');
      return;
    }
    const after = Number(ctx.query['after'] ?? 0);
    const events = await ctx.service.chatEventsRepository.listDeltaEventsAfter(sessionId, after);
    ctx.success({ events });
  }
}
```
- 不直接访问 MySQL，委托给 `chatEventsRepository`。
- 成功用 `ctx.success(data)`，错误用 `ctx.throw()`。
- 参数归一化在 controller 内做，业务判断不在 controller 里。

**路由注册** — 参照现有 `requireRuntimeSyncSecret` 路由模式 (`router.ts` line 49):
```typescript
router.get('/api/relay/chat-events/:sessionId', requireRuntimeSyncSecret, controller.chatEvents.list);
```
同时 `/api/relay/chat-events/:sessionId` 必须加入 `config.verifyLoginWhitelist`（与其他 `/api/relay/runtime-sync/*` 同源）。

---

### `apps/server/app/service/chatEventsRepository.ts` (new)

**改动目标：** 从 `gateway_runtime_chats_events` 按 `session_id + event_type = 'agent.delta' + event_id > after` 读取（D-12）。

**Analog:** `apps/server/app/service/chatRepository.ts`（同为 Egg Service，同样的 `mysqlModeEnabled` 守卫 + `ctx.service.db.query` 模式）

**Service 结构** (参照 chatRepository.ts lines 51-89):
```typescript
import { Service } from 'egg';

export type ChatDeltaEventRow = {
  eventId: number;
  rawJson: string;
};

export default class ChatEventsRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  public async listDeltaEventsAfter(sessionId: string, after: number): Promise<ChatDeltaEventRow[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const rows = await this.ctx.service.db.query(
      `SELECT event_id, raw_json
       FROM gateway_runtime_chats_events
       WHERE session_id = ? AND event_type = 'agent.delta' AND event_id > ?
       ORDER BY event_id ASC`,
      [sessionId, after]
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      eventId: Number(row.event_id ?? 0),
      rawJson: String(row.raw_json ?? '{}')
    }));
  }
}
```
- `import { Service } from 'egg'` 必须在文件顶部。
- 不导出业务函数，只暴露 Service 方法。
- 行对象转换集中在私有 helper 或 map 内联。

---

### `apps/server/sql/` (new migration files)

**改动目标：** 新建表 `gateway_runtime_chats_events`；ALTER TABLE `gateway_chat_messages` 加 `raw_json` 列；更新空库建表 SQL。

**Analog:** `apps/server/app/service/db.ts` — SQL 文件由 `ensureSchema` 自动按文件名排序执行。

**SQL 文件命名规范** — 无现有文件，按 db.ts 的 `readdirSync + sort()` 逻辑，文件名需有序，如:
- `01-init.sql` — 空库完整建表（包含新表和新字段）
- `02-add-chat-events-table.sql` — migration（只含 CREATE TABLE IF NOT EXISTS + INFORMATION_SCHEMA 条件 ALTER）

**INFORMATION_SCHEMA 条件 ALTER 模式**（per server CLAUDE.md）:
```sql
-- ADD COLUMN 必须用条件迁移，不依赖重复错误兜底
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_chat_messages'
    AND COLUMN_NAME = 'raw_json'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE gateway_chat_messages ADD COLUMN raw_json MEDIUMTEXT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

**CREATE TABLE IF NOT EXISTS 模式**（幂等）:
```sql
CREATE TABLE IF NOT EXISTS gateway_runtime_chats_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(128)    NOT NULL,
  event_id    INT             NOT NULL,
  event_type  VARCHAR(64)     NOT NULL,
  raw_json    MEDIUMTEXT      NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY  uk_session_event (session_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

### `apps/web/src/components/chats/chat-panel.tsx` (modify)

**改动目标：** 新增 `lastDeltaEventIdRef`，三个写入点（D-14），subscribe 携带 `after`，delta/catchup 去重（D-17）。

**Analog:** `apps/web/src/components/chats/chat-panel.tsx` 自身

**现有 useRef 游标模式** (lines 390-418) — Phase 16 新增一个游标 ref:
```typescript
const lastDeltaEventIdRef = React.useRef<number>(0);
```
与现有 `subscribedSessionIdRef`、`currentAgentIdRef` 等保持相同的 `React.useRef<T>(initialValue)` 写法。

**现有 subscribe 发帧** (lines 1155-1157):
```typescript
sendFrame({ type: 'client.subscribe', sessionId: currentSessionId, mode: 'control' });
```
Phase 16 改为携带 `after`:
```typescript
sendFrame({ type: 'client.subscribe', sessionId: currentSessionId, mode: 'control', after: lastDeltaEventIdRef.current });
```

**现有 agent.delta 处理** (lines 818-854):
```typescript
if (frame.type === 'agent.delta' && typeof frame.text === 'string') {
  if (frame.sessionId !== currentSessionIdRef.current) { return; }
  // ... setMessages 更新
}
```
Phase 16 在 sessionId 检查之后、`setMessages` 之前插入去重:
```typescript
// D-17: 若 eventId <= 已跟踪游标则丢弃（防止 catch-up blob 与实时流重叠）
if (typeof frame.eventId === 'number' && frame.eventId > 0) {
  if (frame.eventId <= lastDeltaEventIdRef.current) { return; }
  lastDeltaEventIdRef.current = frame.eventId;
}
```

**现有 gateway.chat-catchup 处理** (lines 798-816):
```typescript
if (frame.type === 'gateway.chat-catchup' && typeof frame.text === 'string') {
  // ... setMessages 替换为 blob
}
```
Phase 16 在 setMessages 之后更新游标:
```typescript
if (typeof frame.lastEventId === 'number' && frame.lastEventId > lastDeltaEventIdRef.current) {
  lastDeltaEventIdRef.current = frame.lastEventId;
}
```

**历史加载后初始化游标**（D-14 写入点 3）— 在 `fetchChatMessages` 返回后，取 Server 响应顶层 `lastEventId` 字段（来自 messages API 扩展，D-16），初始化 `lastDeltaEventIdRef.current`。现有 `messages` API 调用模式参照 `listMessages` / `messages()` 返回结构，Phase 16 响应新增 `lastEventId?: number` 顶层字段。

---

### `packages/protocol/src/index.ts` (modify)

**改动目标：** `RelayServerToClientFrame` 的 `agent.delta` 帧新增 `eventId?: number`；`gateway.chat-catchup` 帧新增 `lastEventId?: number`（D-17）。

**Analog:** `packages/protocol/src/index.ts` 自身

**现有类型定义** (lines 132, 136):
```typescript
| { type: 'agent.delta'; sessionId: string; text: string }
| { type: 'gateway.chat-catchup'; sessionId: string; text: string }
```
Phase 16 改为:
```typescript
| { type: 'agent.delta'; sessionId: string; text: string; eventId?: number }
| { type: 'gateway.chat-catchup'; sessionId: string; text: string; lastEventId?: number }
```
`RelayClientToServerFrame` 的 `client.subscribe` 已有 `after?: number` (line 109)，无需修改。

---

## Shared Patterns

### 鉴权：requireRuntimeSyncSecret
**Source:** `apps/server/app/middleware/require-runtime-sync-secret.ts`
**Apply to:** `chat-events.ts` controller（新接口）
```typescript
const secret = ctx.get('x-tether-runtime-sync-secret');
const expected = (ctx.app.config as Record<string, unknown>).runtimeSyncSecret as string | undefined;
if (!expected || secret !== expected) {
  ctx.throw(403, 'Invalid sync secret');
}
```
Relay 侧调用时统一传 `headers: { 'x-tether-runtime-sync-secret': options.runtimeSyncSecret }`。

### 响应包装
**Source:** `apps/server/app/extend/context.ts`（`ctx.success`）
**Apply to:** 所有 controller 方法
- 成功：`ctx.success({ events })` / `ctx.success({ ok: true })`
- 错误：`ctx.throw(status, message)` — 由 error middleware 统一转响应

### MySQL 事务
**Source:** `apps/server/app/service/runtimeSyncRepository.ts` lines 160-188
**Apply to:** `upsertChatRuntimeEvent` 内的双表写入（D-10）
```typescript
await this.ctx.service.db.transaction(async connection => {
  // connection.query(...) 统一使用同一 connection
});
```

### ON DUPLICATE KEY UPDATE（幂等 upsert）
**Source:** `apps/server/app/service/runtimeSyncRepository.ts` lines 177-185
**Apply to:** `gateway_runtime_chats_events` 写入（唯一键 `(session_id, event_id)`）

### 敏感信息脱敏
**Source:** `apps/server/app/service/runtimeSyncRepository.ts` lines 23-33
**Apply to:** `upsertChatRuntimeEvent` 中构建 raw_json 时
```typescript
const rawJson = truncatePayload(maskPayload(event));
```
`maskPayload` 和 `truncatePayload` 是 runtimeSyncRepository.ts 内部私有函数，Phase 16 在同文件内直接复用，不需要 export。

### Relay syncToServer 调用
**Source:** `apps/relay/src/relay.ts` lines 81-103
**Apply to:** relay.ts 的 agent.delta handler 中的 syncToServer 插入点，以及 catch-up GET 调用

### mysqlModeEnabled 守卫
**Source:** `apps/server/app/service/chatRepository.ts` line 52-54
**Apply to:** `chatEventsRepository.ts` 所有 public 方法开头
```typescript
if (!this.mysqlModeEnabled()) { return []; }
```

### verifyLoginWhitelist 白名单
**Source:** `apps/server/config/config.default.ts`（`config.verifyLoginWhitelist`）
**Apply to:** 新增路由 `/api/relay/chat-events/:sessionId` 必须加入白名单，理由：Relay 内部接口，仅凭 `runtimeSyncSecret` 验证，不走用户 JWT。

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | 所有文件均找到现有 analog |

---

## Metadata

**Analog search scope:** `apps/gateway/src/`, `apps/relay/src/`, `apps/server/app/controller/`, `apps/server/app/service/`, `apps/server/app/middleware/`, `apps/web/src/components/chats/`, `packages/protocol/src/`
**Files scanned:** 12
**Pattern extraction date:** 2026-05-11
