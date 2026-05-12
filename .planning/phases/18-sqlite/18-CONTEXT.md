# Phase 18: 去掉本地 SQLite - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

从 Gateway 里完全移除本地 SQLite（`~/.tether/tether.db`）。

具体交付：
1. PTY 事件写入不再走 SQLite，只走 relay → MySQL（已有路径）
2. Session 元数据（路由查找）从 SQLite sessions 表改为 PtySessionManager 内存 Map
3. Gateway 重连 relay 后，relay 推 `gateway.sessions-restore` 帧恢复 session 列表
4. PTY session 创建从 `POST /api/sessions` HTTP 改为 `client.new-pty-session` WS 帧
5. 删掉 `store.ts`、`better-sqlite3` 依赖、所有 Store 调用残留

**明确不在本阶段：**
- 事件回放接口（relay/server 层新增 MySQL 查询接口）— 已知后续工作，本阶段不做
- 快照接口 `/api/sessions/:id/snapshot` 改查 MySQL — 同上
- 用户磁盘上的 `~/.tether/tether.db` 文件删除 — 静默忽略，用户自行处理
- `tether attach` 命令保留但改为走 gateway HTTP 查 session（不读 SQLite）

</domain>

<decisions>
## Implementation Decisions

### Event ID 生成

- **D-01:** PTY 事件 ID 对齐 chat，使用 timestamp-based 方案：`(Date.now() * 1000) + sequence % 1000`，不依赖 SQLite auto-increment。
- **D-02:** 提取公共 `createSessionEvent(sessionId, type, payload)` 工具函数到 `packages/protocol` 或 gateway 内公共模块，chat 和 PTY 共用，不各自维护独立实现。

### CLI 删除边界

- **D-03:** `tether run` / `tether claude` / `tether codex` 等创建 PTY session 的命令改为连 relay 发 `client.new-pty-session` WS 帧，不再调 gateway HTTP `POST /api/sessions`。
- **D-04:** `tether attach` 命令删除（web UI 已覆盖终端 attach 功能）。`tether codex --attach` 等命令同步移除 `--attach` 参数支持。
- **D-05:** `tether ls` 的 SQLite fallback（`store.listSessions()`）删掉；如 gateway HTTP 不可达则报错退出，不降级读本地文件。

### 分 plan 策略

- **D-06:** [informational] 3 个 plan，顺序执行：
  - **Plan 1**：① 删 PTY 事件写入（appendEvent）+ ② session 元数据改内存 Map（PtySessionManager）
  - **Plan 2**：③ relay 加 `gateway.sessions-restore` 推送 + ④ PTY 创建改 `client.new-pty-session` WS 帧 + CLI 命令改 WS
  - **Plan 3**：⑤ 删 `store.ts`、`better-sqlite3`、所有残留引用，清理 `apps/cli` 中 Store 使用

### 已有数据迁移

- **D-07:** [informational] 本地 SQLite 历史数据忽略，不迁移。MySQL 已有完整远端历史，本地 SQLite 是冗余缓存。
- **D-08:** [informational] Gateway 启动时检测到旧 `tether.db` 文件时静默忽略，不打 log，不提示用户。

### 删除验收标准

- **D-09:** Plan 3 验收：`grep -r "better-sqlite3\|DatabaseSync\|store\.ts\|new Store()" apps/gateway apps/cli` 无命中；typecheck 全通过。
- **D-10:** [informational] 用户磁盘上的 `~/.tether/tether.db` 文件不在 Plan 3 范围内，代码层清除即可。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 设计文档（主要参考）
- `docs/working/2026-05-12-remove-local-sqlite.md` — 完整迁移计划：背景、5 个 TODO 阶段、每阶段验收标准。**MUST read first.**

### 现有 Gateway 代码（改动目标）
- `apps/gateway/src/store.ts` — 现有 Store 类，最终删除目标；包含 sessions 表和 session_events 表的所有操作
- `apps/gateway/src/pty.ts` — `PtySessionManager`：`store.insertSession` / `store.appendEvent` 调用全部删除；内存 Map 升级为公开的 session 注册表
- `apps/gateway/src/session-runner.ts` — 所有 `store.appendEvent` / `store.insertSession` / `store.updateSessionStatus` 调用删除
- `apps/gateway/src/relay-client.ts` — `getStoredSession` / `listRelaySessions` 改为调 PtySessionManager；`markSessionLost` 改为内存操作；新增 `case 'gateway.sessions-restore'` 处理

### 现有 CLI 代码（改动目标）
- `apps/cli/src/main.ts` — `tether run/claude/codex` 改 WS 创建；`tether attach` 删除；`tether ls` SQLite fallback 删除；`new Store()` 所有调用清理

### 协议类型（需新增帧）
- `packages/protocol/src/index.ts` — 需新增：`client.new-pty-session`（WS 创建 PTY）、`gateway.sessions-restore`（relay 推送历史 sessions）帧类型

### Relay 代码（需改动）
- `apps/relay/src/relay.ts` — gateway auth 成功后查 MySQL gateway_sessions，推 `gateway.sessions-restore` 帧给 gateway

### 项目规范
- `CLAUDE.md` — Relay 多租户隔离规范（R1-R4）；`gateway.sessions-restore` 推送必须只推该 gatewayId 的 sessions，不得跨账号

### Chat 参考（Event ID 模式）
- `apps/gateway/src/chat-session-runner.ts` — `createChatEvent` 函数（timestamp-based ID 实现参考，L93-107）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PtySessionManager.sessions`（`apps/gateway/src/pty.ts`）— 内存 Map 已存在，只需加 `getSession(id)` 和 `listSessions()` 公开方法
- `createChatEvent`（`apps/gateway/src/chat-session-runner.ts:93`）— timestamp-based ID 生成模式，PTY 的 `createSessionEvent` 直接复用此逻辑
- `broadcastGatewayUnavailableForScope`（`apps/relay/src/relay.ts`）— 现有按 gatewayId/accountId 过滤推送的模式，`gateway.sessions-restore` 推送参考此模式
- `validateAccessToken` fetch 模式（`apps/gateway/src/daemon.ts:1316`）— gateway 调 server HTTP 的现有写法，`sessions-restore` 如果改为 HTTP 可复用

### Established Patterns
- relay ↔ gateway WS 帧的新增模式：protocol 加类型，relay case 处理转发/推送，gateway relay-client.ts case 处理接收（参考 `gateway.sessions`、`client.chat` 的完整链路）
- `publishEvent` 模式（`pty.ts`）：事件构造后调 `publish` 广播给所有 listeners，不写 SQLite。Plan 1 要把所有 `store.appendEvent()` 换成这个模式

### Integration Points
- `apps/relay/src/relay.ts` — gateway auth 成功处（`case 'gateway.auth'` handler），在这里新增查 MySQL + 推 `gateway.sessions-restore`
- `apps/gateway/src/relay-client.ts` — `handleMessage` switch，新增 `case 'gateway.sessions-restore'`
- `apps/gateway/src/daemon.ts` — `POST /api/sessions` 接口删除；gateway HTTP 层只保留 `GET /api/sessions` 等查询接口

</code_context>

<specifics>
## Specific Ideas

### Plan 1 核心改动模式
`store.appendEvent(sessionId, type, payload)` 替换为：
1. 构造 event 对象（用新的 `createSessionEvent`，timestamp-based ID）
2. 直接调 `publish(event)` 广播给本地订阅者
3. 调 `send(gateway.event)` 推给 relay

不再有 SQLite 写入。

### gateway.sessions-restore 帧设计
```typescript
{ type: 'gateway.sessions-restore', gatewayId: string, sessions: RelaySession[] }
```
relay 在 `gateway.auth` 成功后：查 MySQL `gateway_sessions WHERE gateway_id = ? AND status IN ('running', 'lost')`，推这一帧。Gateway 收到后 load 进 PtySessionManager 内存 Map，按 PID 检查存活性（存活保留，进程不存在标记 lost）。

### client.new-pty-session 帧设计
```typescript
{ type: 'client.new-pty-session', clientId: string, provider: string, command: string, cwd: string, cols: number, rows: number, gatewayId: string }
```
relay 转发给对应 gateway；gateway 调 `ptySessions.create()` 创建，成功后发 `gateway.session-created` 帧。

</specifics>

<deferred>
## Deferred Ideas

- **事件回放改 MySQL**：`GET /api/sessions/:id/events` 和 relay 的 `replayEvents` 改查 MySQL — 后续阶段，本阶段标记为待做
- **快照接口改 MySQL**：`GET /api/sessions/:id/snapshot` — 同上，后续处理
- **tether attach 替代方案**：如果未来需要 CLI attach，改为连 relay WS 发 `client.subscribe` — 暂不做

</deferred>

---

*Phase: 18-去掉本地 SQLite*
*Context gathered: 2026-05-12*
