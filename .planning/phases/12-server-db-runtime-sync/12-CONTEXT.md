# Phase 12: Server DB Runtime Sync - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

把 Web/App 的会话读取路径从「Relay → Gateway 反向 RPC」切换到「Server DB 直读」。Relay 负责把
Gateway 上报的 `gateway.sessions` / `gateway.conversation` / `gateway.event` frame 同步持久化到
Server MySQL，实现 Gateway 离线时历史仍可读、多端数据一致。

Server DB 新增 4 张表：`gateway_sessions` / `gateway_chat_messages` / `gateway_runtime_events` /
`gateway_sync_cursors`。

**不做的事：**
- 不改 `POST /api/sessions/:id/input` 和 `POST /api/sessions/:id/stop`（继续走 Relay → Gateway RPC）
- 不做 `gateway_runtime_events` 完整 Terminal Tab 回放（只写受限白名单事件）
- 不做 Phase 7 Retention 的 Gateway SQLite 清理（两套 retention 策略独立）
- 不做 multi-device 同步新增推送（已有 Relay WS 推送继续用）

</domain>

<decisions>
## Implementation Decisions

### Phase 11 conversation_turns 去留

- **D-01:** `conversation_turns`（Gateway SQLite）在 Phase 12 完成后废弃。Phase 12 内同时：删除
  `conversation_turns` 表定义（migration 层），移除 JournalWatcher 写入 `conversation_turns` 的代码。
- **D-02:** JournalWatcher 的触发路径不动。JournalWatcher 继续产生 `agent.turn` 事件（`gateway.event`
  子类型），Relay 收到 `agent.turn` 时在现有转发逻辑基础上追加同步 Server DB（`gateway_chat_messages`）。
- **D-03:** `GET /api/sessions/:id/conversation` 一步切到读 Server DB，不做双读 fallback（不再经
  Relay RPC 到 Gateway SQLite）。Server DB 不命中时返回空数组，不回落 Relay。

### Relay → Server 同步失败降级

- **D-04:** Relay 调 Server sync API 失败（超时、503）时静默跳过 + 记日志，不阻塞当前 frame 的
  实时转发。靠 Gateway 重连后 snapshot 补偿（`gateway_sync_cursors` cursor 补洞）。
- **D-05:** 实时转发（推送给已连 Client WS）和 Server sync 并行执行，互不阻塞。sync 失败不影响
  Client 的实时消息接收。
- **D-06:** Server runtime sync 接口内部认证使用 `TETHER_RUNTIME_SYNC_SECRET` header（静态环境变量）。
  生产上 nginx 额外限制 `/api/runtime-sync/` 只允许 127.0.0.1 访问。

### terminal.output 保留策略

- **D-07:** `gateway_runtime_events` 每个 session 保留最新 **10 万条**（所有白名单事件类型合计），
  超过时删最旧行。同时删除超过 **1 个月**的旧行。两个条件独立清理。
- **D-08:** 清理任务使用 Egg.js `app/schedule/` 定时任务，每天执行一次（Phase 12 首建该目录）。
- **D-09:** `terminal.input` 写入 `gateway_runtime_events`，但必须先经过 `maskSensitiveOutput` 过滤。

### 读接口分流实现

- **D-10:** 读写分流在 nginx 层显式按路径拆分：
  - `GET /api/sessions` → Server（读 `gateway_sessions`）
  - `GET /api/sessions/:id/conversation` → Server（读 `gateway_chat_messages`）
  - Terminal 历史读取接口 → Server（读 `gateway_runtime_events`）
  - `POST /api/sessions/:id/input` → Relay（保持反向 RPC）
  - `POST /api/sessions/:id/stop` → Relay（保持反向 RPC）
- **D-11:** Phase 12 完成后不保留 Relay HTTP RPC 作为读路径 fallback。Relay 的 `handleHttpApi`
  中 `GET /api/sessions/:id/conversation` 处理逻辑在切换完成后可删除。
- **D-12:** Flutter App 的 `ConversationService` 改为调用 Server HTTP 接口（`GET /api/sessions/:id/conversation`），
  不再通过 Relay WS 弹 `client.conversation` 请求。与 Web 使用同一读路径。

### Claude's Discretion

- Relay 向 Server sync API 发起 HTTP 请求的具体客户端实现（fetch / node:http / 复用已有 httpRequest 工具）
- `gateway_sync_cursors` 更新的事务粒度（每条事件后更新 vs 批量更新）
- `app/schedule/` 定时任务的具体时间窗口（凌晨低峰时段）
- Server `gateway_runtime_events` 的查询接口分页大小默认值

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 设计文档（首要参考）
- `docs/working/2026-05-09-server-db-runtime-sync.md` — 完整设计文档：4 张表 schema、frame 到 DB
  的映射规则、写入时机、安全防串设计（5 层防护）、防串数据设计、HTTP API、nginx 路由、兜底策略、
  重连补偿、落地顺序（13 步）、验收清单。**此文档是 schema 和安全边界的权威定义，规划前必读。**

### Relay（同步写入方）
- `apps/relay/src/relay.ts` — Relay frame 处理逻辑。`handleGatewayFrame`（line 176）已处理
  `gateway.sessions` / `gateway.conversation` / `gateway.event` 三种 frame，Phase 12 在各 case
  追加 Server sync 调用。`RelayAuthScope` 是写库时的权限来源。

### Gateway（数据产生方）
- `apps/gateway/src/session-runner.ts` — JournalWatcher 生命周期；Phase 12 内移除其写 `conversation_turns` 逻辑。
- `apps/gateway/src/store.ts` — Gateway SQLite schema（`conversation_turns` 表 Phase 12 内废弃）；
  `maskSensitiveOutput` 引用位置。
- `apps/gateway/src/mask.ts` — `maskSensitiveOutput` 实现，terminal.input/output 落 Server DB 前必须调用。

### Server（落库方）
- `apps/server/sql/001_init.sql` — Server MySQL 基础 schema（accounts / workspaces 等），Phase 12
  在同目录追加新 migration 文件（002 或对应编号），新增 4 张表。
- `apps/server/app/` — Egg.js 应用结构（controller / service / router / schedule）。Phase 12 在
  此添加 runtime-sync controller、service、route，以及 `app/schedule/` 定时清理任务。

### Protocol
- `packages/protocol/src/index.ts` — `RelayGatewayToServerFrame` / `RelayServerToGatewayFrame` 类型定义。
  `gateway.sessions` / `gateway.conversation` / `gateway.event` 的 payload 结构从这里读。

### Flutter App（读路径变更）
- `native/flutter/lib/services/conversation_service.dart` — Phase 12 内改为调 Server HTTP 接口。

### Phase 11 CONTEXT（先验决策）
- `.planning/phases/11-agent/11-CONTEXT.md` — Phase 11 的协议层和 JournalWatcher 决策，Phase 12
  沿用 `agent.turn` 事件结构，但废弃其 `conversation_turns` SQLite 写入。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/relay/src/relay.ts:handleGatewayFrame` — 已有 `gateway.sessions` / `gateway.conversation` /
  `gateway.event` 三个 case，Phase 12 在每个 case 内部追加 `void syncToServer(frame, gatewayScope)`
  调用，不需要新建处理路径。
- `apps/gateway/src/mask.ts:maskSensitiveOutput` — 直接复用，terminal.input 和 terminal.output 写
  `gateway_runtime_events` 前必须调用。
- `RelayAuthScope`（`packages/protocol/src/index.ts`）— 含 `accountId / workspaceId / gatewayId`，
  是 Relay 向 Server 同步时的权限 scope，写库前校验的依据。

### Established Patterns
- **Server 是唯一 DB writer：** 只有 Server 写 MySQL，Relay 调 Server sync API，Gateway 不直连 MySQL。
- **幂等 upsert：** `gateway_sessions` (PRIMARY KEY id)、`gateway_chat_messages` (UNIQUE session_id, turn_index)、
  `gateway_runtime_events` (UNIQUE session_id, event_id)、`gateway_sync_cursors` (UNIQUE gateway_id, session_id)。
  重复收到同一 frame 不产生重复行。
- **写入前归属校验（防串）：** 写库前先查 `gateway_sessions` 验 account/workspace/gateway 归属，
  和 RelayAuthScope 对比，不一致拒绝写入。
- **Egg.js 约定式路由：** Server 已有 `app/router.ts`，新 runtime-sync 路由在此注册；controller /
  service 遵循 Egg.js 文件约定。

### Integration Points
- Relay `handleGatewayFrame` → 追加 Server HTTP sync（异步，不阻塞转发）
- Server `POST /api/runtime-sync/gateway/sessions|conversation|event` → 新建 Egg.js controller + service
- Server `GET /api/sessions` → 新建接口（读 `gateway_sessions`）
- Server `GET /api/sessions/:id/conversation` → 新建接口（读 `gateway_chat_messages`）
- Server `GET /api/sessions/:id/events` → 新建接口（读 `gateway_runtime_events`，Terminal 历史）
- Server `app/schedule/` → 新建定时任务（清理超限 + 超龄 runtime events）
- nginx → 按路径把读接口路由到 Server、控制接口路由到 Relay
- Flutter ConversationService → 改为调 Server HTTP `GET /api/sessions/:id/conversation`
- Gateway `store.ts` → 废弃 `conversation_turns` 表（drop migration）
- Gateway `session-runner.ts` → 移除 JournalWatcher 写 `conversation_turns` 逻辑

</code_context>

<specifics>
## Specific Ideas

- Server DB 4 张表的完整字段定义、唯一键、索引设计详见 `docs/working/2026-05-09-server-db-runtime-sync.md` § DB 表。
- nginx 路由按 method + path 拆分示例详见设计文档 § nginx 路由影响。
- 防串校验完整逻辑（写入侧 + 读取侧）详见设计文档 § 防串数据设计。
- 白名单事件类型（`terminal.output` / `terminal.input` / `session.error` / `session.exited` / `agent.status`）
  详见设计文档 § gateway.event 映射。
- `gateway_runtime_events` 的 `payload_json` 字段存储时需完成 mask + 长度限制。

</specifics>

<deferred>
## Deferred Ideas

- Relay RPC 读路径（`gateway.conversation` 从 Gateway 拉）作为 fallback：用户决定 Phase 12 完成后
  不保留，Server DB miss 直接返回空，不回落 Gateway。
- 不同 Gateway 产生相同 session id 的多主场景：当前 session id 全局唯一，Phase 12 先以 `session_id`
  为主键边界。如果未来允许多主，需把 `gateway_id` 纳入 `gateway_chat_messages` / `gateway_runtime_events` 唯一键。
- Chat 内容团队共享权限（audit + 保留策略）：Phase 12 按 account/workspace 隔离读取，共享场景 deferred。

</deferred>

---

*Phase: 12-server-db-runtime-sync*
*Context gathered: 2026-05-09*
