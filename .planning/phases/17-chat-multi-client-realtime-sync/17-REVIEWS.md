---
phase: 17
reviewers: [codex]
reviewed_at: 2026-05-11T00:00:00Z
plans_reviewed:
  - 17-01-PLAN.md
  - 17-02-PLAN.md
  - 17-03-PLAN.md
---

# Cross-AI Plan Review — Phase 17

## Codex Review

## Summary

整体计划方向是对的：Relay 侧把 chat 从 1:1 owner 改成 1:N subscribers，Gateway 侧用 session 级 `chatInFlight` 拦住并发发送，测试也覆盖了广播、隔离、锁释放这些核心目标。最大问题不在架构，而在几个执行细节：`chatInFlight` 加锁位置如果照计划字面实现，可能在校验失败时泄漏锁；`client.permission_response` 当前缺少 Relay 侧账号/订阅校验，Phase 17 把 permission request 广播给多端后，这条写路径的安全边界必须补上；测试计划还需要更明确地覆盖锁泄漏和 permission 响应隔离。

## Strengths

- 目标边界清楚，明确不做队列、presence、草稿同步、超时兜底，避免把 Phase 17 扩成协作编辑系统。
- Relay 侧数据结构选择合理：`Map<sessionId, Set<clientId>>` 足够简单，符合当前在线 client 数量预期。
- 计划明确要求广播时逐个调用 `clientCanAccessSession`，符合 `CLAUDE.md` R3 多租户隔离要求。
- 保留 Phase 16 每个 client 独立 catch-up 的设计是正确的，不会让第二个客户端依赖第一个客户端的游标。
- Gateway 侧把并发锁放在 runner 启动入口，而不是 Relay 层，位置合理，因为真正的 runner 生命周期在 Gateway。
- 测试计划覆盖了同账号多端、跨账号隔离、断线清理、锁释放，方向完整。

## Concerns

- **HIGH — `chatInFlight` 加锁位置有锁泄漏风险。**
  Plan 17-02 强调在 `sessionId !== null` 分支顶部、`!frame.session` 之前检查。如果实现成"检查后立刻 `chatInFlight.add(sessionId)`"，后续 `missing_session_metadata`、`provider_not_supported` 这些早退路径会留下永久锁。正确做法是：顶部只做 `has` 拒绝；`add` 应放在所有同步校验通过之后、`runner.run()` 之前，或者所有校验失败路径都显式 `delete`。

- **HIGH — `runner.run()` 异常/Promise reject 没有明确释放锁。**
  当前调用形态是 `void runner.run(...)`。`run()` 内部可能在 `normalizeCwd`、`buildArgs`、`spawn` 参数错误等位置同步 throw 或返回 rejected promise；这些不一定走 `onError`。计划只写了 `onResult/onError/child.on(error/close)`，不够。需要 `void runner.run(...).catch(...)` 或包一层 `startChatRun()`，在 catch 中 `chatInFlight.delete(sessionId)` 并发送 `gateway.error`。

- **HIGH — `client.permission_response` 当前缺少 Relay 侧访问校验。**
  现有 Relay 对 `client.permission_response` 直接 `forwardToSessionGateway(...)`，没有 `clientCanAccessSession`，也没有确认该 client 订阅了这个 session。Phase 17 又要求 `agent.permission_request` 广播给所有订阅者，并允许在线 client 响应。这里必须把"任意在线 client"收紧为"同账号且有该 session 订阅的 client"，否则知道 sessionId 的跨账号 client 有机会向别人的 Gateway 发送 permission response。

- **MEDIUM — Plan 17-01 对 `session.error` 特殊分支需要更硬性说明。**
  当前 `session.error` 有 `else { sendEventToSubscribers(frame.event) }` fallback。改成 chat 广播后，这个 fallback 应删除或明确改写，否则可能出现 chat error 走 generic event 路径、重复发送，或和新广播语义不一致。

- **MEDIUM — 断线、unsubscribe、detach 清理逻辑建议抽 helper。**
  `Set.delete + empty Set delete key` 会出现在 close / unsubscribe / detach 至少三处。计划要求逐处改，但容易漏一处或实现不一致。这里抽一个很小的 `removeChatSubscriber(sessionId, clientId)` 更稳，不算过度抽象。

- **MEDIUM — 测试计划没有明确覆盖 permission response 隔离。**
  R4 要求新增路由/广播路径有多账号隔离测试。广播测试覆盖了输出不泄漏，但 permission response 是写路径，更危险。至少补一个"B 账号 client 向 A session 发 `client.permission_response` 不会转发到 A gateway"的测试。

- **MEDIUM — 锁释放测试需要覆盖失败早退路径。**
  现有 GW-T1~T3 覆盖 `chat_in_progress`、`agent.result` 后释放、`session.error` 后释放，但还应覆盖：`missing_session_metadata` 或 unsupported provider 后，同 session 下一次请求不会被误判 `chat_in_progress`。

- **LOW — `sendChatEventToSubscribers` 插入位置和说明有小不一致。**
  计划说 relay.ts 其他 helper "均为 const"，但当前附近 helper 多数是 `function` 声明。功能上问题不大，但建议跟现有 `sendEventToSubscribers` / `sendToClient` 一样用 `function`，放在 helper 区域，风格更一致。

- **LOW — `chat_in_progress` 协议类型无需改，但测试应确认 error shape。**
  `packages/protocol/src/index.ts` 里 `code: string`，不需要新增枚举。但测试应断言 Relay 客户端最终收到的是 `{ type: 'error', code: 'chat_in_progress' }`，Gateway 单测断言的是 `{ type: 'gateway.error' }`，两层都要清楚。

## Suggestions

- 把 Gateway 锁逻辑写成固定结构：

```ts
if (frame.sessionId !== null && chatInFlight.has(frame.sessionId)) {
  sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
  return;
}

// 校验 frame.session / runner 后：
chatInFlight.add(frame.sessionId);
void runner.run(...).catch((error) => {
  chatInFlight.delete(frame.sessionId);
  sendError(frame.clientId, frame.sessionId, 'chat_runner_failed', String(error));
});
```

- 在 Relay 增加 `removeChatSubscriber(sessionId, clientId)`，close / unsubscribe / detach 共用，确保空 Set 一定删 key。

- 给 `client.permission_response` 增加 Relay 侧校验：`clientCanAccessSession(clientScope, authMethod, frame.sessionId)`，并建议同时要求 `subscriptions.has(frame.sessionId)`。

- Plan 17-03 增补测试：
  - B 账号先连接，B client 发送 A session 的 `client.permission_response`，A gateway 不应收到。
  - `missing_session_metadata` 后再次发送同 session，不应返回 `chat_in_progress`。
  - `runner.run()` reject 后锁释放。
  - `agent.permission_request` 同账号两个 subscriber 都收到（T4 已有）。

- Relay 广播测试除了 `agent.delta`，建议至少覆盖一个 `agent.permission_request` 和一个 `session.error`。

## Risk Assessment

**整体风险：MEDIUM。**

方案主轴简单，改动面也集中，能达成 Phase 17 目标；但这次触碰的是多租户 Relay 路由和 Gateway 执行锁，错误不是"某端少收一条消息"这么简单。真正需要卡住的是三点：广播逐 client 账号过滤、permission response 写路径隔离、`chatInFlight` 所有早退/异常路径释放。把这三点补进计划和测试后，风险可以降到 LOW-MEDIUM。

---

## Consensus Summary

单一评审者（Codex），无需跨评审者共识比较。

### Key Findings

**3 HIGH 问题（执行前建议处理）：**
1. **锁泄漏**：`chatInFlight.add` 必须在所有校验通过后执行，不能在 `!frame.session` / `!runner` 早退路径之前执行
2. **runner.run() reject 未兜底**：`void runner.run()` 需改为 `.catch()` 处理 Promise 拒绝，在 catch 中释放锁
3. **permission_response 写路径无账号校验**：Relay 转发 `client.permission_response` 前必须验证 client 有该 session 的访问权限

**2 MEDIUM 问题（测试补充）：**
1. 补测 permission_response 跨账号隔离
2. 补测早退路径后锁不泄漏

### Risk Level

**MEDIUM** — 核心架构正确，需要在执行阶段确保锁生命周期和 permission_response 访问控制的正确性。
