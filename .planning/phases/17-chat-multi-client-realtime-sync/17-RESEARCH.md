# Phase 17: Chat Multi-client Realtime Sync - Research

**Researched:** 2026-05-11
**Domain:** Relay WebSocket routing / Gateway in-flight concurrency control
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Relay 订阅者数据结构**
- D-01: 将 `chatSessionOwners: Map<string, string>`（sessionId→clientId，1:1）替换为 `chatSessionSubscribers: Map<string, Set<string>>`（sessionId→Set<clientId>，1:N）。
- D-02: `client.subscribe` 时执行 `Set.add(clientId)`；client 断线或取消订阅时执行 `Set.delete(clientId)`，若 Set 变空则同时删除该 sessionId 的 key（防止内存泄漏）。
- D-03: 广播 chat 事件时，遍历 `chatSessionSubscribers.get(sessionId)` 里的所有 clientId，并通过 `clientCanAccessSession` 做账号校验过滤后再 `sendToClient`。不满足账号校验的 clientId 跳过，不报错。
- D-04: 每个 subscriber 独立触发自己的 catch-up（Phase 16 D-13 逻辑不变）。第二个 client subscribe 时携带自己的 `after=lastDeltaEventId`，Relay 单独给它补齐缺口 delta，不影响其他订阅者。

**Gateway chatClientBindings 移除**
- D-05: 移除 `chatClientBindings: Map<string, string>`（relay-client.ts L72）。Gateway 不再维护此 Map，也不再在 event payload 里注入从 Map 读取的 `clientId` 进行路由。
- D-06: event payload 里的 `clientId` 字段继续保留（用于日志/追踪/调试），但 Relay 不再读它做路由决策——路由完全依赖 `chatSessionSubscribers`。
- D-07: `agent.permission_request` 和其他 chat 事件（delta/result/tool/error）同样广播给所有订阅者，不单独点发给发起方。任意在线端均可响应 permission_request。

**Gateway in-flight 锁**
- D-08: in-flight 锁实现为 `chatInFlight: Set<string>`（存 sessionId），在 relay-client.ts `client.chat` case 最顶部检查。
- D-09: 检查到 `chatInFlight.has(sessionId)` 时，调用 `sendError(frame.clientId, sessionId, 'chat_in_progress', '当前会话正在回复中')`，`break` 不启动 runner。
- D-10: `chatInFlight.add(sessionId)` 在通过检查后、启动 runner 之前执行。
- D-11: 锁释放时机三选一：`agent.result` 发出后、`session.error` 发出后、runner 子进程异常退出后。第一版不加超时兜底。

### Claude's Discretion

无（所有关键决策已锁定）

### Deferred Ideas (OUT OF SCOPE)

- 消息排队（并发第二个请求直接拒绝）
- 多端同时编辑草稿同步
- 在线状态 / presence（谁正在输入）
- in-flight 锁超时兜底
</user_constraints>

---

## Summary

Phase 17 是一次**精准外科手术**：把 Relay 侧的 1:1 chat routing 改为 1:N 广播，同时在 Gateway 侧加 session 级并发锁。所有改动集中在两个文件（`relay.ts` 和 `relay-client.ts`）加测试。

从代码库阅读已完整确认所有改动点。当前 `chatSessionOwners: Map<string, string>` 位于 relay.ts L193，所有 5 处 chat 事件的发送（agent.delta/result/tool/permission_request/session.error）均从 `chatSessionOwners.get(sessionId)` 读出单个 clientId 后点发。`chatClientBindings: Map<string, string>` 位于 relay-client.ts L72，在 13 处被引用。两者都是本阶段的替换目标。

改动规模小、边界清晰、不引入新依赖，核心风险在于：(1) 广播时漏掉账号隔离校验；(2) in-flight 锁的释放路径覆盖不全。

**Primary recommendation:** 先抽出 `sendChatEventToSubscribers(sessionId, frame)` 辅助函数，再统一替换 5 处发送点，最后处理 in-flight 锁和测试。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chat 事件广播路由 | Relay（apps/relay） | — | Relay 持有所有 client 连接，是唯一能做 1:N 广播的组件 |
| 多订阅者 Set 管理 | Relay（apps/relay） | — | chatSessionSubscribers 生命周期绑定 client 连接，在 Relay 闭包内 |
| In-flight 并发锁 | Gateway（apps/gateway） | — | chat runner 在 Gateway 运行，锁要守在 runner 启动入口 |
| Catch-up 补偿逻辑 | Relay（apps/relay） | Server（apps/server） | Relay 发起请求，Server 返回历史 delta；Phase 16 已完成，本阶段不变 |
| 账号隔离过滤 | Relay（apps/relay） | — | clientCanAccessSession 复用，广播循环内每个 subscriber 独立校验 |
| 错误回包（chat_in_progress） | Gateway（apps/gateway） | — | sendError 通过 gateway.error 帧回传，Relay 转发给对应 client |

---

## Standard Stack

本阶段无新增依赖，全部使用已有基础设施。

### 核心模块（已有，直接复用）

| Module | File | 用途 | 本阶段操作 |
|--------|------|------|-----------|
| `chatSessionOwners` | relay.ts L193 | 1:1 routing | **替换**为 `chatSessionSubscribers: Map<string, Set<string>>` |
| `sendToClient` | relay.ts L1189 | 单播 | 广播循环内继续调用 |
| `clientCanAccessSession` | relay.ts L1159 | 账号校验 | 广播循环内每个 subscriber 调用一次 |
| `broadcastGatewayUnavailableForScope` | relay.ts L1110 | 按账号广播模式 | 作为广播实现的参考模式 |
| `chatClientBindings` | relay-client.ts L72 | Gateway 单值绑定 | **整体删除** |
| `sendError` | relay-client.ts L741 | 错误回包 | in-flight 拒绝时调用 |
| `subscriptions: Map<string, RelaySubscription>` | relay-client.ts L71 | Gateway 订阅记录 | unsubscribe 时同步清 chatClientBindings（变为 chatInFlight 不受影响） |

---

## Architecture Patterns

### 系统数据流（Phase 17 改动后）

```
Client A ──subscribe──▶ Relay: chatSessionSubscribers.set(sessionId, {A})
Client B ──subscribe──▶ Relay: chatSessionSubscribers.set(sessionId, {A, B})
                         ↓ 每个 subscriber 独立 catch-up

Client A ──chat──▶ Relay ──client.chat──▶ Gateway
                             ↓ chatInFlight.has(sessionId)?
                             ├── YES: sendError(chat_in_progress) → Relay → Client A
                             └── NO:  chatInFlight.add(sessionId) → runner.run()

Gateway ──agent.delta──▶ Relay: sendChatEventToSubscribers(sessionId)
                              ├──▶ clientCanAccessSession(A)? → sendToClient(A)
                              └──▶ clientCanAccessSession(B)? → sendToClient(B)

Gateway ──agent.result──▶ Relay: broadcast to subscribers
                          ↑ + chatInFlight.delete(sessionId) in Gateway
```

### Pattern 1: sendChatEventToSubscribers 辅助函数

**What:** 将原来 5 处 `sendToClient(clientId, frame)` 统一替换为一个广播函数。
**When to use:** 所有 agent.delta / agent.result / agent.tool / agent.permission_request / session.error。

```typescript
// Source: VERIFIED — codebase grep + CONTEXT.md D-03
function sendChatEventToSubscribers(sessionId: string, frame: RelayServerToClientFrame): void {
  const subscribers = chatSessionSubscribers.get(sessionId);
  if (!subscribers) return;
  for (const subscriberId of subscribers) {
    const client = clients.get(subscriberId);
    if (!client) continue;
    if (!clientCanAccessSession(client.scope, client.authMethod, sessionId)) continue;
    sendToClient(subscriberId, frame);
  }
}
```

### Pattern 2: chatSessionSubscribers 生命周期管理

```typescript
// subscribe 时加入 Set
// Source: VERIFIED — relay.ts L793-794 (chatSessionOwners.set 的替换目标)
const subscribers = chatSessionSubscribers.get(sessionId) ?? new Set<string>();
subscribers.add(clientId);
chatSessionSubscribers.set(sessionId, subscribers);

// 断线 / unsubscribe 时移除，空 Set 删 key（D-02）
// Source: VERIFIED — relay.ts L721-724 (chatSessionOwners.delete 的替换目标)
const subscribers = chatSessionSubscribers.get(sessionId);
if (subscribers) {
  subscribers.delete(clientId);
  if (subscribers.size === 0) chatSessionSubscribers.delete(sessionId);
}
```

### Pattern 3: chatInFlight 锁（Gateway 侧）

```typescript
// Source: VERIFIED — relay-client.ts L351-407 (client.chat case)
case 'client.chat': {
  if (frame.sessionId !== null) {
    // in-flight 检查最顶部（D-08, D-09）
    if (chatInFlight.has(frame.sessionId)) {
      sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
      return;
    }
    chatInFlight.add(frame.sessionId);  // D-10: 加锁在启动 runner 之前
  }
  // ... runner.run() ...
}

// 锁释放点（D-11）：在 chatRunnerOptions 的 onResult / onError 回调中
onResult: ({ sessionId, ... }) => {
  chatInFlight.delete(sessionId);  // 释放
  sendChatEvent(...);
},
onError: ({ sessionId, ... }) => {
  chatInFlight.delete(sessionId);  // 释放
  sendChatEvent(...);
},
```

### Pattern 4: 参照 broadcastGatewayUnavailableForScope 的账号过滤模式

```typescript
// Source: VERIFIED — relay.ts L1110-1117 (已有按账号过滤广播的模式)
function broadcastGatewayUnavailableForScope(gatewayId: string, gatewayScope: RelayAuthScope): void {
  for (const client of clients.values()) {
    if (!clientCanUseGateway(client.scope, gatewayScope)) continue;
    if (client.gatewayId && client.gatewayId !== gatewayId) continue;
    sendToSocket<RelayServerToClientFrame>(client.socket, { ... });
  }
}
```

`sendChatEventToSubscribers` 使用相同模式：遍历 Set，每个 subscriber 独立做 `clientCanAccessSession` 校验。

### Anti-Patterns to Avoid

- **不要广播前不做账号校验**：`chatSessionSubscribers` 遍历时必须对每个 subscriberId 调用 `clientCanAccessSession`，CLAUDE.md R3 强制要求。
- **不要在 sendChatEventToSubscribers 里直接用 clientId 回退**：路由完全依赖 Set，不能有"找不到 subscriber 则用 payload.clientId 兜底"的逻辑（D-06）。
- **不要在 session.error 既走广播又走 sendEventToSubscribers**：当前代码 relay.ts L467-479 有一个 `else { sendEventToSubscribers(frame.event); }` 兜底，改为广播后这个 else 分支需要同时处理或移除。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 账号隔离过滤 | 自定义账号比对逻辑 | `clientCanAccessSession`（relay.ts L1159） | 已有完整实现，包含 ws_ticket/scope 校验 |
| 广播循环 | 复杂的订阅总线 | 直接遍历 Set + sendToClient | 数量小（同一 session 同时在线 client 通常 < 5），无需复杂机制 |
| 错误回包 | 新增帧类型 | `sendError`（relay-client.ts L741）→ `gateway.error` 帧 | 已有完整路径，`chat_in_progress` 只是新 code，不是新帧类型 |

---

## Runtime State Inventory

> Phase 17 是纯代码改动，不涉及 rename/refactor，此 section 跳过。
> SKIPPED — 无 rename/refactor，无运行时存储状态需要迁移。

---

## Common Pitfalls

### Pitfall 1: session.error 分支有 else 分支兜底

**What goes wrong:** relay.ts L467-479 的 session.error handler 有一个 `else { sendEventToSubscribers(frame.event) }`。如果只替换顶部的 `sendToClient` 而忘记处理这个 else，`session.error` 会走两条路径或走错路径。
**Why it happens:** 改完主路径后看似完成，遗漏 else 条件。
**How to avoid:** `sendChatEventToSubscribers` 统一接管 session.error 的 if/else，删除原 else 分支。

### Pitfall 2: chatInFlight 在 sessionId=null 时不应检查

**What goes wrong:** `client.chat` case 中 `sessionId === null` 是新建 session 的路径，此时没有 sessionId 可用于 in-flight 检查。若代码不区分，会 `chatInFlight.has(null)` 静默通过或报错。
**Why it happens:** 两条路径（新建 vs 继续已有 session）共用同一个 case，容易混淆。
**How to avoid:** in-flight 检查的 if 块只在 `frame.sessionId !== null` 的分支内执行（参考 relay-client.ts L352 已有的 `if (frame.sessionId === null)` 分叉）。

### Pitfall 3: chatClientBindings 删除后 onChatSessionCreated 遗漏

**What goes wrong:** relay-client.ts L86 的 `onChatSessionCreated` 回调也调用了 `chatClientBindings.set(metadata.id, clientId)`。删除 Map 声明后，若遗漏此处引用，会有编译错误或运行时引用已删除 Map 的风险。
**Why it happens:** chatClientBindings 有 13 处引用，容易遗漏某几处。
**How to avoid:** 用 `grep -n "chatClientBindings"` 枚举所有引用，逐一确认删除或替换为 clientId 保留日志逻辑。

### Pitfall 4: 断线清理只清 chatSessionOwners，漏清 chatSessionSubscribers

**What goes wrong:** relay.ts L721-724 的 close handler 当前是 `for (const [sessionId, ownerId] of chatSessionOwners) { if (ownerId === clientId) chatSessionOwners.delete(sessionId) }`，改为 Set 后逻辑完全不同。若按旧逻辑照搬，Set 里的 clientId 永远不会被清除，导致 subscriber 僵尸和内存泄漏。
**Why it happens:** 直接 copy-edit 原有 close handler，没有重写逻辑。
**How to avoid:** close handler 改为：遍历 `client.subscriptions` 的 sessionId，对每个 sessionId 调用 `chatSessionSubscribers.get(id)?.delete(clientId)`，空 Set 删 key。

### Pitfall 5: unsubscribe/detach 清理遗漏

**What goes wrong:** relay.ts L984-1010 中 `client.unsubscribe` 和 `client.detach` 都有 `if (chatSessionOwners.get(frame.sessionId) === clientId) { chatSessionOwners.delete(frame.sessionId) }` 的逻辑，这两处需要同时改为 Set 操作，否则订阅者在显式退订后仍留在 Set 里。
**How to avoid:** 搜索 `chatSessionOwners` 的所有引用（relay.ts 共 6 处），逐一替换为 Set 操作。

---

## Code Examples

### 改动前 → 改动后对照（relay.ts 核心改动）

```typescript
// 改动前（relay.ts L193，单值 Map）
const chatSessionOwners = new Map<string, string>(); // sessionId → clientId

// 改动后（D-01）
const chatSessionSubscribers = new Map<string, Set<string>>(); // sessionId → Set<clientId>
```

```typescript
// 改动前（relay.ts L403-413，agent.delta 单播）
// Source: VERIFIED — relay.ts L403-413
const clientId = chatSessionOwners.get(frame.event.sessionId)
  ?? (typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined);
if (clientId) {
  sendToClient(clientId, { type: 'agent.delta', ... });
}

// 改动后（使用 sendChatEventToSubscribers，D-03）
sendChatEventToSubscribers(frame.event.sessionId, { type: 'agent.delta', ... });
```

```typescript
// 改动前（relay.ts L793-794，subscribe 单写）
// Source: VERIFIED — relay.ts L793-794
if (session.transport === 'chat') {
  chatSessionOwners.set(frame.sessionId, clientId);
  // ... catch-up logic ...
}

// 改动后（D-01/D-02）
if (session.transport === 'chat') {
  const subs = chatSessionSubscribers.get(frame.sessionId) ?? new Set<string>();
  subs.add(clientId);
  chatSessionSubscribers.set(frame.sessionId, subs);
  // ... catch-up logic（原有 Phase 16 逻辑不变）...
}
```

```typescript
// 改动前（relay.ts L721-724，断线清理）
// Source: VERIFIED — relay.ts L721-724
for (const [sessionId, ownerId] of chatSessionOwners) {
  if (ownerId === clientId) chatSessionOwners.delete(sessionId);
}

// 改动后（D-02）
for (const [sessionId, subs] of chatSessionSubscribers) {
  subs.delete(clientId);
  if (subs.size === 0) chatSessionSubscribers.delete(sessionId);
}
```

---

## Relay 侧全量改动点清单

从代码阅读确认，relay.ts 中所有 `chatSessionOwners` 引用位置如下：

| 行号（当前）| 操作类型 | 改动方向 |
|------------|---------|---------|
| L193 | 声明 | 替换为 `chatSessionSubscribers: Map<string, Set<string>>` |
| L403-413 | agent.delta 发送 | 改为 `sendChatEventToSubscribers` |
| L424-451 | agent.result 发送 | 改为 `sendChatEventToSubscribers` |
| L453-465 | agent.permission_request 发送 | 改为 `sendChatEventToSubscribers` |
| L466-479 | session.error 发送 | 改为 `sendChatEventToSubscribers`（含 else 分支清理）|
| L480-495 | agent.tool 发送 | 改为 `sendChatEventToSubscribers` |
| L524-532 | syncToServer transport 判断 | `chatSessionOwners.has` → `chatSessionSubscribers.has` |
| L721-724 | 断线清理 | 改为 Set.delete + 空 Set 删 key |
| L793-794 | subscribe 时写入 | 改为 Set.add |
| L984-996 | unsubscribe 清理 | 改为 Set.delete + 空 Set 删 key |
| L1003-1010 | detach 清理 | 同上 |

## Gateway 侧全量改动点清单

relay-client.ts 中所有 `chatClientBindings` 引用（13 处）全部删除：

| 行号（当前）| 改动 |
|------------|------|
| L72 | 删除 Map 声明 |
| L81, L86 | `onSessionCreated` / `onChatSessionCreated` 回调中删除 `set` 调用（clientId 参数保留用于日志）|
| L96, L101, L105, L117, L125, L135, L143 | 所有 `chatClientBindings.get(sessionId) ?? clientId` 改为直接 `clientId` |
| L515 | `subscribeClient` 中 `chatClientBindings.set(sessionId, clientId)` 删除 |
| L756-757 | `removeSubscription` 中清理逻辑删除 |
| L766 | `clearSubscriptions` 中 `chatClientBindings.clear()` 删除 |

新增：
- L72 附近：`const chatInFlight = new Set<string>();`
- `client.chat` case（sessionId !== null 分支顶部）：in-flight 检查 + add
- `chatRunnerOptions.onResult`：`chatInFlight.delete(sessionId)`
- `chatRunnerOptions.onError`：`chatInFlight.delete(sessionId)`
- runner 子进程异常退出兜底（参考现有 onError 回调位置）

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-----------------|--------------|--------|
| chatSessionOwners: 1:1 routing | chatSessionSubscribers: 1:N broadcast | Phase 17 | 多端实时一致 |
| chatClientBindings 决定唯一观看者 | Gateway 只注入 clientId 用于日志 | Phase 17 | Gateway 不再是路由瓶颈 |

---

## Assumptions Log

> 所有关键事实均通过代码库直接验证，无 [ASSUMED] 标记。

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

**所有 claims 均为 VERIFIED（直接读取 relay.ts / relay-client.ts / protocol/src/index.ts 确认）。**

---

## Open Questions (RESOLVED)

1. **`client.chat` for sessionId=null 时，runner 完成后是否需要加锁**
   - What we know: sessionId=null 是新建 session 的路径，runner 完成时会触发 `onChatSessionCreated`，此时才有 sessionId。
   - What's unclear: 是否需要在新建路径也加 in-flight 锁，防止同一 provider 重复新建。
   - RESOLVED: 从 CONTEXT.md 看，in-flight 锁 D-08 明确是 `client.chat` case 最顶部，且 `frame.sessionId !== null` 的分支。新建路径（null）不加锁，保持当前行为。这与 D-09 的描述一致。

2. **`syncToServer` transport 判断从 `chatSessionOwners.has` 改为 `chatSessionSubscribers.has` 后语义不变**
   - What we know: relay.ts L524-532 用 `chatSessionOwners.has(frame.event.sessionId)` 判断是否是 chat 事件，决定是否加 `transport: 'chat'`。
   - What's unclear: 换为 Set 后逻辑相同（has 返回 true 即有订阅者）。
   - RESOLVED: 直接替换 `.has` 调用，语义等价。

---

## Environment Availability

> Step 2.6: SKIPPED — 纯代码逻辑改动，无外部依赖或 CLI 工具需要验证。

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test（内置）|
| Relay config | `apps/relay/package.json` → `"test": "node --test test/**/*.test.ts --experimental-strip-types"` |
| Gateway config | `apps/gateway/package.json` → 同上 |
| Quick run (relay) | `pnpm --filter @tether/relay test` |
| Quick run (gateway) | `pnpm --filter @tether/gateway test` |
| Typecheck | `pnpm --filter @tether/relay typecheck && pnpm --filter @tether/gateway typecheck` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| C1/D-01~D-03 | 同账号两个 client 都收到 agent.delta/result | integration | `pnpm --filter @tether/relay test` | ❌ Wave 0 |
| C1/D-03 | 跨账号广播隔离（B client 收不到 A 的 delta） | integration | `pnpm --filter @tether/relay test` | ❌ Wave 0 |
| C3/D-08~D-11 | in-flight 锁：第二个 chat 返回 chat_in_progress | integration | `pnpm --filter @tether/gateway test` | ❌ Wave 0 |
| C3/D-11 | 锁释放：result 后可以继续发送 | integration | `pnpm --filter @tether/gateway test` | ❌ Wave 0 |
| D-02 | 断线清理：disconnect 后 subscriber Set 被清除 | integration | `pnpm --filter @tether/relay test` | ❌ Wave 0 |
| D-07 | permission_request 广播到所有订阅者 | integration | `pnpm --filter @tether/relay test` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter @tether/relay test && pnpm --filter @tether/relay typecheck`
- **Per wave merge:** 上述 + `pnpm --filter @tether/gateway test && pnpm --filter @tether/gateway typecheck && pnpm --filter @tether/web typecheck`
- **Phase gate:** 全部绿，含 protocol typecheck

### Wave 0 Gaps

新增测试文件（在现有 `relay.test.ts` 末尾追加）：

- [ ] `Phase17-T1: relay broadcasts agent.delta to all chat subscribers (same account)`
- [ ] `Phase17-T2: relay does not leak chat delta to other-account subscriber`
- [ ] `Phase17-T3: relay broadcasts agent.result to all chat subscribers`
- [ ] `Phase17-T4: relay broadcasts agent.permission_request to all chat subscribers`
- [ ] `Phase17-T5: relay cleans up subscriber set on client disconnect`
- [ ] `Phase17-T6: relay cleans up subscriber set on client.unsubscribe`

新增 Gateway 测试（在现有 `chat-session-runner.test.ts` 或新建 `relay-client-inflight.test.ts`）：

- [ ] `Phase17-GW-T1: second chat to same session returns chat_in_progress`
- [ ] `Phase17-GW-T2: lock releases after agent.result, next chat accepted`
- [ ] `Phase17-GW-T3: lock releases after session.error`

*(现有 `relay.test.ts` Phase16 多账号测试框架（L1927-L2033）可作为 Phase17 隔离测试的模板)*

---

## Security Domain

### Applicable ASVS Categories（ASVS Level 1）

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — WebSocket 鉴权已由 Phase 5 完成 | — |
| V3 Session Management | partial — subscriber Set 生命周期 | client 断线时删除 subscriber（D-02），防僵尸 |
| V4 Access Control | **yes** | `clientCanAccessSession` 在广播循环中每个 subscriber 独立校验（CLAUDE.md R3）|
| V5 Input Validation | no | chat frame 结构校验已有 |
| V6 Cryptography | no | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 跨账号事件泄漏 | Information Disclosure | `clientCanAccessSession` per-subscriber 校验（已有，复用）|
| Subscriber 僵尸内存泄漏 | Denial of Service | 断线/unsubscribe/detach 三路径清理（D-02）|
| 并发 chat runner 竞争 | Tampering | `chatInFlight` Set 级锁（D-08~D-11）|

**CLAUDE.md R3 强制规则：** `chatSessionSubscribers` 遍历时必须用 `clientCanAccessSession` 过滤账号，禁止向所有 subscriber 无差别广播。

---

## Sources

### Primary (HIGH confidence — directly verified from codebase)

- `apps/relay/src/relay.ts` — 完整阅读（L1-1435），确认所有 chatSessionOwners 引用位置和 5 处 chat 事件 handler
- `apps/gateway/src/relay-client.ts` — 完整阅读（L1-797），确认 chatClientBindings 13 处引用和 runner 回调结构
- `packages/protocol/src/index.ts` — 确认 RelayFrame 类型，error frame 的 code 字段为 `string` 类型（无需更新协议）
- `apps/relay/test/relay.test.ts` — 阅读（L1927-2093），确认测试模板结构（Phase16 多账号隔离测试）
- `.planning/phases/17-chat-multi-client-realtime-sync/17-CONTEXT.md` — 所有锁定决策
- `docs/working/2026-05-11-chat-multi-client-realtime.md` — 设计文档完整阅读
- `.planning/phases/16-chat-runtime-raw-events/16-CONTEXT.md` — catch-up 机制（D-12~D-17）确认不变

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — 直接从代码库读取，无推断
- Architecture: HIGH — 改动点逐行确认
- Pitfalls: HIGH — 从代码现有结构推断，均有具体行号支持
- Test gaps: HIGH — 直接扫描测试文件

**Research date:** 2026-05-11
**Valid until:** 本研究绑定具体代码行号，relay.ts / relay-client.ts 有变动时重新确认
