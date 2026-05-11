# Chat Session 标题所有权与改名保护

状态：Working  
创建时间：2026-05-11  
范围：`gateway_sessions.title`、Web 改名、Gateway runtime sync、聊天 session 列表刷新  
目标：用户在 Web 上手动改名后，标题不再被 Gateway 后续同步的旧标题覆盖。

## 背景

当前聊天 session 列表支持 Web 改名，但实际表现是：

1. Web 先乐观更新列表标题。
2. Web 调用 `PUT /api/server/chat-sessions/:sessionId`，Server DB 写入新标题。
3. Gateway 仍保留本机 SQLite 里的旧 `session.title`。
4. Gateway runtime sync 后续再次上报 session 列表。
5. Server sync upsert 把 `gateway_sessions.title` 覆盖回 Gateway 旧标题。
6. Web 下一次刷新列表后，标题看起来又“改回去了”。

这不是单纯前端刷新问题，而是 `title` 字段同时被 Web 用户操作和 Gateway 同步写入，事实源冲突。

## 设计结论

`title` 应拆成两种语义：

| 语义 | 来源 | 谁拥有 |
| --- | --- | --- |
| 默认标题 | Gateway 创建 session 时提供 | Gateway |
| 用户自定义标题 | Web 用户手动改名 | Server |

用户手动改名后，Server 应成为该 session 展示标题的事实源。Gateway 后续同步仍可更新状态、`lastActiveAt`、`agentSessionId` 等运行时字段，但不能覆盖用户改过的标题。

## 推荐方案

给 `gateway_sessions` 增加标题来源字段：

```sql
title_source VARCHAR(32) NOT NULL DEFAULT 'gateway'
```

允许值：

| 值 | 含义 |
| --- | --- |
| `gateway` | 标题来自 Gateway 默认标题，可被 Gateway sync 更新 |
| `user` | 标题来自用户手动改名，不允许 Gateway sync 覆盖 |

### Rename 接口

Web 改名时，Server 写：

```sql
UPDATE gateway_sessions
SET title = ?, title_source = 'user', updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND account_id = ?
  AND user_id = ?
  AND transport = 'chat'
```

必须检查 affected rows：

- `affectedRows > 0`：返回 `{ ok: true }`
- `affectedRows = 0`：返回 403 或 404，前端回滚/重新拉列表

### Runtime Sync Upsert

Gateway 同步 session 时，不能无条件 `title = VALUES(title)`。

建议规则：

```sql
title = IF(title_source = 'user', title, VALUES(title)),
title_source = COALESCE(title_source, 'gateway')
```

含义：

- 新 session 首次插入：使用 Gateway title，`title_source = gateway`
- 老 session 未手动改名：Gateway 可以继续更新默认 title
- 用户手动改名后：Gateway 不能覆盖 title

## 为什么不建议只改前端

前端乐观更新只能临时显示新名字，挡不住 Server 被 Gateway 旧数据覆盖。

只改前端会导致：

- 刷新后回旧标题
- 手机和电脑显示不一致
- 重连回填后又回旧标题
- 后续多设备 Gateway 下更难判断谁是事实源

## 为什么不建议只同步到 Gateway 本机

Web 改名后也可以发命令让 Gateway 本机 SQLite 改名，但这不是首选：

- Gateway 离线时改名无法完成
- 多 Gateway 后需要路由到正确 Gateway
- Server 列表已经是 Web 的读取源
- 用户偏好类字段更适合由 Server 持有

所以更稳的做法是：Gateway 负责运行时状态，Server 负责用户显示偏好。

## 隐患与处理

| 隐患 | 处理 |
| --- | --- |
| 老数据没有 `title_source` | 迁移默认填 `gateway` |
| `ALTER TABLE ... ADD COLUMN` 重复执行报错 | migration 必须幂等处理，不能依赖当前 `db.ts` 的 `ADD INDEX` 兜底 |
| rename 没改到行也返回 ok | 补 affected rows 检查 |
| rename 可能改到非 chat session | `WHERE` 必须加 `transport = 'chat'` |
| Gateway sync 覆盖用户标题 | upsert 按 `title_source` 保护 |
| 删除 session 后 Gateway 回灌 | 继续沿用 `gateway_deleted_sessions` 防回灌逻辑 |
| `agent_session_id` 也有 Server / runtime 双写 | 不套用 `title_source`，该字段仍由 Gateway/runtime 作为事实源 |
| 多设备 Gateway 下标题归属混乱 | 用户标题以 Server 为准，不按 Gateway 区分 |
| 未来需要恢复默认标题 | 预留 `title_source`，后续可加 reset 接口 |

### 额外边界说明

#### Migration 幂等

当前 `apps/server/app/service/db.ts` 的 DDL 幂等兜底只覆盖：

- `DROP` 缺字段 / 缺索引
- `ADD INDEX` / `ADD KEY` 重复

它没有覆盖 `ADD COLUMN` 重复错误。新增 `title_source` migration 不能只写：

```sql
ALTER TABLE gateway_sessions ADD COLUMN title_source VARCHAR(32) NOT NULL DEFAULT 'gateway';
```

否则第二次启动或重复执行 schema 初始化时可能报 `ER_DUP_FIELDNAME`。

可选处理：

1. 扩展 `db.ts`，把 `ER_DUP_FIELDNAME` 且语句是 `ALTER TABLE ... ADD COLUMN` 视为可忽略。
2. 使用 `INFORMATION_SCHEMA.COLUMNS` 做条件迁移。

如果选择第 1 种，需要补 `db` schema 初始化测试，确认重复执行 migration 不会失败。

#### Rename 范围

`renameSession()` 当前应只服务聊天列表的 `transport = 'chat'` session。

更新语句应收紧为：

```sql
UPDATE gateway_sessions
SET title = ?, title_source = 'user', updated_at = CURRENT_TIMESTAMP
WHERE id = ?
  AND account_id = ?
  AND user_id = ?
  AND transport = 'chat'
```

否则理论上可能改到非 chat 运行时 session。

#### `agent_session_id` 不纳入本方案

`agent_session_id` 目前也有两条写入路径：

- Relay 收到 `session.agent-id-updated` 后通过 Server 接口写入
- Gateway runtime sync 上报 session 列表时写入

但它和 `title` 语义不同：

| 字段 | 语义 | 事实源 |
| --- | --- | --- |
| `title` | 用户展示偏好 / 默认标题 | 用户改名后 Server 优先 |
| `agent_session_id` | provider resume id / 运行时事实 | Gateway/runtime 优先 |

所以不要把 `title_source` 的保护模式套到 `agent_session_id` 上。该字段继续由 runtime/Gateway 更新。

## TODO

- [x] 新增 DB migration：`gateway_sessions.title_source VARCHAR(32) NOT NULL DEFAULT 'gateway'`
- [x] migration 做幂等处理：重复执行不会因 `ADD COLUMN` 报错
- [x] 确认 `env.sh` 指向 MySQL 上目标 migration 不破坏现有表结构
- [x] 修改 `chatRepository.renameSession()`：写入 `title_source = 'user'`
- [x] 修改 `chatRepository.renameSession()`：检查 affected rows，未命中返回错误
- [x] 修改 `chatRepository.renameSession()`：`WHERE` 增加 `transport = 'chat'`
- [x] 修改 `runtimeSyncRepository.upsertGatewaySession()`：`title_source = 'user'` 时保留 Server title
- [x] 明确不修改 `agent_session_id` 的所有权：仍由 Gateway/runtime 更新
- [x] 补 server 单测：用户 rename 后再次 runtime sync 旧 title，不应覆盖
- [x] 补 server 单测：未 rename 的 gateway title 仍可正常同步
- [x] 补 server 单测：rename 不存在或无权限 session 不能返回 ok
- [x] 补 server 单测：非 chat session 不能通过 chat rename 改名
- [x] 补 schema 测试或启动验证：重复执行 migration 不因 `title_source` 已存在失败
- [x] 前端 rename 失败时保留现有回滚策略：重新 `loadSessions()`
- [ ] 人工验证 Web 列表：改名后刷新、重连、Gateway 重启后仍显示用户标题

## 验证项目

### 自动测试

1. Runtime sync 首次插入：
   - 输入 Gateway title = `默认标题`
   - 期望 `gateway_sessions.title = 默认标题`
   - 期望 `title_source = gateway`

2. 用户改名：
   - 调 `PUT /api/server/chat-sessions/:id`，title = `我的名字`
   - 期望 `gateway_sessions.title = 我的名字`
   - 期望 `title_source = user`

3. 用户改名后 Gateway 再同步旧标题：
   - Runtime sync 上报 title = `默认标题`
   - 期望 DB 仍为 `我的名字`
   - 期望 `title_source` 仍为 `user`

4. 未手动改名 session 继续允许 Gateway 更新默认标题：
   - `title_source = gateway`
   - Runtime sync 上报 title = `新的默认标题`
   - 期望 DB 更新为 `新的默认标题`

5. 无权限 / 不存在 session 改名：
   - `UPDATE affectedRows = 0`
   - 期望接口返回错误，不返回 `{ ok: true }`

6. 非 chat session 改名：
   - 准备一条 `transport != 'chat'` 的 `gateway_sessions`
   - 调 `PUT /api/server/chat-sessions/:id`
   - 期望接口返回错误
   - 期望 DB title 不变

7. Migration 重复执行：
   - 已存在 `gateway_sessions.title_source`
   - 再次执行 schema 初始化
   - 期望不抛 `ER_DUP_FIELDNAME`
   - 2026-05-11 已验证：source `env.sh` 后对 `008_gateway_session_title_source.sql`
     连续执行两遍，均返回 ok；`INFORMATION_SCHEMA.COLUMNS` 显示
     `title_source` 为 `varchar(32)`、`NOT NULL`、默认值 `gateway`

### 人工验证

1. 在 Web 左侧列表把 session 改名为 `本地写入内容`
2. 刷新页面
3. 等待 Gateway runtime sync 或重启 Gateway
4. 再次刷新页面
5. 期望左侧列表仍显示 `本地写入内容`
6. 手机浏览器切后台再回来，触发 WS reconnect catch-up
7. 期望回填后标题仍不回退

## 非目标

本方案不处理：

- session 标题多语言
- 标题历史记录
- “恢复默认标题”按钮
- Gateway 本机 SQLite 标题同步回写

这些可以后续单独设计。
