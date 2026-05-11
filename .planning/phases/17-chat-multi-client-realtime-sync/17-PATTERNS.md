# Phase 17: Chat Multi-client Realtime Sync - Pattern Map

**Mapped:** 2026-05-11
**Files analyzed:** 4（2 个改动目标文件 + 2 个测试文件）
**Analogs found:** 4 / 4

---

## File Classification

| 新增/改动文件 | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/relay/src/relay.ts` | service | pub-sub (1:N broadcast) | 同文件内 `broadcastGatewayUnavailableForScope` + `sendEventToSubscribers` | exact |
| `apps/gateway/src/relay-client.ts` | service | event-driven | 同文件内 `sendError` + `removeSubscription` + `clearSubscriptions` | exact |
| `apps/relay/test/relay.test.ts`（追加） | test | request-response | 同文件内 Phase16 多账号测试 L1927-2033 | exact |
| `apps/gateway/test/relay-client.test.ts`（追加） | test | request-response | 同文件内 Phase15-A8 测试 L983-1024 | exact |

---

## Pattern Assignments

### `apps/relay/src/relay.ts` — chatSessionOwners 替换为 chatSessionSubscribers

**Analog:** 同文件内已有模式

---

#### Pattern A: Map 声明替换

**当前代码**（L193）:
```typescript
const chatSessionOwners = new Map<string, string>(); // sessionId → clientId
```

**改动后**（D-01）:
```typescript
const chatSessionSubscribers = new Map<string, Set<string>>(); // sessionId → Set<clientId>
```

---

#### Pattern B: sendChatEventToSubscribers 辅助函数（新增）

**参照 analog:** `sendEventToSubscribers`（relay.ts L1151-1157）

```typescript
// Analog — 按订阅+账号过滤遍历所有 client：
function sendEventToSubscribers(event: RelayTerminalEvent): void {
  for (const client of clients.values()) {
    if (client.subscriptions.has(event.sessionId) && clientCanAccessSession(client.scope, client.authMethod, event.sessionId)) {
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'event', event });
    }
  }
}
```

**参照 analog:** `broadcastGatewayUnavailableForScope`（relay.ts L1110-1117）

```typescript
// Analog — 遍历 Set，每个元素独立做账号过滤，再 sendToSocket：
function broadcastGatewayUnavailableForScope(gatewayId: string, gatewayScope: RelayAuthScope): void {
  for (const client of clients.values()) {
    if (!clientCanUseGateway(client.scope, gatewayScope)) continue;
    if (client.gatewayId && client.gatewayId !== gatewayId) continue;
    sendToSocket<RelayServerToClientFrame>(client.socket, { ... });
  }
}
```

**新增函数**（参照上述两个 analog，D-03）:
```typescript
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

**注意：** `clientCanAccessSession` 签名（relay.ts L1159-1178）：
```typescript
function clientCanAccessSession(
  clientScope: RelayAuthScope | undefined,
  authMethod: RelayAuthMethod,
  sessionId: string,
  requiredTicketMode?: RelayClientMode
): boolean
```

`sendToClient` 签名（relay.ts L1189-1194）：
```typescript
function sendToClient(clientId: string, frame: RelayServerToClientFrame): void {
  const client = clients.get(clientId);
  if (client) {
    sendToSocket<RelayServerToClientFrame>(client.socket, frame);
  }
}
```

---

#### Pattern C: subscribe 时写入 Set（L793-794）

**当前代码**（relay.ts L793-794）:
```typescript
if (session.transport === 'chat') {
  chatSessionOwners.set(frame.sessionId, clientId);
  // ... catch-up logic ...
  break;
}
```

**改动后**（D-01/D-02，在 `chatSessionOwners.set` 那行替换）:
```typescript
if (session.transport === 'chat') {
  const subs = chatSessionSubscribers.get(frame.sessionId) ?? new Set<string>();
  subs.add(clientId);
  chatSessionSubscribers.set(frame.sessionId, subs);
  // ... catch-up logic 原样保留（Phase 16 不动）...
  break;
}
```

---

#### Pattern D: 断线清理（relay.ts L721-724）

**当前代码**（relay.ts socket.on('close') L718-724）:
```typescript
socket.on('close', () => {
  clearTimeout(authTimer);
  clients.delete(clientId);
  for (const [sessionId, ownerId] of chatSessionOwners) {
    if (ownerId === clientId) chatSessionOwners.delete(sessionId);
  }
});
```

**改动后**（D-02，Pitfall4：逻辑完全不同，需要重写清理块）:
```typescript
socket.on('close', () => {
  clearTimeout(authTimer);
  clients.delete(clientId);
  for (const [sessionId, subs] of chatSessionSubscribers) {
    subs.delete(clientId);
    if (subs.size === 0) chatSessionSubscribers.delete(sessionId);
  }
});
```

---

#### Pattern E: unsubscribe / detach 清理（L984-1010）

**当前代码**（relay.ts L984-988，unsubscribe case）:
```typescript
case 'client.unsubscribe': {
  subscriptions.delete(frame.sessionId);
  if (chatSessionOwners.get(frame.sessionId) === clientId) {
    chatSessionOwners.delete(frame.sessionId);
  }
  // ...
}
```

**改动后**（D-02）:
```typescript
case 'client.unsubscribe': {
  subscriptions.delete(frame.sessionId);
  const unsubSubs = chatSessionSubscribers.get(frame.sessionId);
  if (unsubSubs) {
    unsubSubs.delete(clientId);
    if (unsubSubs.size === 0) chatSessionSubscribers.delete(frame.sessionId);
  }
  // ...
}
```

同样模式适用于 `client.detach`（L1002-1005）。

---

#### Pattern F: syncToServer transport 判断（L524-526）

**当前代码**:
```typescript
const whitelistScope = chatSessionOwners.has(frame.event.sessionId)
  ? { ...gatewayScope, transport: 'chat' as const }
  : gatewayScope;
```

**改动后**（语义等价，只换 Map 名）:
```typescript
const whitelistScope = chatSessionSubscribers.has(frame.event.sessionId)
  ? { ...gatewayScope, transport: 'chat' as const }
  : gatewayScope;
```

---

#### Pattern G: 5 处 chat 事件点发改为广播

每处 `if (clientId) { sendToClient(clientId, { type: 'agent.xxx', ... }) }` 改为 `sendChatEventToSubscribers(frame.event.sessionId, { type: 'agent.xxx', ... })`。

**改动前示例**（agent.delta，relay.ts L403-413）:
```typescript
if (frame.event.type === 'agent.delta') {
  const clientId = chatSessionOwners.get(frame.event.sessionId)
    ?? (typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined);
  if (clientId) {
    sendToClient(clientId, {
      type: 'agent.delta',
      sessionId: frame.event.sessionId,
      text: String(frame.event.payload.text ?? ''),
      ...(typeof frame.event.id === 'number' ? { eventId: frame.event.id } : {})
    });
  }
  // ...syncToServer...
  break;
}
```

**改动后**:
```typescript
if (frame.event.type === 'agent.delta') {
  sendChatEventToSubscribers(frame.event.sessionId, {
    type: 'agent.delta',
    sessionId: frame.event.sessionId,
    text: String(frame.event.payload.text ?? ''),
    ...(typeof frame.event.id === 'number' ? { eventId: frame.event.id } : {})
  });
  // ...syncToServer 原样保留...
  break;
}
```

**session.error 特殊处理**（Pitfall1，relay.ts L467-479 有 else 分支）：
```typescript
// 改动前（有 if/else，改完后 else 分支需要删除）
} else if (frame.event.type === 'session.error') {
  const clientId = chatSessionOwners.get(frame.event.sessionId)
    ?? (typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined);
  if (clientId) {
    sendToClient(clientId, { type: 'error', ... });
  } else {
    sendEventToSubscribers(frame.event);  // ← 此 else 分支需要删除
  }
}
```

**改动后**（统一走 sendChatEventToSubscribers，删除 else 分支）:
```typescript
} else if (frame.event.type === 'session.error') {
  sendChatEventToSubscribers(frame.event.sessionId, {
    type: 'error',
    sessionId: frame.event.sessionId,
    code: String(frame.event.payload.code ?? 'session_error'),
    message: String(frame.event.payload.message ?? 'session error')
  });
}
```

---

### `apps/gateway/src/relay-client.ts` — 删除 chatClientBindings，新增 chatInFlight

**Analog:** 同文件内 `sendError`、`removeSubscription`、`clearSubscriptions`

---

#### Pattern H: chatClientBindings 声明删除（L72），chatInFlight 新增

**当前代码**（relay-client.ts L71-72）:
```typescript
const subscriptions = new Map<string, RelaySubscription>();
const chatClientBindings = new Map<string, string>();
```

**改动后**（删除 chatClientBindings，新增 chatInFlight）:
```typescript
const subscriptions = new Map<string, RelaySubscription>();
const chatInFlight = new Set<string>();
```

---

#### Pattern I: onSessionCreated / onChatSessionCreated 回调清理（L80-92）

**当前代码**（relay-client.ts L80-92，两处 chatClientBindings.set）:
```typescript
onSessionCreated: (clientId, sessionId) => {
  chatClientBindings.set(sessionId, clientId);  // ← 删除此行
  send({ type: 'gateway.session-created', ... });
  void sendSessions();
},
onChatSessionCreated: (clientId, metadata) => {
  chatClientBindings.set(metadata.id, clientId);  // ← 删除此行
  send({ type: 'gateway.chat-session-created', ... });
},
```

**改动后**（只删除 set 调用，clientId 参数保留用于日志）:
```typescript
onSessionCreated: (clientId, sessionId) => {
  send({ type: 'gateway.session-created', ... });
  void sendSessions();
},
onChatSessionCreated: (clientId, metadata) => {
  send({ type: 'gateway.chat-session-created', ... });
},
```

---

#### Pattern J: chatRunnerOptions 回调中 chatClientBindings.get 替换（L96-143，7 处）

**当前代码**（以 onDelta L101 为例）:
```typescript
onDelta: ({ clientId, sessionId, text, deltaEventId }) => {
  sendChatEvent(deltaEventId, sessionId, 'agent.delta', { clientId: chatClientBindings.get(sessionId) ?? clientId, text });
},
```

**改动后**（D-06：clientId 参数继续保留用于日志，不再查 Map，直接使用 clientId）:
```typescript
onDelta: ({ clientId, sessionId, text, deltaEventId }) => {
  sendChatEvent(deltaEventId, sessionId, 'agent.delta', { clientId, text });
},
```

同样模式适用于 onUserMessage/onResult/onPermissionRequest/onTool/onError（L96、L105、L117、L125、L135、L143）。

---

#### Pattern K: chatInFlight 检查（relay-client.ts client.chat case，L351）

**参照 analog:** `sendError`（relay-client.ts L741-743）
```typescript
const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
  send({ type: 'gateway.error', gatewayId: effectiveGatewayId, clientId, sessionId, code, message });
};
```

**当前 client.chat case 结构**（relay-client.ts L351-407）:
```typescript
case 'client.chat': {
  if (frame.sessionId === null) {
    // 新建 session 路径（不加锁，Pitfall2）
    const runner = runnerForProvider(frame.provider);
    if (!runner) { send(/* provider_not_supported */); return; }
    void runner.run({ clientId: frame.clientId, sessionId: null, ... });
    return;
  }
  if (!frame.session) { send(/* missing_session_metadata */); return; }
  const runner = runnerForProvider(frame.session.provider);
  if (!runner) { send(/* provider_not_supported */); return; }
  void runner.run({ clientId: frame.clientId, sessionId: frame.sessionId, ... });
  return;
}
```

**改动后**（D-08/D-09/D-10：in-flight 检查插入 sessionId !== null 分支顶部）:
```typescript
case 'client.chat': {
  if (frame.sessionId === null) {
    // 新建 session 路径：不加锁（Pitfall2）
    const runner = runnerForProvider(frame.provider);
    if (!runner) { send(/* provider_not_supported */); return; }
    void runner.run({ clientId: frame.clientId, sessionId: null, ... });
    return;
  }
  // in-flight 检查：D-08/D-09
  if (chatInFlight.has(frame.sessionId)) {
    sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
    return;
  }
  if (!frame.session) { send(/* missing_session_metadata */); return; }
  const runner = runnerForProvider(frame.session.provider);
  if (!runner) { send(/* provider_not_supported */); return; }
  chatInFlight.add(frame.sessionId);  // D-10：加锁在启动 runner 之前
  void runner.run({ clientId: frame.clientId, sessionId: frame.sessionId, ... });
  return;
}
```

---

#### Pattern L: chatInFlight 锁释放（chatRunnerOptions.onResult / onError）

**当前 onResult 代码**（relay-client.ts L103-113）:
```typescript
onResult: ({ clientId, sessionId, event, text, usage, ... }) => {
  sendChatEvent(event.id, sessionId, 'agent.result', {
    clientId: chatClientBindings.get(sessionId) ?? clientId,
    text,
    ...
  });
},
```

**改动后**（D-11：result 发出前先 delete 锁）:
```typescript
onResult: ({ clientId, sessionId, event, text, usage, ... }) => {
  chatInFlight.delete(sessionId);  // D-11：释放锁
  sendChatEvent(event.id, sessionId, 'agent.result', { clientId, text, ... });
},
```

**当前 onError 代码**（relay-client.ts L132-148）:
```typescript
onError: ({ clientId, sessionId, code, message, event }) => {
  if (event) {
    sendChatEvent(event.id, sessionId, 'session.error', {
      clientId: chatClientBindings.get(sessionId) ?? clientId,
      code,
      message
    });
  }
  send({ type: 'gateway.error', ... clientId: chatClientBindings.get(sessionId) ?? clientId, ... });
},
```

**改动后**（D-11：error 发出前先 delete 锁）:
```typescript
onError: ({ clientId, sessionId, code, message, event }) => {
  chatInFlight.delete(sessionId);  // D-11：释放锁
  if (event) {
    sendChatEvent(event.id, sessionId, 'session.error', { clientId, code, message });
  }
  send({ type: 'gateway.error', ... clientId, ... });
},
```

---

#### Pattern M: removeSubscription / clearSubscriptions 清理（L751-766）

**当前代码**（relay-client.ts L751-766）:
```typescript
const removeSubscription = async (clientId: string, sessionId: string) => {
  const key = subscriptionKey(clientId, sessionId);
  const subscription = subscriptions.get(key);
  await subscription?.unsubscribe?.();
  subscriptions.delete(key);
  if (chatClientBindings.get(sessionId) === clientId) {
    chatClientBindings.delete(sessionId);  // ← 删除
  }
};

const clearSubscriptions = () => {
  for (const subscription of subscriptions.values()) {
    void subscription.unsubscribe?.();
  }
  subscriptions.clear();
  chatClientBindings.clear();  // ← 删除
};
```

**改动后**（删除 chatClientBindings 操作；chatInFlight 不在此处清理——chatInFlight 由 onResult/onError 管理）:
```typescript
const removeSubscription = async (clientId: string, sessionId: string) => {
  const key = subscriptionKey(clientId, sessionId);
  const subscription = subscriptions.get(key);
  await subscription?.unsubscribe?.();
  subscriptions.delete(key);
};

const clearSubscriptions = () => {
  for (const subscription of subscriptions.values()) {
    void subscription.unsubscribe?.();
  }
  subscriptions.clear();
};
```

---

#### Pattern N: subscribeClient 中 chatClientBindings.set 删除（L514-515）

**当前代码**（relay-client.ts L514-516）:
```typescript
if (session.transport === 'chat') {
  chatClientBindings.set(sessionId, clientId);  // ← 删除
  const catchupText = runnerForProvider(session.provider)?.getCatchup(sessionId);
```

**改动后**（只删除 set 调用）:
```typescript
if (session.transport === 'chat') {
  const catchupText = runnerForProvider(session.provider)?.getCatchup(sessionId);
```

---

### `apps/relay/test/relay.test.ts`（追加 Phase17 测试）

**Analog:** Phase16 多账号测试（relay.test.ts L1927-2033）

---

#### Pattern O: 多账号隔离测试结构模板

参照 L1927-2033 完整测试结构：

```typescript
test('Phase17-T2: relay does not leak chat delta to other-account subscriber', async () => {
  // 1. 创建 syncServer（提供 metadata + chat-events 端点）
  // 2. startRelayServer with validateToken（B 账号和 A 账号分别返回对应 scope）
  // 3. B 账号 Gateway 先连（CLAUDE.md R4 测试模板要求）
  // 4. A 账号 Gateway 再连
  // 5. B client 先 subscribe（目标 session 为 B 账号）
  // 6. A client subscribe 目标 chat session
  // 7. 通过 A 的 Gateway 发送 gateway.sessions（带 gateway.delta frame）
  // 8. 验证 A client 收到 agent.delta
  // 9. 验证 B client 未收到任何 agent.delta（用 clientBFrames 数组断言）
  // finally: 关闭所有 socket + relay + syncServer
});
```

**关键模式**（relay.test.ts L1986-1989，B 先连）:
```typescript
const gatewayB = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
const gatewayA = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
const clientB = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
const clientA = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
const clientBFrames: RelayServerToClientFrame[] = [];
clientB.on('message', (raw) => {
  clientBFrames.push(JSON.parse(raw.toString()) as RelayServerToClientFrame);
});
```

**两个 client 同时收到事件的测试结构**（Phase17-T1）:
```typescript
// 两个 client 都 subscribe 同一 session，然后 gateway 发 agent.delta
// 验证 clientA 和 clientB（同账号）都收到 agent.delta frame
const deltaA = await waitForJson(clientA, (m) => m.type === 'agent.delta');
const deltaB = await waitForJson(clientB, (m) => m.type === 'agent.delta');
assert.equal(deltaA.sessionId, sessionId);
assert.equal(deltaB.sessionId, sessionId);
```

---

### `apps/gateway/test/relay-client.test.ts`（追加 Phase17 测试）

**Analog:** Phase15-A8 测试（relay-client.test.ts L983-1024）

---

#### Pattern P: chatInFlight 测试结构模板

参照 L983-1024 的 fakeRelay + startRelayClient 结构：

```typescript
test('Phase17-GW-T1: second chat to same session returns chat_in_progress', async () => {
  const { store, cleanup } = tempStore();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_phase17_inflight',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_phase17_inflight' },
    store
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_phase17_inflight' }));
    await waitForRelayClientConnected(relayClient);

    // 第一个 chat（会挂起，因为 runner mock 不会自动完成）
    gatewaySocket.send(JSON.stringify({
      type: 'client.chat',
      clientId: 'client-1',
      sessionId: 'session-1',
      session: { id: 'session-1', provider: 'codex', ... },
      message: 'first'
    }));

    // 第二个 chat 到同一 session 应立即返回 chat_in_progress
    gatewaySocket.send(JSON.stringify({
      type: 'client.chat',
      clientId: 'client-1',
      sessionId: 'session-1',
      session: { id: 'session-1', provider: 'codex', ... },
      message: 'second'
    }));

    const error = await waitForGatewayFrame(
      gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'chat_in_progress'
    );
    assert.equal(error.type, 'gateway.error');
    assert.equal(error.code, 'chat_in_progress');
    assert.equal(error.clientId, 'client-1');
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});
```

**`sendError` 函数签名**（relay-client.ts L741-743，作为 in-flight 拒绝时的回包参照）:
```typescript
const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
  send({ type: 'gateway.error', gatewayId: effectiveGatewayId, clientId, sessionId, code, message });
};
```

---

## Shared Patterns

### 账号隔离过滤（CLAUDE.md R3 强制）

**Source:** `apps/relay/src/relay.ts` L1159-1178（`clientCanAccessSession`）及 L1110-1117（`broadcastGatewayUnavailableForScope`）
**Apply to:** `sendChatEventToSubscribers` 函数内，遍历 subscribers Set 时每个 subscriberId 独立调用

```typescript
// 在广播循环中必须有此校验，禁止跳过：
if (!clientCanAccessSession(client.scope, client.authMethod, sessionId)) continue;
```

### Set 空检测 + key 删除（防内存泄漏）

**Source:** D-02 决策，relay.ts Pattern D/E 改动点
**Apply to:** 所有 `chatSessionSubscribers` 的 delete 操作（断线、unsubscribe、detach）

```typescript
// 每次从 Set 删除后必须检查是否为空：
if (subs.size === 0) chatSessionSubscribers.delete(sessionId);
```

### sendError 模式（Gateway 侧错误回包）

**Source:** `apps/gateway/src/relay-client.ts` L741-743
**Apply to:** `chatInFlight` 拒绝逻辑（D-09）

```typescript
const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
  send({ type: 'gateway.error', gatewayId: effectiveGatewayId, clientId, sessionId, code, message });
};
// 调用：sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
```

### 测试 B-先-连模板（CLAUDE.md R4）

**Source:** `apps/relay/test/relay.test.ts` L1986-1989
**Apply to:** 所有 Phase17 跨账号隔离测试（Phase17-T2 等）

B 账号的 Gateway 和 Client 必须先于 A 账号建立连接，验证 A 的操作不泄漏到 B。

---

## No Analog Found

本阶段无完全无 analog 的文件。所有改动点均有直接对应的现有代码作为参照。

---

## 关键 Pitfalls（来自 RESEARCH.md）

| # | 位置 | 问题 | 防止方法 |
|---|------|------|---------|
| 1 | relay.ts L467-479 | session.error 有 else 分支兜底需同步删除 | 改为 sendChatEventToSubscribers 后删除 else 分支 |
| 2 | relay-client.ts L351 | sessionId=null 路径不应检查 in-flight | if 块只在 `frame.sessionId !== null` 分支内（参考 L352 已有分叉）|
| 3 | relay-client.ts L86 | onChatSessionCreated 也有 chatClientBindings.set | grep 13 处引用逐一删除 |
| 4 | relay.ts L721-724 | 断线清理逻辑与 Map 完全不同，不能复制旧逻辑 | 重写为 Set.delete + 空 Set 删 key |
| 5 | relay.ts L984-1010 | unsubscribe 和 detach 两处清理都要改 | 搜索 chatSessionOwners 全部 6 处引用逐一替换 |

---

## Metadata

**Analog search scope:** `apps/relay/src/`、`apps/gateway/src/`、`apps/relay/test/`、`apps/gateway/test/`
**Files scanned:** 4（relay.ts、relay-client.ts、relay.test.ts、relay-client.test.ts）
**Pattern extraction date:** 2026-05-11
