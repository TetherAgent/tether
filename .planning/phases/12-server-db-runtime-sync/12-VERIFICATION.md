---
phase: 12-server-db-runtime-sync
verified: 2026-05-09T14:00:00Z
status: human_needed
score: 8/8
overrides_applied: 0
human_verification:
  - test: "连接真实 MySQL，验证 4 张新表存在且结构正确，并执行一次 Relay → Server 的 sync 写入，再从 GET /api/sessions/:id/conversation 读回数据"
    expected: "数据写入 gateway_chat_messages，再经 GET 接口以 JSON 返回，数据一致"
    why_human: "需要运行中的 MySQL + Relay + Server 环境，无法通过静态代码检查验证端到端 HTTP 链路"
  - test: "验证 POST /api/sessions/:id/input 和 /stop 仍能通过 Relay 到达 Gateway（不被 nginx 或 Server 拦截）"
    expected: "指令正常转发给 Gateway，终端收到输入"
    why_human: "需要完整运行时环境（nginx + Relay + Gateway）"
  - test: "验证 GET /api/runtime-sync/ 在非 127.0.0.1 来源时被 nginx deny all 拒绝"
    expected: "外部 IP 发起请求，nginx 返回 403 Forbidden"
    why_human: "需要运行中的 nginx 实例，无法用静态文件检查验证 allow/deny 执行效果"
  - test: "验证 cleanup-runtime-events.ts 定时任务在 Egg.js 启动后能被 egg-schedule 正确加载执行"
    expected: "Server 日志中出现 [cleanup] 相关日志（或通过 egg-schedule 管理接口确认注册）"
    why_human: "Egg.js schedule 加载需要运行时确认，静态代码只能验证文件结构"
---

# Phase 12: Server DB Runtime Sync 验证报告

**Phase Goal:** Relay 同步 Gateway session frame 到 Server MySQL；Web 和 Flutter App 从 Server DB 读取 session/conversation/events，不再依赖 Gateway RPC
**验证时间:** 2026-05-09T14:00:00Z
**状态:** human_needed
**Re-verification:** No — 初始验证

## 目标达成情况

### 可观测真相

| # | 真相 | 状态 | 证据 |
|---|------|------|------|
| 1 | gateway_sessions / gateway_chat_messages / gateway_runtime_events / gateway_sync_cursors 四张表的 DDL 存在于 SQL migration 文件 | VERIFIED | `002_gateway_runtime_sync.sql` 包含 4 条 `CREATE TABLE IF NOT EXISTS`，覆盖全部 4 张表，含幂等约束 |
| 2 | POST /api/runtime-sync/gateway/sessions|conversation|event 接口存在，由 secret header middleware 保护 | VERIFIED | `runtime-sync.ts` 有 3 个 async 方法；`router.ts` 第 33-35 行注册路由并绑定 `requireRuntimeSyncSecret`；middleware 检查 `x-tether-runtime-sync-secret` 并在不匹配时 throw 403 |
| 3 | Relay 对 gateway.sessions/conversation/event frame 调用 `void syncToServer`（不 await，3s 超时，失败只 warn） | VERIFIED | `relay.ts` 有 3 处 `void syncToServer`（第 220、231、243 行），函数内含 `AbortSignal.timeout(3000)` 和 catch warn；无 `await syncToServer` 调用；`TETHER_RUNTIME_SYNC_SECRET` 未设置时立即 return |
| 4 | GET /api/sessions、/api/sessions/:id/conversation、/api/sessions/:id/events 接口存在，由 JWT 鉴权保护 | VERIFIED | `session.ts` controller 有 3 个方法；`router.ts` 第 37-39 行注册并绑定 `requireNormalAccess`；`sessionRepository.ts` 含 `listSessions`/`getConversation`/`listEvents` 三个查询方法 |
| 5 | nginx GET /api/sessions* 路由到 Server (4800)，POST 路由到 Relay (4889)；/api/runtime-sync/ 限制 127.0.0.1 | VERIFIED | `tether.conf` 第 18-21 行：`location /api/runtime-sync/` + `allow 127.0.0.1; deny all`；第 29-40 行：`location ~ ^/api/sessions(/|$)` 用变量分流，GET→4800，POST→4889；两个块位于 `/api/` 通用块之前（第 42 行），匹配优先级正确 |
| 6 | 清理定时任务存在，每日凌晨 3 点，删除超 1 个月的旧行和超 10 万条的 session 旧行 | VERIFIED | `cleanup-runtime-events.ts`：`type: 'worker'`，`cron: '0 0 3 * * *'`；两步 DELETE 逻辑，含 `DATE_SUB(NOW(), INTERVAL 1 MONTH)` 和按 session 分批删除；MySQL 未启用时立即 return |
| 7 | Flutter ConversationService 改为只走 Server HTTP，不再 fallback 到 Relay WS | VERIFIED | `conversation_service.dart` 中 `requestConversation` 调用次数为 0；`_refreshConversationSnapshot` catch 分支改为空注释；`getSessionConversation` 保留在 try 分支，指向 Server GET /api/sessions/:id/conversation |
| 8 | 测试文件存在：runtime-sync 写路径 stub + session 读路径 stub + relay syncToServer 非阻塞 case | VERIFIED | `runtime-sync.test.ts` (79 行，3 个 stub case)；`session-read.test.ts` (58 行，3 个 stub case)；`relay.test.ts` 第 1022 行含 `syncToServer failure does not block frame forwarding` test case |

**得分:** 8/8 真相通过验证

### 必要制品

| 制品 | 说明 | 状态 | 备注 |
|------|------|------|------|
| `apps/server/sql/002_gateway_runtime_sync.sql` | 4 张新表 DDL | VERIFIED | 4 张表均含 IF NOT EXISTS 和幂等 UNIQUE KEY |
| `apps/server/app/service/db.ts` | 动态加载所有 sql/*.sql | VERIFIED | 使用 `readdirSync + .filter + .sort`，无硬编码路径 |
| `apps/server/app/controller/runtime-sync.ts` | 3 个 sync 写接口 controller | VERIFIED | sessions/conversation/event 三个 public async 方法 |
| `apps/server/app/service/runtimeSyncRepository.ts` | 4 个幂等 upsert 方法 | VERIFIED | upsertGatewaySession/upsertChatMessage/upsertRuntimeEvent/upsertSyncCursor；含防串校验和 MASK_PATTERNS |
| `apps/server/app/middleware/require-runtime-sync-secret.ts` | secret header 校验 middleware | VERIFIED | 检查 `x-tether-runtime-sync-secret`，不匹配返回 403 |
| `apps/server/app/controller/session.ts` | 3 个读接口 controller | VERIFIED | list/conversation/events，从 `ctx.state.auth` 取 userId scope |
| `apps/server/app/service/sessionRepository.ts` | 3 个查询方法 | VERIFIED | listSessions/getConversation/listEvents；含读侧防串校验（sessionWithinScope）和 mysqlModeEnabled() 返回空数组 |
| `apps/server/app/schedule/cleanup-runtime-events.ts` | 每日定时清理任务 | VERIFIED | 继承 Egg.js Subscription，type:worker，cron:凌晨3点 |
| `apps/server/app/router.ts` | 路由注册 | VERIFIED | runtime-sync 3条 POST + session 3条 GET 均已注册 |
| `apps/server/config/config.default.ts` | verifyLoginWhitelist + runtimeSyncSecret | VERIFIED | 3 条 /api/runtime-sync/ 路径入白名单；TETHER_RUNTIME_SYNC_SECRET 环境变量绑定 |
| `deploy/nginx/tether.conf` | nginx 读写分流 + IP allowlist | VERIFIED | /api/runtime-sync/ 限 127.0.0.1；/api/sessions GET→4800 POST→4889 |
| `apps/relay/src/relay.ts` | syncToServer 函数 + void 调用 | VERIFIED | 3 处 void 调用，AbortSignal.timeout(3000)，无 await |
| `apps/relay/src/main.ts` | TETHER_RUNTIME_SYNC_SECRET 读取 | VERIFIED | 第 7 行读取，第 29-30 行传入 startRelayServer |
| `native/flutter/lib/services/conversation_service.dart` | 移除 WS fallback | VERIFIED | requestConversation 调用次数为 0 |
| `native/flutter/lib/services/auth_service.dart` | getSessionConversation 指向 Server | VERIFIED | GET /api/sessions/:id/conversation 通过 dio 请求 Server URL |

### 关键链路验证

| From | To | Via | 状态 | 详情 |
|------|-----|-----|------|------|
| `relay.ts handleGatewayFrame` | Server `/api/runtime-sync/gateway/*` | `void syncToServer()` 内部 fetch POST | WIRED | 3 个 case 各有 void 调用，无 await；secret header 正确设置 |
| `apps/server/app/router.ts` | `runtime-sync.ts` controller | `router.post + requireRuntimeSyncSecret` | WIRED | 第 33-35 行路由注册含 middleware |
| `apps/server/app/router.ts` | `session.ts` controller | `router.get + requireNormalAccess` | WIRED | 第 37-39 行路由注册含 JWT middleware |
| `sessionRepository.ts` | `gateway_sessions / gateway_chat_messages / gateway_runtime_events` | `ctx.service.db.query SELECT` | WIRED | `listSessions` 查 gateway_sessions，`getConversation` 查 gateway_chat_messages，`listEvents` 查 gateway_runtime_events |
| `deploy/nginx/tether.conf` | Server :4800 | `location ~ ^/api/sessions` GET → 4800 | WIRED | `if ($request_method ~ GET|HEAD) set $sessions_upstream http://127.0.0.1:4800` |
| `conversation_service.dart` | Server GET /api/sessions/:id/conversation | `authService.getSessionConversation` | WIRED | auth_service.dart 第 140-145 行，dio 指向 Server URL |

### 数据流追踪（Level 4）

| 制品 | 数据变量 | 数据来源 | 真实数据 | 状态 |
|------|----------|----------|----------|------|
| `session.ts` `list()` | `sessions` | `sessionRepository.listSessions(accountId, workspaceId, userId)` | SELECT * FROM gateway_sessions WHERE account_id=? AND workspace_id=? AND user_id=? | FLOWING |
| `session.ts` `conversation()` | `turns` | `sessionRepository.getConversation(id, accountId, workspaceId, userId)` | SELECT * FROM gateway_chat_messages WHERE session_id=? ORDER BY turn_index ASC | FLOWING |
| `session.ts` `events()` | `events` | `sessionRepository.listEvents(id, ...)` | SELECT * FROM gateway_runtime_events WHERE session_id=? ORDER BY id DESC LIMIT ? | FLOWING |
| `conversation_service.dart` | `_turns` | `authService.getSessionConversation` HTTP GET | 从 Server DB `gateway_chat_messages` 读取，写入由 Relay sync 保证 | FLOWING |

### 行为抽查

| 行为 | 命令 | 结果 | 状态 |
|------|------|------|------|
| TypeScript 编译通过 | `pnpm --filter @tether/server build` | 无错误输出 | PASS |
| 4 张表 DDL 存在 | `grep -c "CREATE TABLE IF NOT EXISTS" 002_gateway_runtime_sync.sql` | 4 | PASS |
| relay.ts 有 3 处 void 调用 | `grep -c "void syncToServer" relay.ts` | 3 | PASS |
| 无 await syncToServer | `grep "await syncToServer" relay.ts` | 空（无输出） | PASS |
| Flutter 无 requestConversation | `grep -c "requestConversation" conversation_service.dart` | 0 | PASS |
| Server router 无 input/stop | `grep -c "sessions.*input\|sessions.*stop" router.ts` | 0 | PASS |
| relay.ts 保留 input/stop 处理 | `grep "sessions.*input\|sessions.*stop" relay.ts` | 第 332-335 行存在 | PASS |

### 需求覆盖率

| 需求 ID | 来源 PLAN | 描述 | 状态 | 证据 |
|---------|-----------|------|------|------|
| SYNC-01 (SC1) | 12-04 | GET /api/sessions/:id/conversation 不再 404，从 gateway_chat_messages 读 | SATISFIED | sessionRepository.getConversation + router.ts 注册 |
| SYNC-01 (SC2) | 12-04 | GET /api/sessions 从 gateway_sessions 读 | SATISFIED | sessionRepository.listSessions + router.ts 注册 |
| SYNC-01 (SC3) | 12-02/03 | 多端同源（写入幂等 upsert，读走 Server DB） | SATISFIED | ON DUPLICATE KEY UPDATE + syncToServer |
| SYNC-01 (SC4) | 12-04 | Gateway 离线时历史仍可读 | SATISFIED | Server DB 独立于 Gateway；sessionRepository 在 DB miss 时返回空数组 |
| SYNC-01 (SC5) | 12-07 | POST input/stop 仍走 Relay → Gateway | SATISFIED | Server router 无 input/stop；relay.ts matchHttpRoute 保留 |
| SYNC-01 (SC6) | 12-02 | 重复 gateway.conversation 不重复插入 | SATISFIED | UNIQUE KEY uq_chat_messages_session_turn + ON DUPLICATE KEY UPDATE |
| SYNC-01 (SC7) | 12-02/05 | terminal.output 入 gateway_runtime_events，含掩码、限量、保留策略 | SATISFIED | RUNTIME_EVENT_WHITELIST 含 terminal.output；maskPayload 4 条正则；cleanup schedule 两步清理 |
| SYNC-01 (SC8) | 12-02/04 | 不同 account/workspace 不能串读写 | SATISFIED | 写接口：sessionWithinScope(gateway_id+account_id+workspace_id)；读接口：sessionWithinScope(account_id+workspace_id+user_id) |

### 发现的反模式

| 文件 | 行号 | 模式 | 严重性 | 影响 |
|------|------|------|--------|------|
| `apps/server/test/session-read.test.ts` | 17-20 | stub 测试类型定义声明 `listSessions` 接受 2 个参数，但实际实现接受 3 个（+userId）；通过可选链调用所以测试不会失败，但签名不匹配 | INFO（非阻塞） | 测试不能捕获签名变更带来的 bug，但不影响功能实现 |

没有发现 BLOCKER 级别反模式。

### 需要人工验证的项目

#### 1. 端到端写入-读取链路验证

**测试:** 启动 nginx + Relay + Server + MySQL，注册账号并连接一个 Gateway session；等待 Relay 向 Server 同步几条 conversation/event 数据；然后用同一个 token 调用 `GET /api/sessions/:id/conversation`
**预期:** HTTP 200 返回 `{"data":{"turns":[...]}}` 包含真实对话内容，`GET /api/sessions` 返回 session 列表
**无法自动化原因:** 需要完整运行时（MySQL + 多个进程），无法在静态代码检查中执行

#### 2. POST input/stop 写接口仍正常路由到 Gateway

**测试:** 打开一个 session，发送 `POST /api/sessions/:id/input`（body: `{"data":"ls\n"}`）
**预期:** 命令送达 Gateway，终端输出 ls 结果；POST 不被 Server 的 router.ts 拦截
**无法自动化原因:** 需要 Gateway 在线，nginx 分流规则的实际执行效果无法静态验证

#### 3. nginx /api/runtime-sync/ IP allowlist 生效验证

**测试:** 从非 127.0.0.1 IP 向 `POST /api/runtime-sync/gateway/sessions` 发送请求（带正确 secret header）
**预期:** nginx 返回 403 Forbidden，请求不到达 Server
**无法自动化原因:** 需要 nginx 运行实例

#### 4. Egg.js 定时任务加载确认

**测试:** 启动 Server（`pnpm --filter @tether/server start`），查看日志中是否有 egg-schedule 加载 `cleanup-runtime-events` 的记录
**预期:** 日志中出现 `[egg-schedule]` 注册该任务的信息
**无法自动化原因:** Egg.js schedule 的加载是运行时行为

---

## 差距摘要

**无 BLOCKER 级别差距。** 所有 8 个可观测真相均通过代码级验证。

**唯一的待决项是 4 个需要人工在完整运行时环境中验证的行为项（端到端链路、POST 写接口路由、nginx allowlist 生效、定时任务加载）。** 这些项无法通过静态代码检查确认，但代码实现本身是正确的。

---

_Verified: 2026-05-09T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
