# Chat Provider 原始 JSON 落库

状态：Working

日期：2026-05-13

## 背景

当前 `gateway_runtime_chats_events.raw_json` 存的是 Tether 标准事件，不是 Claude / Codex / Copilot CLI stdout 的原始 JSON。

例如现在的 `raw_json` 是：

```json
{
  "id": 101,
  "sessionId": "tth_123",
  "type": "agent.delta",
  "ts": 1778650000101,
  "payload": {
    "clientId": "relay_abc",
    "text": "你好"
  }
}
```

但 provider 原始事件可能是：

```json
{
  "type": "content_block_delta",
  "delta": {
    "type": "text_delta",
    "text": "你好"
  },
  "index": 0
}
```

如果需要审计、调试或回放 provider 原始输出，当前数据库无法完整还原。

## 目标

在不影响前端、不影响 catchup、不改变现有 `raw_json` 语义的前提下，把 provider 原始 JSON 持久化到数据库。

非目标：

- 不新增 `agent.provider_raw` runtime event。
- 不改变 `agent.delta` / `agent.result` 的 event id 顺序。
- 不让前端消费 provider 原始 JSON。
- 不让 provider 原始 JSON 参与 chat catchup。
- 不改 `gateway_chat_messages.raw_json` 的现有语义。

## 设计定案

新增字段：

```sql
provider_raw_json MEDIUMTEXT NULL
```

字段位置：

```text
gateway_runtime_chats_events.provider_raw_json
```

保持现有字段语义不变：

```text
gateway_runtime_chats_events.raw_json = Tether 标准事件 JSON
gateway_runtime_chats_events.provider_raw_json = provider 原始 JSON
```

最终一行数据示例：

```text
session_id = tth_123
event_id   = 101
event_type = agent.delta
raw_json   = {"id":101,"sessionId":"tth_123","type":"agent.delta","payload":{"text":"你好"}}
provider_raw_json = NULL
```

默认不为 `agent.delta` 写 `provider_raw_json`。原因是 `agent.delta` 是按 streaming chunk 写入的，一次回复可能产生几十到几百行，chunk 级 provider raw 体积增长明显，审计价值也低。真正需要审计完整输出时，优先使用 `agent.result` / `agent.tool` 的 provider raw。

`agent.result` 示例：

```text
event_type = agent.result
raw_json = {"type":"agent.result","payload":{"text":"最终回答","usage":{"input_tokens":1,"output_tokens":2}}}
provider_raw_json = {"type":"result","result":"最终回答","usage":{"input_tokens":1,"output_tokens":2}}
```

## 为什么不用新增事件

不采用新增 `agent.provider_raw` event 的原因：

- 会增加额外 `event_id`，可能影响 catchup 的 `lastEventId` 推进。
- 如果过滤不严，可能被前端误消费。
- 会把标准事件和原始事件拆成两行，关联复杂。
- 数据行数会明显增加。

新增字段更稳定：

- 不改变现有 event 顺序。
- catchup 继续只读 `raw_json`。
- 前端继续只读标准 payload。
- 标准事件和 provider 原始事件在同一行，审计时容易关联。

## 数据流

1. Gateway chat runner 读取 provider stdout line。
2. Adapter `JSON.parse(line)` 得到 provider 原始 event。
3. Adapter 继续抽取标准字段，生成现有 `agent.delta` / `agent.result` / `agent.tool`。
4. 对需要审计的事件，把 provider 原始 event 作为内部字段 `providerRaw` 随标准事件传到 Relay。
5. 默认写入范围：
   - `agent.result`：写 `provider_raw_json`。
   - `agent.tool`：写 `provider_raw_json`。
   - `agent.delta`：默认不写 `provider_raw_json`，保持 NULL。
   - `user.message` / `agent.permission_request` / `session.error`：没有 provider raw，保持 NULL。
6. Relay 广播给前端时不带 `providerRaw`。当前 Relay 广播本来就是手工挑字段，不会自然透传 `providerRaw`。
7. Relay 同步 Server 时保留 `providerRaw`。
8. Server 写库时：
   - `raw_json` 写剥离 `providerRaw` 后的 Tether 标准 event。
   - `provider_raw_json` 单独写 `providerRaw`。

## 事件范围

| event_type | raw_json | provider_raw_json | 说明 |
| --- | --- | --- | --- |
| `agent.delta` | 写标准 Tether event | 默认 NULL | delta 是 chunk 级事件，默认不保存 provider raw，避免数据库膨胀 |
| `agent.result` | 写标准 Tether event | 写 provider 原始 result | 最有审计价值 |
| `agent.tool` | 写标准 Tether event | 写 provider 原始 tool event | 便于审计 tool input/result |
| `user.message` | 写标准 Tether event | NULL | 用户消息不是 provider stdout |
| `agent.permission_request` | 写标准 Tether event | NULL | Gateway 派生事件，不是 provider 原始输出审计目标 |
| `session.error` | 写标准 Tether event | NULL | Gateway 派生错误，除非后续明确需要 provider stderr/raw error |

`agent.delta` 如果未来需要排查 streaming 细节，可以另加开关保存 provider raw；当前默认不启用。

## TODO

- [x] `apps/server/sql/005-chat-runtime-events.sql`
  - [x] 给 `gateway_runtime_chats_events` 增加 `provider_raw_json MEDIUMTEXT NULL`。
  - [x] 使用幂等 migration，字段已存在时不重复添加。

- [x] `apps/gateway/src/chat/chat-session-runner.ts`
  - [x] `LineEmitter.delta()` 支持携带 `providerRaw`。
  - [x] `LineEmitter.result()` opts 支持携带 `providerRaw`。
  - [x] `tool` 支持携带 `providerRaw`。
  - [x] `ChatRunnerOptions.onDelta` / `onResult` / `onTool` 的事件参数支持携带可选 `providerRaw`。
  - [x] Claude / Codex / Copilot adapter 在解析原始 JSON 后，把 parsed event 作为 `providerRaw` 传下去。
  - [x] 默认不为 `agent.delta` 传 `providerRaw`，除非后续增加 debug 开关。
  - [x] 保持标准事件 payload 的 `text` / `usage` / `tool` 等字段不变。

- [x] `apps/gateway/src/chat/chat-runtime.ts`
  - [x] 内部发送 Relay event 时允许 payload 暂带 `providerRaw`。
  - [x] 不改变现有 `agent.delta` / `agent.result` 对前端需要的标准字段。
  - [x] 默认只在 `agent.result` / `agent.tool` payload 内部携带 `providerRaw`。

- [x] `apps/relay/src/relay.ts`
  - [x] 同步 Server 时保留 `providerRaw`。
  - [x] 确认当前广播给前端的 `agent.delta` / `agent.result` / `agent.tool` frame 不会透传 `providerRaw`；现有手工挑字段逻辑仍成立，不需要额外过滤代码。
  - [x] 确认 `agent.delta` 的独立 sync 路径和 `RUNTIME_EVENT_WHITELIST` 路径都不会丢失需要同步到 Server 的 `providerRaw`。
  - [x] chat catchup 继续只依赖 `raw_json` 的 `payload.text`，不读取 `provider_raw_json`。

- [x] `apps/server/app/service/runtimeSyncRepository.ts`
  - [x] `upsertChatRuntimeEvent()` 从 event payload 中提取 `providerRaw`。
  - [x] 写 `gateway_runtime_chats_events.raw_json` 前剥离 `providerRaw`，保持 `raw_json` 是干净的 Tether 标准 event。
  - [x] 将 `providerRaw` 经过 `maskPayload()` / `truncatePayload()` 后写入 `provider_raw_json`。
  - [x] 默认只为携带 `payload.providerRaw` 的事件写入 provider raw；当前 Gateway 默认只给 `agent.result` / `agent.tool` 携带。
  - [x] `agent.delta` 默认写 NULL。
  - [x] `user.message` / `agent.permission_request` / `session.error` 等没有 `payload.providerRaw` 的事件写 NULL。
  - [x] `gateway_chat_messages.raw_json` 保持现有逻辑，不写 provider raw。

- [x] 查询接口
  - [x] 暂不改普通聊天历史接口。
  - [x] 如需后台查看 provider raw，再单独扩展 admin/runtime event 查询返回 `provider_raw_json`。

## 验收项目

### 自动化验收

- [x] `pnpm --filter @tether/gateway typecheck` 通过。
- [x] `pnpm --filter @tether/relay typecheck` 通过。
- [x] `pnpm --filter @tether/server typecheck` 通过。
- [ ] `pnpm --filter @tether/server test -- runtime-sync.test.ts` 通过。
  - 当前阻塞：`apps/server/app/io/middleware/auth.js` / `auth.d.ts` 是未跟踪编译产物，和 `auth.ts` 同时被 Egg loader 加载，报 `can't overwrite property 'auth'`。清理编译产物后需要重跑。
- [x] Server 单测已补：`gateway_runtime_chats_events.provider_raw_json` 会写入 provider 原始 JSON。
- [x] Server 单测已补：`gateway_runtime_chats_events.raw_json` 不包含 `providerRaw`。
- [x] Server 单测已补：`agent.delta` 默认写 `provider_raw_json = NULL`。
- [x] Server 单测已补：`user.message` 没有 provider raw 时写 NULL。
- [x] Server 单测已补：`gateway_chat_messages.raw_json` 不写 provider raw。
- [x] Relay 单测：广播给前端的 `agent.result` 不包含 `providerRaw`。
- [x] Relay 单测：同步 Server 的 event 保留 `providerRaw`。
- [x] Gateway 单测：Claude provider 原始 result JSON 能进入标准事件的内部 `providerRaw`。
- [x] Gateway 单测：`agent.delta` 默认不携带 `providerRaw`。

### 人工 UAT

- [ ] 启动 Server / Relay / Gateway。
- [ ] 用 Claude 或 Codex chat 发送一条消息。
- [ ] 确认前端流式输出和最终消息显示正常。
- [ ] 查询 `gateway_runtime_chats_events`：

```sql
SELECT event_type, raw_json, provider_raw_json
FROM gateway_runtime_chats_events
WHERE session_id = '<session_id>'
ORDER BY event_id;
```

- [ ] 确认 `agent.delta` 行：
  - [ ] `raw_json` 是 Tether 标准事件。
  - [ ] `provider_raw_json` 默认是 NULL。
- [ ] 确认 `agent.result` 行：
  - [ ] `raw_json` 是 Tether 标准最终事件。
  - [ ] `provider_raw_json` 是 provider 原始 result JSON。
- [ ] 断网/刷新页面后重新进入同一个 chat。
- [ ] 确认 catchup 不受 `provider_raw_json` 影响，文本不会重复、丢失或乱序。

## 风险与边界

整体风险判断：中等偏低。该方案不新增 runtime event、不改变 `event_id` 顺序、不改前端协议，并保持 `raw_json` 现有语义；主要风险集中在数据库体积、敏感信息和实现时是否误污染现有事件。

- `provider_raw_json` 会增加数据库体积，尤其是 verbose provider 输出较多时；因此默认不保存 chunk 级 `agent.delta` provider raw。
- `provider_raw_json` 必须走现有敏感信息掩码和长度截断。
- 如果 provider 原始事件里包含大块 tool result，可能被截断；这是可接受的安全边界。
- 前端和 catchup 不应读取 `provider_raw_json`。
- `raw_json` 的现有语义必须保持不变，否则会影响历史 catchup 和消息派生。

关键防线：

- `provider_raw_json` 使用单独字段，不塞进 `raw_json`。
- `agent.delta` 默认写 NULL，避免 streaming chunk 级别膨胀。
- Server 写 `raw_json` 前剥离 `providerRaw`。
- Relay 广播给前端的 frame 不透传 `providerRaw`。
- Server / Relay / Gateway 三段链路都用单测锁住。
