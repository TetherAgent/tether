# 去掉本地 SQLite 计划

## 背景

Gateway 目前用本地 SQLite 存两张表：

- `sessions`：PTY session 元数据（PID、状态、路由查找）
- `session_events`：PTY 事件历史（terminal.output、session.exited 等）

Chat session 已经完全不写本地 SQLite，事件全走 relay → MySQL。
目标是让 PTY 也走同样的路径，最终删掉本地 SQLite。

---

## 结论

### Chat 现状
Chat 从未调用任何 `store.*` 方法，无需改动。

### PTY 改造路径

| 块 | 现状 | 目标 |
|---|---|---|
| session 元数据 | SQLite `sessions` 表 | `PtySessionManager` 内存 Map |
| 事件写入 | SQLite `session_events` + relay → MySQL | 只走 relay → MySQL |
| 事件回放 | 读本地 SQLite | 查 MySQL |
| 快照 transcript | 读本地 SQLite | 查 MySQL |
| agent.select | 写 SQLite 再读回 | 内存构造，直接 send |
| 启动恢复 | 读本地 SQLite | relay 认证后推 `gateway.sessions-restore` |
| PTY session 创建 | `POST /api/sessions` HTTP | `client.new-pty-session` WS 帧 |

---

## TODO

### ① PTY 事件写入改掉

**目标：** `appendEvent` 不再写 SQLite，事件只走 relay → MySQL。

- [x] `pty.ts`：删掉 `store.appendEvent('session.started')` / `store.appendEvent('session.exited')` / `store.appendEvent('terminal.output')`，改为直接构造 event 对象调 `publishEvent`
- [x] `session-runner.ts`：同上，删掉所有 `store.appendEvent` 调用
- [x] `relay-client.ts`：删掉 `markSessionLost` 里的 `store.appendEvent('session.error')`，改为直接发 relay 帧
- [x] 删掉 `runner.started` / `runner.heartbeat` / `runner.exited` / `terminal.resize` / `user.input` 事件（不在 relay whitelist，前端不消费）
- [x] `store.touchSession` / `store.touchRunnerHeartbeat` 直接删掉

**验收：**
- 启动 PTY session，终端有输出，本地 SQLite `session_events` 表行数不增加
- MySQL `gateway_runtime_events` 表有 `terminal.output` 记录
- Web 端终端输出正常显示

---

### ② session 元数据改内存 Map

**目标：** `store.getSession` / `store.listSessions` / `store.insertSession` / `store.updateSessionStatus` 全部换成 `PtySessionManager` 内存 Map。

- [x] `PtySessionManager` 加 `getSession(id)` 和 `listSessions()` 公开方法
- [x] `pty.ts`：删掉 `store.insertSession`，session 只存内存 Map
- [x] `session-runner.ts`：同上
- [x] `relay-client.ts`：`getStoredSession` 改为调 `ptySessions.getSession`
- [x] `relay-client.ts`：`listRelaySessions` 改为调 `ptySessions.listSessions`
- [x] `relay-client.ts`：`markSessionLost` 里的 `store.updateSessionStatus` 改为更新内存 Map
- [x] `daemon.ts`：所有 `store.getSession` / `store.listSessions` 改为调 `ptySessions`

**验收：**
- 创建 PTY session，本地 SQLite `sessions` 表行数不增加
- `tether ls` 或 web 端能正常列出 session
- session 状态变化（running → completed）在内存 Map 中正确反映

---

### ③ relay 加 gateway.sessions-restore 推送

**目标：** gateway 重连 relay 后，relay 把该 gateway 的历史 sessions 推回来，gateway load 进内存 Map，实现重启恢复。

- [x] `packages/protocol`：新增 `gateway.sessions-restore { sessions: RelaySession[] }` 帧类型
- [x] `apps/relay`：gateway auth 成功后，查 MySQL 该 gatewayId 的 sessions，推 `gateway.sessions-restore` 帧
- [x] `apps/gateway relay-client.ts`：新增 `case 'gateway.sessions-restore'`，把 sessions load 进 `PtySessionManager` 内存 Map，检查 PID 是否还活着，死的标记 lost

**验收：**
- gateway 进程重启后，web 端 session 列表能恢复之前的 sessions
- 重启后已死的 PTY 进程对应 session 状态为 `lost`
- 正在运行的 PTY 进程（进程未死）重启 gateway 后仍可继续使用

---

### ④ PTY session 创建改走 WS

**目标：** 删掉 `POST /api/sessions` HTTP 接口，改用 relay WS 帧创建 PTY session。

- [x] `packages/protocol`：新增 `client.new-pty-session { provider, command, cwd, cols, rows }` 帧类型
- [x] `apps/relay`：转发 `client.new-pty-session` 给对应 gateway
- [x] `apps/gateway relay-client.ts`：新增 `case 'client.new-pty-session'` → 调 `ptySessions.create()`，创建后发 `gateway.session-created` 帧
- [x] `apps/web`：创建 PTY session 改为发 `client.new-pty-session` WS 帧
- [x] `apps/gateway daemon.ts`：删掉 `POST /api/sessions` 接口
- [x] `apps/cli`：删掉 `tether run` / `tether claude` / `tether codex` 等通过 HTTP 创建 session 的命令

**验收：**
- Web 端能通过 WS 创建新 PTY session
- `POST /api/sessions` 返回 404
- `tether run` 命令已移除

---

### ⑤ 删本地 SQLite 及 Store 清理

**目标：** 完全删掉 `Store` 类和本地 SQLite。

- [x] 确认 `store.*` 无任何调用残留（`grep -r "store\." apps/gateway/src`）
- [x] 删掉 `apps/gateway/src/store.ts`
- [x] 删掉 `apps/gateway` 里 `DatabaseSync` 相关依赖和 `--experimental-sqlite` 启动参数
- [x] `apps/cli`：删掉所有 `new Store()` / `store.listSessions()` / `store.getSession()` 调用
- [x] 清理 `apps/cli` 里已无用的 `tether ls` SQLite fallback 逻辑
- [x] 删掉 `~/.tether/*.db` 相关的初始化和路径代码

**验收：**
- `apps/gateway` 无任何 SQLite 相关 import
- gateway 启动日志无 SQLite 初始化信息
- 全量 typecheck 通过：`pnpm --filter @tether/gateway typecheck`
- 全量 typecheck 通过：`pnpm --filter @tether-labs/cli typecheck`

---

## 执行顺序

```
① 事件写入改掉
  ↓
② session 元数据改内存 Map
  ↓
③ relay 加 gateway.sessions-restore
  ↓
④ PTY 创建改 WS
  ↓
⑤ 删 SQLite + 清理 Store
```

每步独立可验收，不需要一次性全做完。
