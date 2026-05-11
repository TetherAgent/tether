# Server DB Runtime Sync 方案

本文记录生产 Web / App 读取 session、Chat 历史和高级页 Terminal 历史的目标方案。它解决
当前生产 `/api/sessions/:id/conversation` 依赖 Gateway 反向 RPC、刷新慢、Gateway 离线后
历史不可读的问题。

## 结论

第一版做完整高级页，Server DB 使用 4 张表：

```text
gateway_sessions
gateway_chat_messages
gateway_runtime_events
gateway_sync_cursors
```

目标分工：

| 流量类型 | 路径 | 事实来源 |
| --- | --- | --- |
| 读列表 | `GET /api/sessions` | Server DB `gateway_sessions` |
| 读结构化聊天 | `GET /api/sessions/:id/conversation` | Server DB `gateway_chat_messages` |
| 读 Terminal 历史 | Terminal Tab 历史接口 | Server DB `gateway_runtime_events` |
| 发送输入 | `POST /api/sessions/:id/input` | Relay -> Gateway 反向 RPC |
| 停止会话 | `POST /api/sessions/:id/stop` | Relay -> Gateway 反向 RPC |
| 实时增量 | Relay WebSocket | Gateway live frame |

也就是：

```text
读数据：Server DB
写控制：Relay -> Gateway
实时增量：Relay WS
断线补偿：gateway_sync_cursors
```

## 为什么要这样改

当前 Web 生产环境访问 `https://tether.earntools.me/api/sessions/:id/conversation` 时，如果
nginx 把 `/api/` 转给 `apps/server`，而 Server 没有这个接口，就会 404。即使把这个路径
转给 Relay，Relay 也需要再通过 Gateway 反向 RPC 拉取本机数据；页面刷新速度取决于本机
Gateway 是否在线和响应速度。

把结构化数据和受限 runtime event 写入 Server DB 后：

- 页面刷新快，不必等待本机 Gateway 响应。
- Web 和 App 用同一份数据，展示一致。
- Gateway 短暂离线时，Chat 历史和受限 Terminal 历史仍可读。
- 生产 `/api/sessions/:id/conversation` 不再依赖反向 RPC。
- 后续多端同步、通知、搜索、历史记录都能基于 Server DB 做。

## 写入来源

Gateway 现在已经会上报这些 Relay frame：

```text
gateway.sessions
gateway.conversation
gateway.event
```

Relay 收到后负责把可持久化的数据同步到 Server。Server 负责落库、鉴权和按
`account_id / workspace_id` 隔离读取。

## 谁调用接口写数据库

只有 Relay 调 Server 的内部 runtime sync 接口写数据库。

链路：

```text
Gateway
  -> WebSocket 发 gateway.sessions / gateway.conversation / gateway.event
  -> Relay 收到 frame
  -> Relay 调 Server 内部 HTTP sync API
  -> Server 写 MySQL
```

不是 Web/App 写，也不是 Gateway 直接连 MySQL。

建议接口形态：

```text
POST /api/runtime-sync/gateway/sessions
POST /api/runtime-sync/gateway/conversation
POST /api/runtime-sync/gateway/event
```

调用方：

```text
apps/relay
```

落库方：

```text
apps/server
```

数据库只由 Server 写：

```text
Relay -> Server sync API -> Server service/repository -> MySQL
```

边界：

- Gateway 只负责本机 session 和上报 frame。
- Relay 只负责转发、同步、推送，不直接碰 MySQL。
- Server 是唯一 DB writer，负责鉴权、幂等 upsert、防串校验。
- Web/App 只读公开 API，不允许写 runtime DB。

## 防止其他人乱写

runtime sync 写接口必须是内部接口，不对普通用户开放。防护分 5 层。

### 1. sync 接口不接受普通用户 token

这些接口只给 Relay 调：

```text
POST /api/runtime-sync/gateway/sessions
POST /api/runtime-sync/gateway/conversation
POST /api/runtime-sync/gateway/event
```

它们不接受普通 `normal_client_access` token。请求必须带内部密钥：

```http
X-Tether-Runtime-Sync-Secret: <server-side-secret>
```

Server 校验：

```text
header secret == TETHER_RUNTIME_SYNC_SECRET
```

不匹配直接拒绝。

### 2. Relay 不能随便写任意账号

Relay 调 sync API 时必须带 Gateway auth scope：

```text
account_id
workspace_id
gateway_id
```

Server 写库前校验：

```text
frame.gatewayId == scope.gatewayId
session.accountId == scope.accountId
session.workspaceId == scope.workspaceId
```

不一致直接拒绝。

### 3. Server 是唯一 DB writer

禁止：

```text
Web/App -> 写 runtime DB
Gateway -> 直接写 MySQL
Relay -> 直接写 MySQL
```

只允许：

```text
Relay -> Server sync API -> Server service/repository -> MySQL
```

### 4. 唯一键只负责幂等，不负责权限

唯一键负责防重复：

```text
gateway_sessions: id
gateway_chat_messages: (session_id, turn_index)
gateway_runtime_events: (session_id, event_id)
gateway_sync_cursors: (gateway_id, session_id)
```

权限必须靠 Server 校验，不能只靠唯一键。

### 5. nginx 再挡一层

生产上 `/api/runtime-sync/` 不应该给公网普通请求直接使用。Relay 和 Server 在同一台机器时，
nginx 可以只允许本机访问：

```nginx
location /api/runtime-sync/ {
    allow 127.0.0.1;
    deny all;
    proxy_pass http://127.0.0.1:4800;
}
```

如果 Relay 和 Server 不在同一台机器，再使用强 secret 加 IP allowlist。

完整防乱写链路：

```text
nginx allowlist
+ internal sync secret
+ Gateway auth scope 校验
+ session ownership 校验
+ Server-only DB writer
```

## DB 表

### gateway_sessions

保存 session 列表页和权限过滤所需字段。

建议字段：

| 字段 | 用途 |
| --- | --- |
| `id` | session id，例如 `tth_20260509_xxxxxx` |
| `account_id` | 账号隔离 |
| `workspace_id` | workspace 隔离 |
| `gateway_id` | 来源 Gateway |
| `user_id` | 创建或拥有该 session 的用户 |
| `provider` | `codex` / `claude` / `opencode` 等 |
| `title` | 列表标题 |
| `project_path` | 项目路径 |
| `agent_session_id` | provider 侧会话 id，可为空 |
| `status` | `running` / `stopped` / `completed` / `failed` / `lost` |
| `transport` | `pty-event-stream` / `tmux` |
| `last_active_at` | 最近活跃时间 |
| `created_at` | 首次入库时间 |
| `updated_at` | 最近更新时间 |

唯一键：

```text
PRIMARY KEY (id)
```

### gateway_chat_messages

保存 Chat Tab 的结构化聊天消息。

建议字段：

| 字段 | 用途 |
| --- | --- |
| `session_id` | 所属 session |
| `turn_index` | turn 顺序 |
| `role` | `user` / `assistant` |
| `content` | 结构化聊天正文 |
| `tools_json` | 工具调用摘要，JSON |
| `created_at` | turn 创建时间 |
| `updated_at` | 最近更新时间 |

唯一键：

```text
UNIQUE KEY (session_id, turn_index)
```

这保证重复收到 `gateway.conversation` 或 `agent.turn` 时可以幂等 upsert。

### gateway_runtime_events

保存 Terminal Tab 需要回放的受限运行时事件。它不是无限日志仓库，不保存所有噪音事件。

建议字段：

| 字段 | 用途 |
| --- | --- |
| `session_id` | 所属 session |
| `event_id` | Gateway 本机事件 id |
| `event_type` | `terminal.output` / `terminal.input` / `session.error` 等 |
| `payload_json` | 经过敏感信息掩码和长度限制后的 payload |
| `created_at` | 事件时间 |
| `updated_at` | 最近更新时间 |

唯一键：

```text
UNIQUE KEY (session_id, event_id)
```

第一版只允许写入：

```text
terminal.output
terminal.input
session.error
session.exited
agent.status
```

`resize`、`client.attach`、`client.detach` 等噪音事件默认不写。

### gateway_sync_cursors

保存同步进度，用于 Gateway 断线重连补偿，避免重复全量同步或漏数据。

建议字段：

| 字段 | 用途 |
| --- | --- |
| `gateway_id` | 来源 Gateway |
| `session_id` | 所属 session |
| `last_event_id` | 已同步到 Server 的最后 runtime event id |
| `last_turn_index` | 已同步到 Server 的最后 chat turn |
| `last_synced_at` | 最近同步时间 |
| `created_at` | 首次创建时间 |
| `updated_at` | 最近更新时间 |

唯一键：

```text
UNIQUE KEY (gateway_id, session_id)
```

## Frame 到 DB 的映射

## 写数据库时机

写数据库发生在 Relay 收到 Gateway 上报 frame 的时候，不等 Web/App 打开页面才写。

主要写入时机：

| 时机 | 上报 frame | DB 写入 |
| --- | --- | --- |
| Gateway 刚连上 Relay 或 session 列表变化 | `gateway.sessions` | upsert `gateway_sessions` |
| Gateway 主动补 Chat snapshot 或 Chat fallback 拉取成功 | `gateway.conversation` | upsert `gateway_chat_messages` |
| Agent 产生结构化 turn | `gateway.event` + `agent.turn` | upsert `gateway_chat_messages` |
| Terminal 有输出或输入 | `gateway.event` + `terminal.output` / `terminal.input` | upsert `gateway_runtime_events` |
| session 状态变化 | `gateway.event` + `session.exited` / `session.error` / `agent.status` | update `gateway_sessions`，upsert `gateway_runtime_events` |
| 任意同步成功 | 上述任意可持久化 frame | update `gateway_sync_cursors` |
| Gateway 重连 | snapshot + cursor 补偿 | 按 cursor 补写缺口 |

页面读取只读 Server DB：

```text
会话列表 -> gateway_sessions
Chat Tab -> gateway_chat_messages
Terminal Tab -> gateway_runtime_events
```

如果 DB 没命中，才走 fallback 拉 Gateway；拉回来的 `gateway.conversation` 或允许入库的
runtime events 仍要先写 DB，再返回给 Web/App。

## 会话列表读取和推送策略

会话列表不是只靠 DB，也不是只靠推送，而是两条链路一起用：

```text
首屏/刷新：GET /api/sessions -> gateway_sessions
实时变化：Relay WS push -> sessions frame -> 前端合并更新
```

具体规则：

- 默认进入列表：先查 `gateway_sessions`，保证快、稳定，Gateway 离线也能看到历史。
- 页面在线期间：继续接 Relay WS 推送，收到 `sessions` 后更新 UI。
- Gateway 上报 `gateway.sessions` 时：Relay 同步写 `gateway_sessions`，同时 push 给已在线 Web/App。
- 用户下拉刷新/点刷新：重新 `GET /api/sessions` 读 DB；必要时触发 fallback，让 Gateway 补
  sessions snapshot。

这样首屏不等 WS，在线状态又能实时更新。Server DB 提供稳定初始状态，Relay WS 提供活跃变化。

### gateway.sessions

行为：

```text
upsert gateway_sessions
```

要求：

- 每个 session 必须带 `accountId`、`workspaceId`，否则生产 token 模式下不应写给普通用户可读数据。
- `gatewayId` 优先使用 frame 的 `gatewayId`，session 自带 `gatewayId` 作为补充。
- status 以 Gateway 最新 snapshot 为准。
- 空 sessions snapshot 不能误删 DB 历史；最多更新该 Gateway 当前可控 session 状态，历史仍保留。

### gateway.conversation

行为：

```text
upsert gateway_chat_messages
update gateway_sync_cursors.last_turn_index
```

要求：

- 以 `(session_id, turn_index)` 幂等写入。
- 如果同一个 turn 后续内容更完整，以最新 payload 覆盖。
- 写入前先校验 session 归属，至少要能绑定到同 account/workspace 的 session。

### gateway.event

行为：

```text
if event.type == agent.turn:
  upsert gateway_chat_messages
  update gateway_sync_cursors.last_turn_index

if event.type in session.exited/session.error/agent.status:
  update gateway_sessions.status / last_active_at
  append/upsert gateway_runtime_events
  update gateway_sync_cursors.last_event_id

if event.type in terminal.output/terminal.input:
  append/upsert gateway_runtime_events with masking and retention limits
  update gateway_sync_cursors.last_event_id

else:
  不写 Server DB
```

要求：

- `terminal output` 可以进入 `gateway_runtime_events`，但必须限量、掩码，并按保留策略清理。
- PTY resize、client attach/detach 默认不写 Server DB，避免数据暴涨和噪音污染。
- `agent.turn` 只能保存结构化聊天内容，不能把整段终端原文当作 chat message。
- `session.error` 可以更新 status 和错误摘要；错误摘要是否入库要做长度限制。

## HTTP API

生产 Web / App 继续请求同一套 URL，不需要改客户端 URL：

```text
GET  /api/sessions
GET  /api/sessions/:id/conversation
POST /api/sessions/:id/input
POST /api/sessions/:id/stop
```

### 读接口

`GET /api/sessions`：

- 从 `gateway_sessions` 读取。
- 按当前 token 的 `account_id / workspace_id / user_id` 过滤。
- 返回当前用户可见的 sessions。

`GET /api/sessions/:id/conversation`：

- 从 `gateway_chat_messages` 读取。
- 先通过 `gateway_sessions` 校验当前 token 能访问该 session。
- 返回 chat messages，按 `turn_index` 排序。

Terminal Tab 历史读取：

- 从 `gateway_runtime_events` 读取。
- 先通过 `gateway_sessions` 校验当前 token 能访问该 session。
- 按 `event_id` 排序回放受限 terminal 历史。
- 后续 live output 继续走 Relay WebSocket。

### 控制接口

`POST /api/sessions/:id/input`：

- 仍走 Relay -> Gateway 反向 RPC。
- 因为只有本机 Gateway 能把输入写进 runner / PTY。

`POST /api/sessions/:id/stop`：

- 仍走 Relay -> Gateway 反向 RPC。
- 因为停止动作必须到本机 Gateway / runner。

## nginx 路由影响

如果生产入口统一是 `https://tether.earntools.me`，建议按能力拆路由：

| 路径 | 上游 |
| --- | --- |
| `GET /api/sessions` | Server |
| `GET /api/sessions/:id/conversation` | Server |
| Terminal 历史读取接口 | Server |
| `POST /api/sessions/:id/input` | Relay |
| `POST /api/sessions/:id/stop` | Relay |
| `/gateway` | Relay WebSocket |
| `/client` | Relay WebSocket |
| 其他 `/api/` | Server |

如果 nginx 不方便按 method 拆，也可以让 Server 承接 `/api/sessions/*` 的读接口，控制接口由
Server 内部转发给 Relay。但最小实现建议先在 nginx 显式拆开读接口和控制接口。

## 兜底策略

保留反向 RPC 作为 fallback，但它不再是生产读主路径。

触发场景：

- DB 没命中该 session conversation。
- DB 没命中该 session terminal history。
- 用户手动点刷新。
- Gateway 刚上线，Server DB 还没收到 snapshot。

fallback 流程：

```text
Web/App GET /api/sessions/:id/conversation
  -> Server DB 没命中
  -> Relay 反向 RPC 拉 Gateway
  -> Gateway 返回 gateway.conversation
  -> Relay/Server upsert gateway_chat_messages
  -> 再返回给 Web/App
```

注意：fallback 是补洞，不是常态路径。正常情况下刷新页面应直接读 Server DB。

## 重连补偿

Gateway 重连 Relay 后必须补一次 snapshot：

1. 发 `gateway.sessions`，同步当前 sessions。
2. 根据 `gateway_sync_cursors` 判断每个 session 上次同步到哪里。
3. 对 running / recently active sessions 补 `gateway.conversation` snapshot。
4. 对 terminal 历史按 cursor 补 `gateway.event` 中允许入库的 runtime events。
5. Server 按幂等 upsert 写入，补齐断线期间漏掉的结构化聊天和受限终端历史。

如果只同步 live event，不补 snapshot，就会出现断线期间 App/Web 看到的 conversation 或
terminal 历史缺口。

## 安全边界

- Server DB 里的 sessions、chat messages 和 runtime events 必须按 `account_id / workspace_id`
  隔离。
- 普通用户 token 只能读自己 scope 内的数据。
- Relay 同步 Server 时必须走 server-to-server 鉴权，例如内部 secret header 或专用
  runtime sync token。
- `gateway_runtime_events` 只能保存受限 terminal output，必须掩码、限量、可清理。
- Chat 内容也可能敏感，后续如果做团队共享，需要补权限、审计和保留策略。
- upsert 不应扩大可见性：缺少 account/workspace 的 legacy session 不应暴露给生产普通用户。

## 防串数据设计

核心原则：任何写入和读取都必须能落到同一条归属链。

```text
account_id -> workspace_id -> gateway_id -> session_id
```

### 写入侧防串

Relay 收到 Gateway frame 后，先使用 Gateway WS 认证得到的 `RelayAuthScope` 作为可信 scope。
写库时不直接信任客户端传来的裸 `sessionId`，而是做以下校验：

1. `gateway.sessions` 写 `gateway_sessions` 时：
   - `account_id`、`workspace_id` 来自 Gateway auth scope 或 session scope，二者冲突时拒绝写入。
   - `gateway_id` 必须等于当前已认证 Gateway 的 `gatewayId`。
   - 生产 token 模式下，缺少 `account_id` / `workspace_id` 的 legacy session 不写入普通用户可读 DB。

2. `gateway.conversation` 写 `gateway_chat_messages` 时：
   - 先查 `gateway_sessions`，确认 `session_id` 存在。
   - `gateway_sessions.gateway_id` 必须等于当前 Gateway。
   - `gateway_sessions.account_id/workspace_id` 必须等于当前 Gateway auth scope。
   - 通过后才 upsert `(session_id, turn_index)`。

3. `gateway.event` 写 `gateway_chat_messages` 或 `gateway_runtime_events` 时：
   - 先用 `event.sessionId` 查 `gateway_sessions`。
   - 找不到 session 时不直接写事件；可以触发一次 sessions snapshot/fallback，再决定是否写。
   - 找到后校验 `account_id/workspace_id/gateway_id` 都匹配当前 Gateway auth scope。
   - 通过后才写 event 或 turn。

4. `gateway_sync_cursors`：
   - 唯一键使用 `(gateway_id, session_id)`。
   - 更新 cursor 前必须完成同样的 session 归属校验。

### 读取侧防串

Web/App 读接口不能只按 `session_id` 查数据，必须先验证当前用户 token scope。

读 `GET /api/sessions`：

```text
WHERE account_id = token.account_id
  AND workspace_id = token.workspace_id
  AND user 可见
```

读 `GET /api/sessions/:id/conversation`：

```text
1. 先查 gateway_sessions
   WHERE id = :session_id
     AND account_id = token.account_id
     AND workspace_id = token.workspace_id

2. 通过后再查 gateway_chat_messages
   WHERE session_id = :session_id
   ORDER BY turn_index ASC
```

读 Terminal 历史同理：

```text
1. 先查 gateway_sessions 做权限校验
2. 再查 gateway_runtime_events
   WHERE session_id = :session_id
   ORDER BY event_id ASC
```

### 唯一键和幂等

用唯一键避免重复写入，也避免不同 Gateway 的数据覆盖到同一行：

```text
gateway_sessions:
  PRIMARY KEY (id)

gateway_chat_messages:
  UNIQUE KEY (session_id, turn_index)

gateway_runtime_events:
  UNIQUE KEY (session_id, event_id)

gateway_sync_cursors:
  UNIQUE KEY (gateway_id, session_id)
```

如果未来允许不同 Gateway 产生相同 session id，需要把 `gateway_id` 纳入
`gateway_chat_messages` 和 `gateway_runtime_events` 的唯一键。但当前 session id 本身应全局唯一，
第一版先以 `session_id` 为主键边界，并用写入前的 `gateway_sessions` 归属校验防串。

### 拒绝策略

以下情况必须拒绝写入或返回 403：

- Gateway frame 的 `gatewayId` 和认证 scope 不一致。
- session 的 `accountId/workspaceId` 和 Gateway auth scope 不一致。
- 普通用户读取不属于自己 account/workspace 的 session。
- event 指向的 session 不存在，且 fallback 后仍无法确认归属。
- legacy/unscoped session 试图暴露给生产普通用户。

## 落地顺序

1. Server DB 加 `gateway_sessions`、`gateway_chat_messages`、`gateway_runtime_events`、
   `gateway_sync_cursors` 表。
2. Server 增加 runtime sync 写接口，供 Relay 上报结构化数据。
3. Relay 收 `gateway.sessions` 时 upsert `gateway_sessions`。
4. Relay 收 `gateway.conversation` 和 `agent.turn` 时 upsert `gateway_chat_messages`。
5. Relay 收 `terminal.output`、`terminal.input`、`session.exited`、`session.error`、
   `agent.status` 时按白名单写 `gateway_runtime_events`。
6. `GET /api/sessions` 改为读 Server DB。
7. `GET /api/sessions/:id/conversation` 改为读 Server DB。
8. Terminal Tab 历史读取改为读 `gateway_runtime_events`，live output 继续 Relay WS。
9. `POST /api/sessions/:id/input` 和 `POST /api/sessions/:id/stop` 保持 Relay -> Gateway。
10. 每次成功同步后更新 `gateway_sync_cursors`。
11. 保留 RPC fallback：DB 没命中或用户手动刷新时再拉 Gateway。
12. Gateway 重连后根据 cursor 补 sessions + conversation + runtime events snapshot。
13. Web / App 保持请求 `/api/...`，不改 URL。

## 验收清单

- [ ] Web 生产环境 `GET /api/sessions/:id/conversation` 不再 404。
- [ ] Gateway 在线时，Web / App 都能看到同一份 session 列表。
- [ ] Web 发送消息后，App 刷新能看到相同 conversation。
- [ ] Gateway 临时离线后，历史 conversation 和受限 terminal 历史仍能打开。
- [ ] `POST /api/sessions/:id/input` 仍能到达本机 Gateway。
- [ ] `POST /api/sessions/:id/stop` 仍能停止本机 session。
- [ ] 重复收到同一个 `gateway.conversation` 不产生重复 chat message。
- [ ] `terminal output` 只进入 `gateway_runtime_events`，并有掩码、限量和保留策略。
- [ ] 不同 account/workspace 之间不能串 session、chat message 或 runtime event。
