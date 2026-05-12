# Chat Runtime Raw Events 方案

本文记录 `chats` 链路新增原始事件存储的方案、TODO 和验收项。

目标是同时满足两件事：

1. 聊天历史继续保持简单，只读最终可展示消息。
2. 流式过程、工具事件、错误事件也能被完整追踪和调试。

## 结论

新增一张 chat 专用 runtime events 表：

```text
gateway_runtime_chats_events
```

同时给最终聊天消息表新增 raw JSON 字段：

```text
gateway_chat_messages.raw_json
```

字段名建议使用 `raw_json`，和现有 `payload_json`、`usage_json` 命名保持一致。这里的
`raw_json` 就是本需求里的 rawjson：把完整事件 JSON 原样保存下来。

核心边界：

- `gateway_chat_messages` 只存最终能展示成聊天气泡的消息。
- `gateway_runtime_chats_events` 存聊天过程发生过的所有 chat event。
- `agent.delta` 不写入 `gateway_chat_messages`，只写入 `gateway_runtime_chats_events`。
- 第一版不做批量写、不做 100-200ms buffer，先直写 MySQL；如果写入压力明显，再单独加 buffer。

## 当前状态

当前 chat 链路里：

- `user.message` 和 `agent.result` 会派生写入 `gateway_chat_messages`。
- `agent.delta` 不写 DB，只通过 WebSocket 转发给当前在线 client。
- `gateway_runtime_events` 是 terminal/runtime event 表，chat UI 不依赖它展示聊天内容。
- `gateway_chat_messages` 只有拆出的字段，没有保存完整 raw event。

当前直接影响：

- 断线期间只产生 delta、还没产生 result 时，Server DB 没有中间内容。
- 排查问题时，只能看最终消息，无法还原完整 chat event 流。
- `gateway_chat_messages` 无法反查当时的完整事件 payload，例如 `contextWindow`、
  `rateLimitInfo`、`nextSuggestions` 等原始结构。

## 表职责

```text
┌──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ 表                           │ 存什么                       │ 用途                         │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ gateway_chat_messages        │ user / assistant 最终消息     │ 聊天历史展示                 │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ gateway_runtime_chats_events │ chat 链路所有过程事件         │ 调试、审计、流式过程追踪     │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

## 写入规则

### gateway_chat_messages

只写最终可展示消息：

```text
┌────────────────┬────────┬──────────────────────────────────────────────┐
│ event type     │ 是否写 │ 说明                                         │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ user.message   │ 是     │ role=user，content=payload.message           │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.result   │ 是     │ role=assistant，content=payload.text         │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.delta    │ 否     │ 过程碎片，不是一条最终聊天消息              │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.tool     │ 否     │ 工具过程事件，暂不作为聊天气泡入历史表      │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ session.error  │ 否     │ 错误事件，先只进 runtime chats events        │
└────────────────┴────────┴──────────────────────────────────────────────┘
```

`gateway_chat_messages.raw_json` 写完整事件 JSON，至少包含：

```json
{
  "id": 123,
  "sessionId": "tth_xxx",
  "type": "agent.result",
  "ts": 1710000000000,
  "payload": {
    "text": "完整回复",
    "usage": {
      "input_tokens": 10,
      "output_tokens": 20
    }
  }
}
```

### gateway_runtime_chats_events

写所有 chat event：

```text
┌────────────────┬────────┬──────────────────────────────────────────────┐
│ event type     │ 是否写 │ 说明                                         │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ user.message   │ 是     │ 用户消息事件                                 │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.delta    │ 是     │ 流式输出碎片                                 │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.result   │ 是     │ 最终完整回复                                 │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ agent.tool     │ 是     │ 工具调用过程                                 │
├────────────────┼────────┼──────────────────────────────────────────────┤
│ session.error  │ 是     │ chat 运行错误                                │
└────────────────┴────────┴──────────────────────────────────────────────┘
```

`gateway_runtime_chats_events.raw_json` 写完整事件 JSON。不要只保存 `payload`，要保存完整 event，
这样后续排查可以知道 `event.id`、`event.type`、`sessionId`、`ts` 和 payload。

## 字段草案

### gateway_runtime_chats_events

```sql
CREATE TABLE IF NOT EXISTS gateway_runtime_chats_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  event_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  raw_json MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_runtime_chats_events_session_event (session_id, event_id),
  KEY idx_runtime_chats_events_session_id_id (session_id, id),
  KEY idx_runtime_chats_events_session_event_type (session_id, event_type)
);
```

说明：

- `event_id` 必须是真实稳定 id，不能继续用 `0`。
- 唯一键用 `(session_id, event_id)`，支持 Relay/Server 重试幂等。
- `raw_json` 需要沿用现有敏感信息掩码策略，不能把 token/API key 原样入库。

### gateway_chat_messages

新增字段：

```sql
ALTER TABLE gateway_chat_messages
  ADD COLUMN raw_json MEDIUMTEXT DEFAULT NULL AFTER usage_json;
```

写入 `user.message` / `agent.result` 时，同步写入 `raw_json`。

## 关键改动点

```text
┌──────┬──────────────────────────────────────────────┬──────────────────────────────┐
│ 编号 │ 改动                                         │ 说明                         │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C1   │ 新增 Server SQL migration                    │ 建新表，给旧表补 raw_json    │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C2   │ 更新空库 schema                              │ 004/后续 SQL 保证新库一致    │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C3   │ Gateway delta 生成真实 event id              │ 不能再用 event.id = 0        │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C4   │ Relay 让 agent.delta 进入 runtime sync       │ 当前 delta 会直接 break      │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C5   │ Server runtime sync 写 runtime chats events   │ chat event 统一写新表        │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C6   │ user/result 派生写 messages 时带 raw_json     │ 最终气泡保留完整 raw event   │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ C7   │ 补测试                                       │ 覆盖 delta、result、幂等     │
└──────┴──────────────────────────────────────────────┴──────────────────────────────┘
```

## TODO

```text
┌──────┬──────────────────────────────────────────────┬──────────────────────────────┐
│ 状态 │ TODO                                         │ 验收                         │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 新增 gateway_runtime_chats_events migration  │ MySQL 空库启动后表存在       │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 给 gateway_chat_messages 增加 raw_json       │ 旧库迁移后字段存在           │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 更新空库建表 SQL                             │ 新库和旧库最终 schema 一致   │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ agent.delta 使用真实 event id                │ Relay 收到的 delta id 非 0   │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ Relay 同步 agent.delta                       │ Server 能收到 delta sync     │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ Server 写 gateway_runtime_chats_events       │ user/delta/result/tool/error │
│      │                                              │ 均能写 raw_json              │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ Server 写 gateway_chat_messages.raw_json     │ user/result 行含完整 raw_json│
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 保持 chat history 读取不变                   │ Web 历史仍读 messages 表     │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 补 runtime sync 单测                         │ delta/result 写库逻辑覆盖    │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 补 relay 同步测试                            │ agent.delta 不再被 sync 跳过 │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ [ ]  │ 补 gateway event id 测试                     │ delta event id 稳定且非 0    │
└──────┴──────────────────────────────────────────────┴──────────────────────────────┘
```

## 验证项目

### 自动验证

```bash
pnpm --filter @tether/gateway test
pnpm --filter @tether/relay test
pnpm --filter @tether/server test
pnpm --filter @tether/gateway typecheck
pnpm --filter @tether/relay typecheck
pnpm --filter @tether/server typecheck
```

### 数据库验收

```text
┌──────┬──────────────────────────────────────────────┬──────────────────────────────┐
│ 编号 │ 验收项                                       │ 期望                         │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB1  │ SHOW COLUMNS gateway_chat_messages           │ 存在 raw_json                │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB2  │ SHOW TABLES                                  │ 存在 gateway_runtime_chats_events│
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB3  │ 发送一条 chat 消息                           │ runtime chats events 有 user │
│      │                                              │ / delta / result 原始事件    │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB4  │ 查询 gateway_chat_messages                   │ 只有 user/result 最终气泡    │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB5  │ 重放同一个 event                             │ 不重复插入，按唯一键更新     │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ DB6  │ 检查 raw_json                                │ 保存完整 event，且敏感信息   │
│      │                                              │ 已脱敏                       │
└──────┴──────────────────────────────────────────────┴──────────────────────────────┘
```

### 人工验收

```text
┌──────┬──────────────────────────────────────────────┬──────────────────────────────┐
│ 编号 │ 操作                                         │ 期望                         │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ UAT1 │ Web 发起新 chat                              │ 页面正常流式显示             │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ UAT2 │ 回复过程中查看 runtime chats events          │ 能看到连续 agent.delta       │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ UAT3 │ 回复完成后刷新页面                           │ 历史消息只出现一条完整回复   │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ UAT4 │ 查询 gateway_chat_messages.raw_json          │ user/result 都有完整 rawjson │
├──────┼──────────────────────────────────────────────┼──────────────────────────────┤
│ UAT5 │ 模拟 Relay 重试同一事件                      │ runtime chats events 不重复  │
└──────┴──────────────────────────────────────────────┴──────────────────────────────┘
```

## 暂不做

- 暂不把 `agent.delta` 派生成 `gateway_chat_messages`。
- 暂不改变 Web 读取历史消息的 API。
- 暂不做 delta buffer / batch insert。
- 暂不把 PTY / terminal event 写入 `gateway_runtime_chats_events`。
- 暂不调整 `gateway_runtime_events` 的职责。

## 风险和后续

主要风险是写入量：

- `agent.delta` 会比 `agent.result` 高频很多。
- 第一版直写 MySQL，便于尽快打通链路和验证 rawjson。
- 如果发现慢查询、连接池压力或写入延迟，再新增 100-200ms buffer 或批量写入。

另一个关键风险是 event id：

- 当前 delta 不能继续使用 `event.id = 0`。
- 没有稳定 event id，就无法做顺序、幂等和重试。
- 实现时应优先修正 Gateway 侧 delta event id，再接 Relay/Server 入库。
