# Phase 12: Server DB Runtime Sync - Pattern Map

**Mapped:** 2026-05-09
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/server/sql/002_gateway_runtime_sync.sql` | migration | batch | `apps/server/sql/001_init.sql` | exact |
| `apps/server/app/controller/runtime-sync.ts` | controller | request-response | `apps/server/app/controller/gateway.ts` | exact |
| `apps/server/app/controller/session.ts` | controller | request-response | `apps/server/app/controller/audit.ts` | exact |
| `apps/server/app/service/runtimeSyncRepository.ts` | service | CRUD | `apps/server/app/service/gatewayRepository.ts` | exact |
| `apps/server/app/service/sessionRepository.ts` | service | CRUD | `apps/server/app/service/auditRepository.ts` | exact |
| `apps/server/app/middleware/require-runtime-sync-secret.ts` | middleware | request-response | `apps/server/app/middleware/require-token-class.ts` | exact |
| `apps/server/app/schedule/cleanup-runtime-events.ts` | schedule | batch | 无（目录首建） | none |
| `apps/server/app/router.ts` | route | — | `apps/server/app/router.ts`（追加） | exact |
| `apps/server/app/service/db.ts` | service | — | `apps/server/app/service/db.ts`（修改） | self |
| `apps/relay/src/relay.ts` | service | event-driven | `apps/relay/src/relay.ts`（追加） | self |
| `apps/gateway/src/store.ts` | model | CRUD | `apps/gateway/src/store.ts`（删除） | self |
| `apps/gateway/src/journal-watcher.ts` | service | event-driven | `apps/gateway/src/journal-watcher.ts`（删除调用） | self |
| `native/flutter/lib/services/conversation_service.dart` | service | request-response | `native/flutter/lib/services/conversation_service.dart`（修改） | self |

---

## Pattern Assignments

### `apps/server/sql/002_gateway_runtime_sync.sql` (migration, batch)

**Analog:** `apps/server/sql/001_init.sql`

**SQL 风格约定（001_init.sql 对齐）：**
- 主键用 `BIGINT NOT NULL AUTO_INCREMENT` 或字符串主键 `VARCHAR(128) NOT NULL`
- 时间字段全用 `DATETIME`，默认 `CURRENT_TIMESTAMP`，自动更新用 `ON UPDATE CURRENT_TIMESTAMP`
- 所有表用 `CREATE TABLE IF NOT EXISTS` 保证幂等
- UNIQUE 约束命名 `uq_<table>_<cols>`，普通索引命名 `idx_<table>_<col>`
- `payload_json` 类型用 `MEDIUMTEXT`（auditRepository 模式）

**从 RESEARCH.md Code Examples § 1 直接取用 SQL 内容：**
```sql
CREATE TABLE IF NOT EXISTS gateway_sessions (
  id VARCHAR(128) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  gateway_id VARCHAR(128) NOT NULL,
  ...
  PRIMARY KEY (id),
  KEY idx_gateway_sessions_account_workspace (account_id, workspace_id),
  KEY idx_gateway_sessions_gateway_id (gateway_id)
);
-- 以此类推建 gateway_chat_messages / gateway_runtime_events / gateway_sync_cursors
```

---

### `apps/server/app/controller/runtime-sync.ts` (controller, request-response)

**Analog:** `apps/server/app/controller/gateway.ts`（lines 1-23）

**Imports 模式（gateway.ts lines 1）：**
```typescript
import { Controller } from 'egg';
```

**Controller 核心模式（gateway.ts lines 3-23）：**
```typescript
export default class GatewayController extends Controller {
  public async bind(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.gateway.bindGateway({ ... });
    ctx.success(data);
  }
}
```

**runtime-sync 变体：** 三个 action（sessions / conversation / event），body 强转为 `Record<string, unknown>`，secret 已由 middleware 校验（不在 controller 内重复校验），调用 service 后返回 `ctx.success({ ok: true })`。

**归属校验位置：** 在 service 层做，controller 只传 body 到 service，不做 DB 操作。

---

### `apps/server/app/controller/session.ts` (controller, request-response)

**Analog:** `apps/server/app/controller/audit.ts`

**Audit controller 核心模式（audit.ts）：**
```typescript
// 读接口：从 query params 提取过滤条件，调 service，ctx.success 返回
public async index(): Promise<void> {
  const { ctx } = this;
  const data = await ctx.service.audit.listAuditEvents({ ... });
  ctx.success(data);
}
```

**session controller 变体：**
- `list()`：读 `ctx.state.auth` 拿到 accountId/workspaceId，传入 service 作为过滤条件
- `conversation()`：从 `ctx.params.id` 取 sessionId，查 `gateway_chat_messages`
- `events()`：从 `ctx.params.id` 取 sessionId，支持 `?limit=` / `?before=` query params 分页

---

### `apps/server/app/service/runtimeSyncRepository.ts` (service, CRUD)

**Analog:** `apps/server/app/service/gatewayRepository.ts`（lines 1-102）

**Imports 模式（gatewayRepository.ts lines 1-3）：**
```typescript
import { Service } from 'egg';
import type { GatewayRecord } from './runtime';
```

**mysqlModeEnabled 检查模式（lines 6-9）：**
```typescript
private mysqlModeEnabled() {
  const { ctx } = this;
  return ctx.service.db.mysqlModeEnabled();
}
```

**ON DUPLICATE KEY UPDATE upsert 模式（gatewayRepository.ts lines 38-51）：**
```typescript
public async saveGateway(gateway: GatewayRecord): Promise<string> {
  if (!this.mysqlModeEnabled()) {
    ctx.service.runtime.runtimeStore().gateways.set(gateway.id, gateway);
    return gateway.id;
  }
  await ctx.service.db.query(
    `INSERT INTO gateways (account_id, workspace_id, ...)
     VALUES (?, ?, ...)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       last_seen_at = VALUES(last_seen_at),
       updated_at = VALUES(updated_at)`,
    [gateway.accountId, ...]
  );
}
```

**runtimeSyncRepository 变体：**
- `mysqlModeEnabled()` 为 false 时直接 return（test env 不写 DB，不需要 in-memory fallback）
- 四个 upsert 方法：`upsertGatewaySession` / `upsertChatMessage` / `upsertRuntimeEvent` / `upsertSyncCursor`
- **写 `gateway_chat_messages` / `gateway_runtime_events` 前必须先查 `gateway_sessions` 验证归属**（防串 Pitfall 3）
- `upsertRuntimeEvent` 写 `payload_json` 前调用 `maskSensitiveOutput`（D-09）

---

### `apps/server/app/service/sessionRepository.ts` (service, CRUD)

**Analog:** `apps/server/app/service/auditRepository.ts`（lines 1-216）

**Row 映射模式（auditRepository.ts lines 42-61）：**
```typescript
private auditEventFromRow(row: Record<string, unknown>): AuditEventRecord {
  const payload = row.payload_json && typeof row.payload_json === 'string'
    ? JSON.parse(String(row.payload_json)) as Record<string, unknown>
    : (row.payload_json as Record<string, unknown> | null) ?? {};
  return {
    id: Number(row.id),
    accountId: String(row.account_id),
    ...
  };
}
```

**分页查询模式（auditRepository.ts lines 139-156）：**
```typescript
public async loadAuditEventsFiltered(params: { limit: number; offset: number; ... }): Promise<...[]> {
  const { where, values } = this.buildAuditFilter(params);
  const sql = `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = await ctx.service.db.query(sql, [...values, params.limit, params.offset]);
  return (rows as Record<string, unknown>[]).map(row => this.auditEventFromRow(row));
}
```

**sessionRepository 变体：**
- `listSessions(accountId, workspaceId, limit, offset)` — 过滤 account/workspace，ORDER BY last_active_at DESC
- `getConversation(sessionId, accountId, workspaceId)` — 先校验 session 归属，再 SELECT gateway_chat_messages
- `listEvents(sessionId, accountId, workspaceId, limit, before?)` — cursor 分页，`WHERE session_id = ? AND id < ?`
- `mysqlModeEnabled()` false 时返回空数组（D-03 Server DB 不命中返回空）

---

### `apps/server/app/middleware/require-runtime-sync-secret.ts` (middleware, request-response)

**Analog:** `apps/server/app/middleware/require-token-class.ts`（lines 1-20）

**Middleware 工厂模式（require-token-class.ts lines 9-20）：**
```typescript
export default function requireTokenClass(options: RequireTokenClassOptions) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const payload = ctx.state.auth as { tokenClass?: AuthTokenClass } | undefined;
    if (!payload?.tokenClass) {
      ctx.throw(402, 'Token 必填');
    }
    if (!options.expected.includes(payload.tokenClass)) {
      ctx.throw(402, 'Token 异常');
    }
    await next();
  };
}
```

**require-runtime-sync-secret 变体：**
```typescript
import type { Context } from 'egg';

export default function requireRuntimeSyncSecret() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const secret = ctx.get('x-tether-runtime-sync-secret');
    const expected = ctx.app.config.runtimeSyncSecret as string | undefined;
    if (!expected || secret !== expected) {
      ctx.throw(403, 'Invalid sync secret');
    }
    await next();
  };
}
```

注意：`runtimeSyncSecret` 需在 `config.default.ts` 从 `process.env.TETHER_RUNTIME_SYNC_SECRET` 读取。

---

### `apps/server/app/schedule/cleanup-runtime-events.ts` (schedule, batch)

**Analog:** 无（`app/schedule/` 目录 Phase 12 首建）

**参考：** egg-schedule 4.0.1 README（`apps/server/node_modules/egg-schedule/`）+ RESEARCH.md Pattern 4

**egg-schedule 约定写法：**
```typescript
import { Subscription } from 'egg';

export default class CleanupRuntimeEvents extends Subscription {
  static get schedule() {
    return {
      type: 'worker',
      cron: '0 0 3 * * *',  // 每天凌晨 3 点
    };
  }

  async subscribe() {
    const { ctx } = this;
    if (!ctx.service.db.mysqlModeEnabled()) return;
    // 1. 删超过 1 个月的旧行（LIMIT 每次批量，避免长锁）
    await ctx.service.db.query(
      `DELETE FROM gateway_runtime_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 MONTH) LIMIT 10000`
    );
    // 2. 按 session_id 分批删超过 10 万条的旧行（见 RESEARCH.md Pitfall 2）
    const sessions = await ctx.service.db.query(
      `SELECT DISTINCT session_id FROM gateway_runtime_events`
    );
    for (const row of sessions as { session_id: string }[]) {
      await ctx.service.db.query(
        `DELETE FROM gateway_runtime_events
         WHERE session_id = ?
           AND id < (
             SELECT id FROM (
               SELECT id FROM gateway_runtime_events
               WHERE session_id = ?
               ORDER BY id DESC LIMIT 1 OFFSET 99999
             ) AS t
           )`,
        [row.session_id, row.session_id]
      );
    }
  }
}
```

---

### `apps/server/app/router.ts` (route, 追加)

**Analog:** `apps/server/app/router.ts`（lines 1-34，在此文件追加）

**当前路由注册模式（lines 4-16）：**
```typescript
export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireNormalAccess = middleware.requireTokenClass({ expected: ['normal_client_access'] });
  // ... router.post / router.get 注册
};
```

**追加内容：**
```typescript
const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

// 内部写接口（Relay 调用，secret header 鉴权）
router.post('/api/runtime-sync/gateway/sessions',     requireRuntimeSyncSecret, controller.runtimeSync.sessions);
router.post('/api/runtime-sync/gateway/conversation', requireRuntimeSyncSecret, controller.runtimeSync.conversation);
router.post('/api/runtime-sync/gateway/event',        requireRuntimeSyncSecret, controller.runtimeSync.event);

// 外部读接口（普通用户 token）
router.get('/api/sessions',                           requireNormalAccess, controller.session.list);
router.get('/api/sessions/:id/conversation',          requireNormalAccess, controller.session.conversation);
router.get('/api/sessions/:id/events',                requireNormalAccess, controller.session.events);
```

同时在 `config.default.ts` 的 `verifyLoginWhitelist` 追加 `'/api/runtime-sync/'` 前缀路径（让全局 verify-login middleware 跳过这些接口，由 requireRuntimeSyncSecret 独立校验）。

---

### `apps/server/app/service/db.ts` (service, 修改)

**Self-analog:** `apps/server/app/service/db.ts`（lines 25-37）

**当前 ensureSchema（lines 25-37，需改为顺序读取所有 sql/*.sql）：**
```typescript
// 当前实现（硬编码 001_init.sql）：
schemaReady = (async () => {
  const sqlPath = path.resolve(__dirname, '../../sql/001_init.sql');
  const sql = await readFile(sqlPath, 'utf8');
  await this.mysql().query(sql);
})();
```

**修改后（RESEARCH.md Code Examples § 2）：**
```typescript
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

schemaReady = (async () => {
  const sqlDir = path.resolve(__dirname, '../../sql');
  const files = readdirSync(sqlDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await readFile(path.join(sqlDir, file), 'utf8');
    await this.mysql().query(sql);
  }
})();
```

`readdirSync` 已可从 `node:fs` 导入（`readFile` 已从 `node:fs/promises` 导入，风格一致）。

---

### `apps/relay/src/relay.ts` (service, event-driven, 追加 syncToServer)

**Self-analog:** `apps/relay/src/relay.ts`（lines 54-207）

**现有 handleGatewayFrame 结构（lines 176-207）：**
```typescript
function handleGatewayFrame(frame: RelayGatewayToServerFrame, gatewayScope: RelayAuthScope): void {
  switch (frame.type) {
    case 'gateway.sessions':
      // ... 现有逻辑 ...
      break;
    case 'gateway.conversation':
      sendConversation(frame.clientId, frame.sessionId, frame.turns);
      break;
    case 'gateway.event':
      sendEventToSubscribers(frame.event);
      break;
    // ...
  }
}
```

**追加 syncToServer 函数（放在 startRelayServer 闭包内，参考 main.ts lines 30-40 的 fetch 模式）：**
```typescript
// 从 RelayServerOptions 新增字段读取（与 validateToken 平行）：
// serverSyncUrl?: string;
// runtimeSyncSecret?: string;

async function syncToServer(endpoint: string, body: unknown): Promise<void> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) return;
  try {
    const resp = await fetch(`${options.serverSyncUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': options.runtimeSyncSecret
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    if (!resp.ok) {
      console.warn(`[relay] sync failed: ${endpoint} HTTP ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[relay] sync error: ${endpoint}`, String(err));
  }
}
```

**在 main.ts 中传入 options：**
```typescript
// apps/relay/src/main.ts 追加：
const relay = await startRelayServer({
  host, port, secret, allowLegacySecret, validateToken,
  serverSyncUrl: serverUrl,
  runtimeSyncSecret: process.env.TETHER_RUNTIME_SYNC_SECRET
});
```

**handleGatewayFrame 各 case 追加（必须 void，不 await，D-05）：**
```typescript
case 'gateway.sessions':
  // 原有逻辑 ...
  void syncToServer('/api/runtime-sync/gateway/sessions', {
    gatewayId: frame.gatewayId,
    sessions: frame.sessions,
    scope: gatewayScope
  });
  break;
case 'gateway.conversation':
  sendConversation(frame.clientId, frame.sessionId, frame.turns);
  void syncToServer('/api/runtime-sync/gateway/conversation', {
    gatewayId: frame.gatewayId,
    sessionId: frame.sessionId,
    turns: frame.turns,
    scope: gatewayScope
  });
  break;
case 'gateway.event':
  sendEventToSubscribers(frame.event);
  if (RUNTIME_EVENT_WHITELIST.has(frame.event.type) || frame.event.type === 'agent.turn') {
    void syncToServer('/api/runtime-sync/gateway/event', {
      gatewayId: frame.gatewayId,
      event: frame.event,
      scope: gatewayScope
    });
  }
  break;
```

`RUNTIME_EVENT_WHITELIST = new Set(['terminal.output', 'terminal.input', 'session.error', 'session.exited', 'agent.status'])`

---

### `apps/gateway/src/store.ts` (model, 删除 conversation_turns)

**Self-analog:** `apps/gateway/src/store.ts`

**待删除内容（通过 grep 定位的行号）：**
- 第 153 行附近：`CREATE TABLE IF NOT EXISTS conversation_turns` DDL 块
- 第 293-325 行附近：`insertConversationTurn` 方法
- 第 319-323 行附近：`listConversationTurns` 方法
- `ConversationTurn` 类型定义（store.ts lines 67-75，如外部无引用则一并删除）

删除前用 grep 确认 `ConversationTurn` 是否被其他文件引用：
```bash
grep -rn "ConversationTurn\|insertConversationTurn\|listConversationTurn" apps/gateway/src/
```

---

### `apps/gateway/src/journal-watcher.ts` (service, 删除 insertConversationTurn 调用)

**Self-analog:** `apps/gateway/src/journal-watcher.ts`（lines 206-229）

**两处待删除调用（lines 208, 220）：**
```typescript
// emitAssistantTurn（line 208）：
const turnIndex = this.store.insertConversationTurn(this.sessionId, 'assistant', content, toolsJson);
// emitUserTurn（line 220）：
const turnIndex = this.store.insertConversationTurn(this.sessionId, 'user', content);
```

删除后，`turnIndex` 变量也不再需要，改为从 `agent.turn` event payload 中的 `turnIndex` 由 Server 侧根据 `turn_index` 字段自行管理（Server `gateway_chat_messages` 的 `turn_index` 由 Relay 从 frame payload 传入）。

---

### `native/flutter/lib/services/conversation_service.dart` (service, 修改)

**Self-analog:** `native/flutter/lib/services/conversation_service.dart`（lines 206-225）

**当前 _refreshConversationSnapshot（lines 206-225）：**
```dart
Future<void> _refreshConversationSnapshot(
  RelayClient relayClient,
  String sessionId,
) async {
  try {
    final data = await relayClient.authService.getSessionConversation(sessionId);
    final turns = (data['turns'] as List<dynamic>? ?? const [])
        .map((entry) => RelayConversationTurn.fromJson(entry as Map<String, dynamic>))
        .toList();
    _replaceWithConversation(turns);
  } catch (_) {
    relayClient.requestConversation(sessionId);  // <-- 待删除的 WS fallback
  }
}
```

**修改后（D-12 / D-11：移除 WS fallback）：**
```dart
Future<void> _refreshConversationSnapshot(
  RelayClient relayClient,
  String sessionId,
) async {
  try {
    final data = await relayClient.authService.getSessionConversation(sessionId);
    final turns = (data['turns'] as List<dynamic>? ?? const [])
        .map((entry) => RelayConversationTurn.fromJson(entry as Map<String, dynamic>))
        .toList();
    _replaceWithConversation(turns);
  } catch (_) {
    // Server DB miss 时返回空数组（D-03），catch 分支保持 _turns 不变，不回落 Relay WS
  }
}
```

`authService.getSessionConversation` 已指向 Server HTTP `GET /api/sessions/:id/conversation`（auth_service.dart lines 139-145，无需改动）。

---

## Shared Patterns

### 1. mysqlModeEnabled 检查
**Source:** `apps/server/app/service/gatewayRepository.ts` lines 6-9
**Apply to:** `runtimeSyncRepository.ts`、`sessionRepository.ts`、`cleanup-runtime-events.ts`
```typescript
private mysqlModeEnabled() {
  const { ctx } = this;
  return ctx.service.db.mysqlModeEnabled();
}
```

### 2. ctx.service.db.query 参数化查询
**Source:** `apps/server/app/service/auditRepository.ts` lines 76-98
**Apply to:** 所有 Server service 文件
```typescript
await ctx.service.db.query(
  `INSERT INTO table_name (col1, col2) VALUES (?, ?)`,
  [val1, val2]
);
```
永远不要字符串拼接 SQL，始终使用参数占位符 `?`。

### 3. sqlDateToMs 行映射辅助
**Source:** `apps/server/app/service/gatewayRepository.ts` lines 11-15
**Apply to:** `sessionRepository.ts`（映射 MySQL DATETIME → JS number）
```typescript
private sqlDateToMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  return Date.now();
}
```

### 4. ctx.success 响应格式
**Source:** `apps/server/app/controller/auth.ts` lines 16, 31, 44
**Apply to:** `runtime-sync.ts`、`session.ts`
```typescript
ctx.success(data);           // 返回数据
ctx.success({ ok: true });   // 写入成功响应
```

### 5. void + fetch 异步不阻塞模式
**Source:** `apps/relay/src/main.ts` lines 29-40（fetch 调用风格）
**Apply to:** `relay.ts` syncToServer 调用处
```typescript
void syncToServer('/api/runtime-sync/gateway/sessions', { ... });
// 注意：不 await，不 try/catch 在调用处，错误由 syncToServer 内部 catch 处理
```

### 6. maskSensitiveOutput 调用
**Source:** `apps/gateway/src/mask.ts`（maskSensitiveOutput 函数）
**Apply to:** `runtimeSyncRepository.ts` 的 upsertRuntimeEvent 方法
```typescript
// terminal.output / terminal.input 写 payload_json 前必须调用
import { maskSensitiveOutput } from '../../gateway/src/mask'; // 或通过 frame payload 已脱敏
const maskedPayload = maskSensitiveOutput(JSON.stringify(event.payload));
```
注意：mask 发生在 Server 侧 service 层（写库前），不在 Relay 侧。

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/server/app/schedule/cleanup-runtime-events.ts` | schedule | batch | 项目中 `app/schedule/` 目录尚不存在，无现有定时任务可参考；使用 egg-schedule 4.0.1 README 约定 |

---

## Key Pitfalls（规划时必须标注）

| Pitfall | 影响文件 | 防范措施 |
|---------|---------|---------|
| verifyLoginWhitelist 缺失导致 sync 接口 401 | `config.default.ts` + `router.ts` | 将 `/api/runtime-sync/` 系列加入 whitelist，然后在路由层用 requireRuntimeSyncSecret |
| ensureSchema 不加载 002.sql | `db.ts` | 修改为顺序读取 sql/ 目录所有 .sql 文件 |
| 写库前不做 session 归属校验 | `runtimeSyncRepository.ts` | 写 chat_messages / runtime_events 前先查 gateway_sessions 验证 account/workspace/gateway |
| 定时清理不按 session 隔离 | `cleanup-runtime-events.ts` | 先 SELECT DISTINCT session_id，逐个 session 执行超限删除 |
| Flutter WS fallback 未移除 | `conversation_service.dart` | catch 分支删除 relayClient.requestConversation 调用 |

---

## Metadata

**Analog search scope:** `apps/server/app/`, `apps/relay/src/`, `apps/gateway/src/`, `native/flutter/lib/services/`
**Files scanned:** 13 files read directly + grep 辅助定位
**Pattern extraction date:** 2026-05-09
