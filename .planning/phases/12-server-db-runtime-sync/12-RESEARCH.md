# Phase 12: Server DB Runtime Sync - Research

**Researched:** 2026-05-09
**Domain:** Egg.js Server MySQL 写入 / Relay HTTP 同步 / Flutter HTTP 读路径迁移
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `conversation_turns`（Gateway SQLite）在 Phase 12 完成后废弃。Phase 12 内同时：删除
`conversation_turns` 表定义（migration 层），移除 JournalWatcher 写入 `conversation_turns` 的代码。

**D-02:** JournalWatcher 的触发路径不动。JournalWatcher 继续产生 `agent.turn` 事件（`gateway.event`
子类型），Relay 收到 `agent.turn` 时在现有转发逻辑基础上追加同步 Server DB（`gateway_chat_messages`）。

**D-03:** `GET /api/sessions/:id/conversation` 一步切到读 Server DB，不做双读 fallback（不再经
Relay RPC 到 Gateway SQLite）。Server DB 不命中时返回空数组，不回落 Relay。

**D-04:** Relay 调 Server sync API 失败（超时、503）时静默跳过 + 记日志，不阻塞当前 frame 的
实时转发。靠 Gateway 重连后 snapshot 补偿（`gateway_sync_cursors` cursor 补洞）。

**D-05:** 实时转发（推送给已连 Client WS）和 Server sync 并行执行，互不阻塞。sync 失败不影响
Client 的实时消息接收。

**D-06:** Server runtime sync 接口内部认证使用 `TETHER_RUNTIME_SYNC_SECRET` header（静态环境变量）。
生产上 nginx 额外限制 `/api/runtime-sync/` 只允许 127.0.0.1 访问。

**D-07:** `gateway_runtime_events` 每个 session 保留最新 **10 万条**（所有白名单事件类型合计），
超过时删最旧行。同时删除超过 **1 个月**的旧行。两个条件独立清理。

**D-08:** 清理任务使用 Egg.js `app/schedule/` 定时任务，每天执行一次（Phase 12 首建该目录）。

**D-09:** `terminal.input` 写入 `gateway_runtime_events`，但必须先经过 `maskSensitiveOutput` 过滤。

**D-10:** 读写分流在 nginx 层显式按路径拆分：
- `GET /api/sessions` → Server（读 `gateway_sessions`）
- `GET /api/sessions/:id/conversation` → Server（读 `gateway_chat_messages`）
- Terminal 历史读取接口 → Server（读 `gateway_runtime_events`）
- `POST /api/sessions/:id/input` → Relay（保持反向 RPC）
- `POST /api/sessions/:id/stop` → Relay（保持反向 RPC）

**D-11:** Phase 12 完成后不保留 Relay HTTP RPC 作为读路径 fallback。

**D-12:** Flutter App 的 `ConversationService` 改为调用 Server HTTP 接口（`GET /api/sessions/:id/conversation`），
不再通过 Relay WS 弹 `client.conversation` 请求。与 Web 使用同一读路径。

### Claude's Discretion

- Relay 向 Server sync API 发起 HTTP 请求的具体客户端实现（fetch / node:http / 复用已有 httpRequest 工具）
- `gateway_sync_cursors` 更新的事务粒度（每条事件后更新 vs 批量更新）
- `app/schedule/` 定时任务的具体时间窗口（凌晨低峰时段）
- Server `gateway_runtime_events` 的查询接口分页大小默认值

### Deferred Ideas (OUT OF SCOPE)

- Relay RPC 读路径（`gateway.conversation` 从 Gateway 拉）作为 fallback：Server DB miss 直接返回空，不回落 Gateway。
- 不同 Gateway 产生相同 session id 的多主场景。
- Chat 内容团队共享权限（audit + 保留策略）。
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Web/App 从 Server DB 直接读取 session 列表、聊天历史和受限 Terminal 历史，不再依赖 Gateway 反向 RPC。Relay 收到 Gateway 上报的 gateway.sessions / gateway.conversation / gateway.event frame 后，通过内部 HTTP sync API 实时持久化到 Server DB | 4 张表 schema 已确认；Relay fetch 调用模式已确认；Egg.js controller/service/route/schedule 模式已确认；Flutter `ConversationService` 当前读路径已确认（通过 `authService.getSessionConversation`，即 GET /api/sessions/:id/conversation） |
</phase_requirements>

---

## Summary

本 phase 把 Web/App 的读路径从「Relay → Gateway 反向 RPC」切换到「Server MySQL 直读」。核心变化分三层：

1. **Server 新增 4 张表**（`gateway_sessions` / `gateway_chat_messages` / `gateway_runtime_events` / `gateway_sync_cursors`）和对应的内部写入 API（`POST /api/runtime-sync/gateway/*`）以及外部读取 API（`GET /api/sessions`、`GET /api/sessions/:id/conversation`、`GET /api/sessions/:id/events`）。
2. **Relay 在 `handleGatewayFrame` 每个 case 中追加异步 Server sync 调用**，使用 Node.js 内置 `fetch` 发起 HTTP 请求，并发失败静默跳过。
3. **Gateway 移除 JournalWatcher 写 `conversation_turns` 的代码**，`store.ts` 删除 `conversation_turns` 表定义；Flutter `ConversationService` 改为调用 `authService.getSessionConversation`（该方法已实现，指向 Server HTTP）。

**Primary recommendation:** 严格遵循设计文档中的落地顺序（13 步），先建表 → 写接口 → Relay 同步 → 读接口切换 → Flutter 清理 → Gateway 废弃，确保每步都有可测验收点。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session 列表持久化 | Server DB | — | 唯一 DB writer 原则 |
| Chat 消息持久化 | Server DB | — | 唯一 DB writer 原则 |
| Runtime events 持久化 | Server DB | — | 唯一 DB writer 原则 |
| 同步写入触发 | Relay（frame 接收层） | — | Relay 是 Gateway frame 汇聚点，已有三个 case；在此追加最小化 |
| 归属校验（写入侧） | Server Service 层 | — | Relay 只传 scope，Server 做 DB 校验 |
| 读接口权限过滤 | Server Controller/Service | — | 普通用户 token 隔离 account/workspace |
| 内部 sync 鉴权 | Server Middleware（header check） | nginx allowlist | 双层防护 |
| runtime events 清理 | Server Schedule（Egg.js app/schedule/） | — | D-08 locked |
| 实时推送（live）| Relay WebSocket | — | 继续现有路径，不变 |
| 控制指令（input/stop）| Relay → Gateway RPC | — | 继续现有路径，不变 |
| Flutter 读会话历史 | Server HTTP GET | — | D-12 locked；已有 authService.getSessionConversation |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| egg | ^3.31.0（实际 3.34.0）| Server 框架 | 项目既有，不变 [VERIFIED: apps/server/node_modules/egg] |
| egg-mysql | ^3.0.0 | MySQL 连接 | 项目既有，通过 `ctx.service.db.query()` 调用 [VERIFIED: apps/server/package.json] |
| egg-schedule | ^4.0.1（egg 内置依赖）| 定时任务 | egg 已内置；无需额外安装 [VERIFIED: pnpm/.pnpm/egg-schedule@4.0.1] |
| node:fetch（内置） | Node.js ≥18 | Relay 发出 HTTP sync 请求 | relay/main.ts 已用 fetch 调 Server；无需引入第三方 [VERIFIED: apps/relay/src/main.ts:30] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| maskSensitiveOutput | 已实现 | terminal.input / terminal.output 写库前脱敏 | gateway_runtime_events 所有 terminal 事件写入前必须调用 [VERIFIED: apps/gateway/src/mask.ts] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:fetch | axios / got | 项目已用 fetch（relay/main.ts）；不引入新依赖 |
| egg-schedule | setInterval / cron 库 | egg-schedule 是 egg 框架约定，已内置，无需额外配置 |

**Version verification:** [VERIFIED: package.json + node_modules 直接确认]

---

## Architecture Patterns

### System Architecture Diagram

```
Gateway PTY Session
  │ produces events
  ▼
Gateway store.ts (SQLite)
  │ appendEvent / insertConversationTurn
  ▼
Gateway WS frame publish
  │ gateway.sessions / gateway.conversation / gateway.event
  ▼
Relay handleGatewayFrame()  ─────────────────────────────────────────────
  │                                                                       │
  │ 原有：实时转发 sendEventToSubscribers / broadcastSessionList          │ 新增：void syncToServer(frame, scope)
  │       sendConversation                                                │   fetch POST /api/runtime-sync/gateway/*
  ▼                                                                       ▼
Relay WS push → Client（Web/App/Flutter）              Server MySQL（4 新表）
                                                            │
                                     ┌──────────────────────┤
                                     │                      │
                              GET /api/sessions    GET /api/sessions/:id/conversation
                              GET /api/sessions/:id/events
                                     │
                              Web / Flutter App 读取
```

### Recommended Project Structure

**Server 新增文件：**
```
apps/server/
├── sql/
│   └── 002_gateway_runtime_sync.sql   # 4 张新表
├── app/
│   ├── controller/
│   │   ├── runtime-sync.ts            # POST /api/runtime-sync/gateway/* 内部接口
│   │   └── session.ts                 # GET /api/sessions, GET /api/sessions/:id/conversation, /events
│   ├── service/
│   │   ├── runtimeSyncRepository.ts   # upsert gateway_sessions/chat_messages/runtime_events/sync_cursors
│   │   └── sessionRepository.ts       # 读 gateway_sessions/chat_messages/runtime_events
│   ├── middleware/
│   │   └── require-runtime-sync-secret.ts  # 校验 X-Tether-Runtime-Sync-Secret header
│   ├── schedule/
│   │   └── cleanup-runtime-events.ts  # 每天清理超限+超龄 gateway_runtime_events
│   └── router.ts                      # 追加新路由
```

**Relay 修改文件：**
```
apps/relay/
└── src/
    └── relay.ts                       # handleGatewayFrame 三个 case 追加 void syncToServer()
```

**Gateway 修改文件：**
```
apps/gateway/
└── src/
    ├── store.ts                       # 删除 conversation_turns 表定义和 insertConversationTurn / listConversationTurns 方法
    └── journal-watcher.ts             # 移除 this.store.insertConversationTurn() 两处调用
```

**Flutter 修改文件：**
```
native/flutter/lib/services/
└── conversation_service.dart          # _refreshConversationSnapshot 路径：移除 WS fallback，直接用 authService.getSessionConversation
```

### Pattern 1: Egg.js Controller 写法

**What:** 继承 `Controller`，通过 `ctx.service.xxx` 调用 service，用 `ctx.success()` 返回

```typescript
// Source: [VERIFIED: apps/server/app/controller/auth.ts]
import { Controller } from 'egg';

export default class RuntimeSyncController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const secret = ctx.get('x-tether-runtime-sync-secret');
    // ... 校验 secret，调用 service
    await ctx.service.runtimeSyncRepository.upsertGatewaySessions(body, scope);
    ctx.success({ ok: true });
  }
}
```

### Pattern 2: Egg.js Service Repository 写法

**What:** 继承 `Service`，通过 `ctx.service.db` 执行 SQL，用 `ON DUPLICATE KEY UPDATE` 实现幂等 upsert

```typescript
// Source: [VERIFIED: apps/server/app/service/gatewayRepository.ts:38-49]
import { Service } from 'egg';

export default class RuntimeSyncRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  public async upsertGatewaySession(session: GatewaySessionRecord): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      // in-memory fallback for test env
      return;
    }
    await this.ctx.service.db.query(
      `INSERT INTO gateway_sessions (id, account_id, workspace_id, gateway_id, ...)
       VALUES (?, ?, ?, ?, ...)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         last_active_at = VALUES(last_active_at),
         updated_at = VALUES(updated_at)`,
      [session.id, session.accountId, ...]
    );
  }
}
```

### Pattern 3: Router 注册写法

**What:** 在 `app/router.ts` 追加路由；内部接口用自定义 middleware 替代 `requireNormalAccess`

```typescript
// Source: [VERIFIED: apps/server/app/router.ts]
import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireNormalAccess = middleware.requireTokenClass({ expected: ['normal_client_access'] });
  const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

  // 内部写接口（Relay 调用）
  router.post('/api/runtime-sync/gateway/sessions',    requireRuntimeSyncSecret, controller.runtimeSync.sessions);
  router.post('/api/runtime-sync/gateway/conversation', requireRuntimeSyncSecret, controller.runtimeSync.conversation);
  router.post('/api/runtime-sync/gateway/event',       requireRuntimeSyncSecret, controller.runtimeSync.event);

  // 外部读接口（Web/App 调用）
  router.get('/api/sessions',                          requireNormalAccess, controller.session.list);
  router.get('/api/sessions/:id/conversation',         requireNormalAccess, controller.session.conversation);
  router.get('/api/sessions/:id/events',               requireNormalAccess, controller.session.events);
};
```

**注意：** `verifyLoginWhitelist` 不包含 `/api/runtime-sync/` — 这些接口不用普通 token，用独立的 secret middleware。

### Pattern 4: Egg.js Schedule（定时任务）写法

**What:** 在 `app/schedule/` 目录创建 `.ts` 文件，导出 `schedule` 和 `task`

```typescript
// Source: [VERIFIED: egg-schedule README + pnpm/.pnpm/egg-schedule@4.0.1]
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
    // 删超过 1 个月的旧行
    await ctx.service.db.query(
      `DELETE FROM gateway_runtime_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 MONTH) LIMIT 10000`
    );
    // 删每个 session 超出 10 万条的旧行（循环处理）
    // ... 见 Pitfall 2
  }
}
```

**注意：** `app/schedule/` 目录在项目中**尚不存在**，Phase 12 首建。[VERIFIED: `ls apps/server/app/schedule/ → directory does not exist`]

### Pattern 5: Relay 同步调用写法

**What:** 在 `handleGatewayFrame` 各 case 末尾追加 `void syncToServer()`；使用内置 `fetch`；失败静默 log

```typescript
// Source: [VERIFIED: apps/relay/src/main.ts:30 — 项目已用 fetch 调 Server]
// Source: [VERIFIED: apps/relay/src/relay.ts:176-207 — handleGatewayFrame 结构]

// 在 startRelayServer 闭包内新建：
async function syncToServer(
  endpoint: string,
  body: unknown,
  serverSyncUrl: string,
  syncSecret: string
): Promise<void> {
  try {
    const resp = await fetch(`${serverSyncUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': syncSecret
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)  // 3 秒超时
    });
    if (!resp.ok) {
      console.warn(`[relay] sync to server failed: ${endpoint} ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[relay] sync to server error: ${endpoint}`, err);
  }
}

// handleGatewayFrame 追加：
case 'gateway.sessions':
  // ... 现有逻辑 ...
  if (serverSyncUrl && syncSecret) {
    void syncToServer('/api/runtime-sync/gateway/sessions', {
      gatewayId: frame.gatewayId,
      sessions: frame.sessions,
      scope: gatewayScope
    }, serverSyncUrl, syncSecret);
  }
  break;
```

**`serverSyncUrl` 和 `syncSecret` 来源：** `RelayServerOptions` 新增两个可选字段，从环境变量 `TETHER_SERVER_URL` 和 `TETHER_RUNTIME_SYNC_SECRET` 读取。

### Anti-Patterns to Avoid

- **阻塞转发等同步完成：** `sync` 调用必须是 `void` 异步，不得 `await`（违反 D-05）。
- **在 Relay 直接写 MySQL：** Relay 只能调 Server sync API，不能有 MySQL 依赖（违反"唯一 DB writer"原则）。
- **在 Server sync 接口接受普通用户 token：** 写接口只接受 `TETHER_RUNTIME_SYNC_SECRET` header。
- **`verifyLoginWhitelist` 加 `/api/runtime-sync/`：** 不可以，这是内部接口，不应对普通用户开放。
- **事件写 DB 不做归属校验：** 写 `gateway_runtime_events` 前必须先查 `gateway_sessions` 确认 session 归属（防串）。
- **定时任务写 `DELETE ... LIMIT 10000` 不分 session：** 超限清理必须按 session_id 分批执行，否则会误删其他 session 的历史。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MySQL upsert | 自己先 SELECT 再 INSERT/UPDATE | `INSERT ... ON DUPLICATE KEY UPDATE` | 原子操作，避免竞态；项目 gatewayRepository 已用此模式 |
| 敏感信息掩码 | 自己写正则 | `maskSensitiveOutput`（apps/gateway/src/mask.ts）| 已实现 sk-* / ghp_* / api_key 等模式；直接 import |
| 定时清理调度 | setInterval + 手动 lock | egg-schedule（已内置）| 已内置于 egg，app/schedule/ 约定式注册即可 |
| 内部接口认证 | JWT 验证 | Static secret header（`X-Tether-Runtime-Sync-Secret`）| D-06 locked；JWT 旋转复杂，静态 secret + nginx 限制足够 |

**Key insight:** MySQL 幂等 upsert + egg-schedule + maskSensitiveOutput 三件事都有现成实现，不要重造轮子。

---

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Gateway SQLite `conversation_turns` 表：本机 ~/.tether/tether.db，Phase 12 内废弃 | 代码编辑：删除 store.ts 中 `CREATE TABLE IF NOT EXISTS conversation_turns` DDL 和 `insertConversationTurn` / `listConversationTurns` 方法；现有数据不迁移（D-01 明确废弃，D-03 Server DB 不命中返回空）|
| Stored data | Server MySQL：尚无 `gateway_sessions` 等 4 张表 | SQL migration 文件 `002_gateway_runtime_sync.sql` 建表 |
| Live service config | Relay 进程：需要两个新环境变量 `TETHER_SERVER_URL`（已有）和 `TETHER_RUNTIME_SYNC_SECRET`（新增）| env.example.sh / 部署脚本追加 `TETHER_RUNTIME_SYNC_SECRET` |
| Live service config | Server 进程：需要新环境变量 `TETHER_RUNTIME_SYNC_SECRET` | 同上；config.default.ts 读取并暴露给 middleware |
| Live service config | nginx：`/api/runtime-sync/` 需要 allow 127.0.0.1 + deny all；读接口路径需分流到 Server | nginx 配置更新（deploy/ 目录） |
| OS-registered state | launchd plist（Gateway）：不涉及字符串重命名，无需改动 | 无 |
| Secrets/env vars | `TETHER_RUNTIME_SYNC_SECRET`：新增 secret，需在 Relay 和 Server 两侧设置相同值 | 生成并配置环境变量 |
| Build artifacts | 无 | 无 |

---

## Common Pitfalls

### Pitfall 1：`verifyLoginWhitelist` 缺失导致 sync 接口 401

**What goes wrong:** 新的 `/api/runtime-sync/` 接口没有普通用户 token，但 `verify-login` middleware 全局生效，导致每个请求被 401 拦截。
**Why it happens:** Server 的 `config.default.ts` 设置了 `verifyLoginWhitelist`；新接口不在白名单里，但也不是普通 token 路由，需要走独立的 secret middleware。
**How to avoid:** 把 `/api/runtime-sync/` 系列路径加入 `verifyLoginWhitelist`（跳过全局 token 校验），然后在路由层用 `requireRuntimeSyncSecret` middleware 做 secret header 校验。
**Warning signs:** Relay sync 调用总是返回 402。

### Pitfall 2：按 session_id 分批删除超限 runtime events

**What goes wrong:** `DELETE FROM gateway_runtime_events WHERE id NOT IN (SELECT id FROM ... ORDER BY id DESC LIMIT 100000)` 在 MySQL 不能直接用，且不按 session 隔离。
**Why it happens:** 超限删除必须以 session 为维度；不同 session 的事件数互相独立。
**How to avoid:** 定时任务先查 `SELECT DISTINCT session_id FROM gateway_runtime_events`，再对每个 session 单独执行 `DELETE WHERE session_id = ? AND id < (SELECT id FROM gateway_runtime_events WHERE session_id = ? ORDER BY id DESC LIMIT 1 OFFSET 100000)`。
**Warning signs:** 清理任务 log 出现 "You can't specify target table" 错误，或所有 session 合计超 10 万才开始清理。

### Pitfall 3：写库前不做 session 归属校验（防串漏洞）

**What goes wrong:** 直接用 frame 里的 `sessionId` 写 `gateway_chat_messages`，不先验证该 session 属于当前 Gateway 的 account/workspace。
**Why it happens:** 唯一键只负责幂等，不负责权限（设计文档 § 唯一键和幂等）。
**How to avoid:** `POST /api/runtime-sync/gateway/conversation` 和 `gateway/event` 写库前，先查 `gateway_sessions WHERE id = ? AND gateway_id = ? AND account_id = ? AND workspace_id = ?`，校验通过才执行 upsert。
**Warning signs:** 不同 Gateway 的 session 数据串库，或 Relay scope 校验日志出现 mismatch 但仍写入。

### Pitfall 4：Server DB 的 schema 初始化机制

**What goes wrong:** 新 migration 文件没有被 `db.ensureSchema()` 自动加载，表不存在导致 500。
**Why it happens:** `apps/server/app/service/db.ts:ensureSchema()` 当前硬编码了 `sql/001_init.sql` 文件路径；Phase 12 加的 `002_gateway_runtime_sync.sql` 不会自动执行。[VERIFIED: apps/server/app/service/db.ts:31]
**How to avoid:** 修改 `db.ts` 的 `ensureSchema()`，改为顺序读取 `sql/` 目录下所有按数字排序的 `.sql` 文件，或在 `002_...sql` 里加 `IF NOT EXISTS` 防止重复建表，然后在初始化里也加载 002。
**Warning signs:** Server 启动后调用 sync API 报 `Table 'tether.gateway_sessions' doesn't exist`。

### Pitfall 5：Flutter ConversationService 的 fallback 分支

**What goes wrong:** `_refreshConversationSnapshot` 在 catch 分支调用 `relayClient.requestConversation(sessionId)`，这是 Relay WS RPC 路径；Phase 12 后这条路径已废弃。
**Why it happens:** 现有代码 `conversation_service.dart:211-224` 在 `authService.getSessionConversation` 异常时 fallback 到 WS 请求。
**How to avoid:** D-12 / D-11 要求废弃该 fallback；修改后 `_refreshConversationSnapshot` 异常时直接 rethrow 或 log，不再调用 `relayClient.requestConversation`。[VERIFIED: native/flutter/lib/services/conversation_service.dart:210-225]
**Warning signs:** Gateway 离线时 App 仍发出 `client.conversation` WS frame，触发 Relay 报 `gateway_unavailable`。

---

## Code Examples

### 1. SQL Migration：4 张新表
```sql
-- Source: 设计文档 § DB 表 + apps/server/sql/001_init.sql 风格对齐
-- File: apps/server/sql/002_gateway_runtime_sync.sql

CREATE TABLE IF NOT EXISTS gateway_sessions (
  id VARCHAR(128) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  gateway_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  provider VARCHAR(64) NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  project_path VARCHAR(1024) DEFAULT NULL,
  agent_session_id VARCHAR(255) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  transport VARCHAR(64) NOT NULL DEFAULT 'pty-event-stream',
  last_active_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gateway_sessions_account_workspace (account_id, workspace_id),
  KEY idx_gateway_sessions_gateway_id (gateway_id)
);

CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  turn_index INT NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  tools_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_session_turn (session_id, turn_index),
  KEY idx_chat_messages_session_id (session_id)
);

CREATE TABLE IF NOT EXISTS gateway_runtime_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  event_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_runtime_events_session_event (session_id, event_id),
  KEY idx_runtime_events_session_id_id (session_id, id)
);

CREATE TABLE IF NOT EXISTS gateway_sync_cursors (
  id BIGINT NOT NULL AUTO_INCREMENT,
  gateway_id VARCHAR(128) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  last_event_id BIGINT DEFAULT NULL,
  last_turn_index INT DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sync_cursors_gateway_session (gateway_id, session_id)
);
```

### 2. `ensureSchema` 扩展（关键修复）
```typescript
// Source: [VERIFIED: apps/server/app/service/db.ts — 需要修改此方法]
// 修改 db.ts 以加载多个 migration 文件
public async ensureSchema() {
  if (!this.mysqlModeEnabled()) return;
  if (!schemaReady) {
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
  }
  await schemaReady;
}
```

### 3. Relay `syncToServer` 函数
```typescript
// Source: [VERIFIED: 基于 apps/relay/src/main.ts:30 fetch 模式]
// 在 startRelayServer 函数体内定义，捕获 serverSyncUrl / syncSecret

const SERVER_SYNC_URL = process.env.TETHER_SERVER_URL?.replace(/\/+$/, '');
const RUNTIME_SYNC_SECRET = process.env.TETHER_RUNTIME_SYNC_SECRET;

async function syncToServer(endpoint: string, body: unknown): Promise<void> {
  if (!SERVER_SYNC_URL || !RUNTIME_SYNC_SECRET) return;
  try {
    const resp = await fetch(`${SERVER_SYNC_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': RUNTIME_SYNC_SECRET
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

### 4. `gateway.event` 白名单映射
```typescript
// Source: [VERIFIED: 设计文档 § gateway.event 映射]

const RUNTIME_EVENT_WHITELIST = new Set([
  'terminal.output',
  'terminal.input',
  'session.error',
  'session.exited',
  'agent.status'
]);

case 'gateway.event':
  sendEventToSubscribers(frame.event);  // 原有，保持
  if (frame.event.type === 'agent.turn') {
    void syncToServer('/api/runtime-sync/gateway/event', {
      gatewayId: frame.gatewayId,
      event: frame.event,
      scope: gatewayScope
    });
  } else if (RUNTIME_EVENT_WHITELIST.has(frame.event.type)) {
    void syncToServer('/api/runtime-sync/gateway/event', {
      gatewayId: frame.gatewayId,
      event: frame.event,
      scope: gatewayScope
    });
  }
  break;
```

### 5. Flutter ConversationService 修改要点
```dart
// Source: [VERIFIED: native/flutter/lib/services/conversation_service.dart:206-225]
// 修改后：移除 WS fallback

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
    // D-12 / D-11: Server DB miss 返回空数组，不回落 Relay WS
    // 保持当前 _turns 不变（或清空，视 UX 而定）
  }
}
```

注意：`authService.getSessionConversation` 已指向 Server HTTP `GET /api/sessions/:id/conversation`，Phase 12 前该接口尚不存在 → 当前走 catch 再 `requestConversation()`。Phase 12 后 Server 接口建好，catch 分支不再需要 WS fallback。[VERIFIED: native/flutter/lib/services/auth_service.dart:139-145]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/api/sessions/:id/conversation` 通过 Relay → Gateway RPC 拉取 | Server DB 直读 | Phase 12 | 离线可读，多端一致，首屏无需等 Gateway |
| conversation_turns 存 Gateway SQLite | 废弃，改写 Server MySQL gateway_chat_messages | Phase 12 | 数据在 Server，多端共享 |
| Flutter ConversationService fallback 到 Relay WS | 直接调 Server HTTP，不做 WS fallback | Phase 12 | 简化路径，强制依赖 Server DB |

**Deprecated/outdated:**
- `conversation_turns` 表（Gateway SQLite）：Phase 12 完成后删除 DDL 和相关方法。
- Relay `handleHttpApi` 中 `GET /api/sessions/:id/conversation` 的 RPC 转发逻辑：切换完成后可删除（D-11）。

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `db.ts:ensureSchema()` 需要修改以加载多个 SQL 文件 | Pitfall 4 / Code Examples 2 | 若不修改，002 migration 不会自动执行；表不存在导致 500。可替代方案：手动在 002 SQL 文件前加 `-- run manually` 注释，在 app.ts 启动时手动执行。 |
| A2 | egg-schedule `type: 'worker'` 在单 worker 进程部署下每天只运行一次 | Architecture Patterns / Schedule | 若多 worker，每个 worker 都执行一次；但项目 `--workers=1` [VERIFIED: package.json start script]，无风险 |

**除以上两条外，其余关键主张均已通过代码直接验证（VERIFIED 标注）。**

---

## Open Questions (RESOLVED)

1. **`db.ts:ensureSchema()` 修改方案确认**
   - What we know: 当前硬编码 `001_init.sql`；`002_gateway_runtime_sync.sql` 不会自动加载
   - What's unclear: 是否有手动运行 SQL migration 的既有流程（如部署脚本）
   - Recommendation: 修改 `ensureSchema()` 顺序读取所有 `sql/*.sql`，同时保留 `IF NOT EXISTS` 保证幂等
   - RESOLVED: Plan 12-01 Task 2 使用 `readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort()` 动态加载，无手动 migration 流程

2. **nginx 配置文件位置**
   - What we know: 设计文档说明了 nginx 规则；部署目录存在 `deploy/` 下
   - What's unclear: nginx 配置文件确切路径（本次未读取 deploy 目录）
   - Recommendation: 规划时标注"需确认 deploy/ 目录下 nginx 配置文件"
   - RESOLVED: Plan 12-04 Task 3 使用 `deploy/nginx/tether.conf`，executor 需读取该文件确认当前结构

3. **`TETHER_SERVER_URL` 在 Relay 中是否已读取**
   - What we know: `apps/relay/src/main.ts:6` 已读取 `TETHER_SERVER_URL`；`syncToServer` 可直接复用
   - What's unclear: 是否需要在 `startRelayServer` options 中传入（以便测试 mock），还是直接读环境变量
   - Recommendation: 将 `serverSyncUrl` 和 `syncSecret` 作为 `RelayServerOptions` 可选字段，与 `validateToken` 平行，便于测试
   - RESOLVED: Plan 12-03 将 `serverSyncUrl` 和 `syncSecret` 加入 `RelayServerOptions`，测试可 mock

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| MySQL | Server DB 写入 | ✓（生产环境） | — | `mysqlModeEnabled()=false` 时 in-memory 跳过（测试环境） |
| egg-schedule | Server 定时清理 | ✓（egg 内置依赖）| 4.0.1 | — |
| node:fetch | Relay → Server HTTP | ✓（Node.js ≥18）| 内置 | — |
| TETHER_RUNTIME_SYNC_SECRET | Relay sync 鉴权 | ✗（新增环境变量）| — | 缺失时 Relay 跳过所有 sync 调用（仅 warn log）|
| app/schedule/ 目录 | Egg.js 定时任务 | ✗（尚不存在）| — | 需要 Wave 0 创建 |

**Missing dependencies with no fallback:**
- 无阻塞性缺失，所有缺失项均有明确创建路径

**Missing dependencies with fallback:**
- `TETHER_RUNTIME_SYNC_SECRET`：未配置时 sync 静默跳过，数据不落 Server DB；可用 Gateway 重连补偿

---

## Validation Architecture

> `workflow.nyquist_validation` 未在 config.json 中显式设为 false，视为启用。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | egg-bin test（Mocha + supertest）[VERIFIED: apps/server/package.json] |
| Config file | apps/server/package.json `scripts.test` |
| Quick run command | `cd apps/server && pnpm test` |
| Full suite command | `cd apps/server && pnpm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | POST /api/runtime-sync/gateway/sessions 写入并返回 ok | integration | `pnpm test -- --grep "runtime-sync"` | ❌ Wave 0 |
| SYNC-01 | GET /api/sessions 返回 gateway_sessions 数据 | integration | `pnpm test -- --grep "GET /api/sessions"` | ❌ Wave 0 |
| SYNC-01 | GET /api/sessions/:id/conversation 返回 gateway_chat_messages | integration | `pnpm test -- --grep "conversation"` | ❌ Wave 0 |
| SYNC-01 | 无 sync secret header 时返回 401/403 | integration | `pnpm test -- --grep "runtime-sync auth"` | ❌ Wave 0 |
| SYNC-01 | Relay sync 失败不阻塞 frame 转发 | unit | relay.test.ts 新增 case | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `apps/server/test/runtime-sync.test.ts` — SYNC-01 server 端接口覆盖
- [ ] `apps/relay/src/relay.test.ts` 新增 sync 相关 case — SYNC-01 relay 端

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes（内部接口） | `X-Tether-Runtime-Sync-Secret` header + nginx IP allowlist（D-06） |
| V3 Session Management | no | — |
| V4 Access Control | yes | Server 写入前校验 account/workspace/gateway 归属；读接口按 token scope 过滤 |
| V5 Input Validation | yes | frame payload 写库前做 `maskSensitiveOutput` + 长度限制（payload_json MEDIUMTEXT） |
| V6 Cryptography | no | sync secret 是静态 env var，不涉及加密算法 |

### Known Threat Patterns for Egg.js + MySQL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 跨账号 session 串库 | Tampering | 写库前校验 `gateway_sessions.account_id = scope.accountId`（5 层防护第 2 层）|
| terminal.output 敏感信息落库 | Information Disclosure | `maskSensitiveOutput` 必须在写 `payload_json` 前调用（D-09）|
| sync 接口被外部直接调用 | Spoofing | nginx `allow 127.0.0.1; deny all;` + secret header 双层（D-06）|
| SQL 注入 | Tampering | `ctx.service.db.query(sql, params)` 参数化查询（项目既有模式）|
| payload_json 过大 | DoS | 写入前截断（建议 MEDIUMTEXT 上限 + 代码层限制如 64KB per event）|

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: apps/relay/src/relay.ts] — handleGatewayFrame 结构、frame 类型、RelayAuthScope
- [VERIFIED: apps/server/app/router.ts] — 路由注册模式
- [VERIFIED: apps/server/app/controller/auth.ts] — Controller 模式
- [VERIFIED: apps/server/app/service/db.ts] — db.query / ensureSchema / mysqlModeEnabled
- [VERIFIED: apps/server/app/service/gatewayRepository.ts] — ON DUPLICATE KEY UPDATE upsert 模式
- [VERIFIED: apps/server/app/service/auditRepository.ts] — insertAuditEvent 完整 repository 模式
- [VERIFIED: apps/server/app/middleware/require-token-class.ts] — middleware 写法
- [VERIFIED: apps/server/sql/001_init.sql] — SQL 风格（DATETIME, BIGINT PK, UNIQUE KEY）
- [VERIFIED: packages/protocol/src/index.ts] — RelayAuthScope / RelayGatewayToServerFrame 类型
- [VERIFIED: apps/gateway/src/store.ts] — conversation_turns DDL + insertConversationTurn 实现
- [VERIFIED: apps/gateway/src/journal-watcher.ts:208,220] — 两处 insertConversationTurn 调用位置
- [VERIFIED: apps/gateway/src/mask.ts] — maskSensitiveOutput 实现
- [VERIFIED: apps/relay/src/main.ts:30] — Relay 已用 fetch 调 Server
- [VERIFIED: apps/server/package.json] — egg ^3.31.0，egg-mysql，egg-schedule 内置
- [VERIFIED: node_modules/.pnpm/egg-schedule@4.0.1] — egg-schedule 已安装，README 确认 app/schedule/ 约定
- [VERIFIED: native/flutter/lib/services/conversation_service.dart] — 当前 ConversationService 读路径
- [VERIFIED: native/flutter/lib/services/auth_service.dart:139-145] — getSessionConversation 已指向 Server HTTP

### Secondary (MEDIUM confidence)
- [CITED: docs/working/2026-05-09-server-db-runtime-sync.md] — 设计文档（表 schema、安全模型、落地顺序）
- [CITED: .planning/phases/12-server-db-runtime-sync/12-CONTEXT.md] — 锁定决策 D-01 ~ D-12

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — 全部从项目代码和 node_modules 直接验证
- Architecture: HIGH — 基于现有代码结构直接推导
- Pitfalls: HIGH — Pitfall 1/2/4/5 均有具体代码行号支撑；Pitfall 3 来自设计文档权威定义
- SQL Schema: HIGH — 字段来自设计文档，主键/索引风格对齐 001_init.sql

**Research date:** 2026-05-09
**Valid until:** 2026-06-09（Egg.js / egg-schedule 版本稳定，30 天内有效）
