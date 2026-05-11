# Phase 17: Chat Multi-client Realtime Sync - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

让多个已认证 client 可以同时订阅同一个 chat session，实时收到相同的 `agent.delta` / `agent.result` / `agent.tool` / `session.error` / `agent.permission_request` 输出；同时禁止同一 session 并发发送——第二个发送请求立即返回 `chat_in_progress` 错误。

具体交付：
1. Relay 将 `chatSessionOwners`（1:1）替换为 `chatSessionSubscribers`（1:N），所有 chat 事件按 session 广播给所有订阅者
2. Gateway 移除 `chatClientBindings` Map，Relay 不再依赖 event payload 里的 `clientId` 做路由
3. Gateway relay-client.ts 增加 `chatInFlight: Set<string>` session 级 in-flight 锁，并发第二个 `client.chat` 立即返回错误
4. 补 Relay 多端广播测试（两个 client 都收到 delta/result）
5. 补 Gateway 并发发送测试（第二个发送返回 chat_in_progress）

**明确不在本阶段内：**
- 消息排队（暂不做）
- 多端同时发送并行执行（明确拒绝）
- 多端编辑同一草稿输入框同步
- 在线状态（presence）/ "谁正在输入"
- `gateway_chat_messages` 历史读取方式不变
- in-flight 锁超时兜底（后续优化）

</domain>

<decisions>
## Implementation Decisions

### Relay 订阅者数据结构

- **D-01:** 将 `chatSessionOwners: Map<string, string>`（sessionId→clientId，1:1）替换为 `chatSessionSubscribers: Map<string, Set<string>>`（sessionId→Set\<clientId\>，1:N）。
- **D-02:** `client.subscribe` 时执行 `Set.add(clientId)`；client 断线或取消订阅时执行 `Set.delete(clientId)`，若 Set 变空则同时删除该 sessionId 的 key（防止内存泄漏）。
- **D-03:** 广播 chat 事件时，遍历 `chatSessionSubscribers.get(sessionId)` 里的所有 clientId，并通过 `clientCanAccessSession` 做账号校验过滤后再 `sendToClient`。不满足账号校验的 clientId 跳过，不报错。
- **D-04:** 每个 subscriber 独立触发自己的 catch-up（Phase 16 D-13 逻辑不变）。第二个 client subscribe 时携带自己的 `after=lastDeltaEventId`，Relay 单独给它补齐缺口 delta，不影响其他订阅者。

### Gateway chatClientBindings 移除

- **D-05:** 移除 `chatClientBindings: Map<string, string>`（relay-client.ts L72）。Gateway 不再维护此 Map，也不再在 event payload 里注入从 Map 读取的 `clientId` 进行路由。
- **D-06:** event payload 里的 `clientId` 字段继续保留（用于日志/追踪/调试），但 Relay 不再读它做路由决策——路由完全依赖 `chatSessionSubscribers`。
- **D-07:** `agent.permission_request` 和其他 chat 事件（delta/result/tool/error）同样广播给所有订阅者，不单独点发给发起方。任意在线端均可响应 permission_request。

### Gateway in-flight 锁

- **D-08:** in-flight 锁实现为 `chatInFlight: Set<string>`（存 sessionId），在 relay-client.ts `client.chat` case 最顶部检查。
- **D-09:** 检查到 `chatInFlight.has(sessionId)` 时，调用 `sendError(frame.clientId, sessionId, 'chat_in_progress', '当前会话正在回复中')`，`break` 不启动 runner。
- **D-10:** `chatInFlight.add(sessionId)` 在通过检查后、启动 runner 之前执行。
- **D-11:** 锁释放时机三选一：`agent.result` 发出后、`session.error` 发出后、runner 子进程异常退出后。第一版不加超时兜底——超时属于后续优化。

### Runtime stderr 与前端渲染

- **D-12:** `chat_runner_stderr` 属于 runner/runtime 诊断事件，不等价于当前 assistant 回复失败。前端不能因为收到 `type: "error"` 且 `code: "chat_runner_stderr"` 就立刻显示 `Reply lost`。
- **D-13:** 当前 turn 已收到 `agent.delta` 后，后续即使出现 stderr 诊断事件，也必须继续渲染后续 `agent.delta` / `agent.result`。
- **D-14:** `Reply lost` 只应在“没有收到任何 `agent.delta` / `agent.result`，并且出现明确 fatal / disconnect / timeout”时显示。若已有部分 delta，失败时应保留已有内容并标记“回复中断”或等价状态。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 设计文档（主要参考）
- `docs/working/2026-05-11-chat-multi-client-realtime.md` — 完整设计：问题分析、目标边界、C1-C6 改动点、TODO 清单、UAT1-UAT6 验收项。**MUST read first.**

### 关联阶段设计文档（边界参考）
- `docs/working/2026-05-11-chat-runtime-raw-events.md` — Phase 16 设计，含 catch-up 机制（D-13/D-17）；Phase 17 的多订阅者 catch-up 依赖此设计不改变。

### 现有 Relay 代码（改动目标）
- `apps/relay/src/relay.ts` — `chatSessionOwners`（L176）替换为 `chatSessionSubscribers`；L387-487 所有 chat 事件 handler 改为广播；L692-693 断线清理改为 Set 操作。

### 现有 Gateway 代码（改动目标）
- `apps/gateway/src/relay-client.ts` — `chatClientBindings`（L72）整体删除；`client.chat` case 顶部新增 `chatInFlight` 检查；runner 回调中新增锁释放。

### 协议类型
- `packages/protocol/src/index.ts` — `RelayFrame` 判别联合类型，若 error frame 需要新增 `chat_in_progress` code 则在此更新。

### 项目规范
- `CLAUDE.md` — Relay 多租户隔离规范（R1-R4 强制规则）；**R3 广播必须过滤账号**，`chatSessionSubscribers` 遍历时必须遵守。

### 先验 Phase 上下文
- `.planning/phases/16-chat-runtime-raw-events/16-CONTEXT.md` — Phase 16 catch-up 决策（D-12~D-17），Phase 17 不改变这些决策。
- `.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md` — `RelayToGatewayChatFrame` 结构（D-01），`clientId` 字段来源。

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `clientCanSeeRelaySession` / `clientCanAccessSession`（relay.ts）— 现有账号校验函数，`chatSessionSubscribers` 遍历广播时直接复用，确保多租户隔离。
- `sendToClient`（relay.ts）— 现有单播工具，广播循环内仍调用它，只是循环对象从单个 clientId 改为 Set。
- `subscriptions: Map<string, RelayClientMode>`（relay.ts per client）— 每个 client 已知道自己订阅了哪些 session；在 `client.unsubscribe` 和断线时，同步从 `chatSessionSubscribers` 里删除对应 clientId。

### Established Patterns
- `broadcastGatewayUnavailableForScope`（relay.ts）— 按账号过滤广播的现有模式，`chatSessionSubscribers` 遍历应遵循相同模式（先 get Set，再过滤 accountId，再 sendToClient）。
- Phase 16 catch-up 触发（relay.ts `client.subscribe` for chat session）— Phase 17 在 subscribe 后追加 `chatSessionSubscribers.get(sessionId).add(clientId)` 即可，catch-up 逻辑（`frame.after → fetchCatchUp → gateway.chat-catchup`）不变。
- `chatInFlight` 的 add/delete 模式与现有 `chatSessionOwners.set/delete` 同位置，替换逻辑清晰。

### Integration Points
- relay.ts L765：`chatSessionOwners.set(frame.sessionId, clientId)` → 改为 Set.add
- relay.ts L692-693：`chatSessionOwners.delete(sessionId)` → 改为 Set.delete + 空 Set 清 key
- relay.ts L387-487：5处 `sendToClient(clientId, ...)` chat 事件发送 → 改为遍历 Set 广播
- relay-client.ts L72：`chatClientBindings` 声明和所有引用（L81/86/96/101/105/117/125/135/143/515/756-757/766）→ 全部删除
- relay-client.ts `client.chat` case 入口：新增 `chatInFlight` 检查 + runner 回调中 delete

</code_context>

<specifics>
## Specific Ideas

### 广播函数抽象
工作文档建议抽出 `sendChatEventToSubscribers(sessionId, frame)` 辅助函数，内部遍历 `chatSessionSubscribers.get(sessionId)`，统一处理账号校验和 sendToClient。这样 L387-487 五处 handler 改动最小，每处只需把原来的 `if (clientId) sendToClient(clientId, ...)` 替换为 `sendChatEventToSubscribers(sessionId, ...)` 调用。

### 错误码
`chat_in_progress` 是本阶段新增错误码。如果 protocol 包的 error frame 类型有枚举约束，需同步更新；若是 `string` 类型则无需修改。

### 前端 Reply lost 判定
实测同一轮回复中可能先收到 `chat_runner_stderr`，随后继续收到 `agent.delta`。因此前端应把 `chat_runner_stderr` 记录到 raw events / debug 面板，最多显示非阻断 warning；它不能关闭当前 assistant bubble，也不能阻止后续 delta append。

### 测试模板（来自 CLAUDE.md R4）
两个账号的 Gateway 都连接，B 账号的 Gateway 先连，验证 A 账号的广播不泄漏到 B 的 client（反之亦然）。多端广播测试也要覆盖同账号两个 client 都能收到 delta/result。

</specifics>

<deferred>
## Deferred Ideas

- **消息排队**：工作文档明确暂不做，并发第二个请求直接拒绝
- **多端同时编辑草稿同步**：独立需求，不在本阶段
- **在线状态 / presence**：谁正在输入，后续阶段
- **in-flight 锁超时兜底**：防止进程崩溃后锁永不释放，设计文档标注为后续优化，第一版用子进程生命周期兜底

</deferred>

---

*Phase: 17-Chat Multi-client Realtime Sync*
*Context gathered: 2026-05-11*
