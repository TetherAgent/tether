# Phase 18: 去掉本地 SQLite - Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 6 个目标文件
**Analogs found:** 6 / 6

---

## File Classification

| 目标文件 | 操作 | Role | Data Flow | 最近 Analog | Match Quality |
|----------|------|------|-----------|-------------|---------------|
| `apps/gateway/src/pty.ts` | 修改 | service | event-driven | `apps/gateway/src/chat-session-runner.ts` | role-match |
| `apps/gateway/src/session-runner.ts` | 修改 | service | event-driven | `apps/gateway/src/pty.ts` | exact |
| `apps/gateway/src/relay-client.ts` | 修改 | service | request-response | `apps/relay/src/relay.ts` (handleGatewayFrame) | role-match |
| `apps/cli/src/main.ts` | 修改 | utility | request-response | 自身（删除 SQLite fallback 代码路径） | N/A |
| `packages/protocol/src/index.ts` | 修改 | config | N/A | 自身（添加 union 类型成员） | exact |
| `apps/relay/src/relay.ts` | 修改 | service | event-driven | 自身（broadcastGatewayUnavailableForScope 模式） | exact |
| `apps/gateway/src/store.ts` | 删除 | model | CRUD | N/A | N/A |

---

## Pattern Assignments

### `apps/gateway/src/pty.ts` — Plan 1（删 store 调用，内存化 session）

**核心改动：** 删掉 `store.insertSession` / `store.appendEvent` / `store.touchSession`，session 存内存 Map，事件用 `createSessionEvent` 构造后直接 `publishEvent`。

**Analog 1：createChatEvent（`apps/gateway/src/chat-session-runner.ts` 行 93-107）**

```typescript
// 文件级 sequence 计数器
let chatEventSequence = 0;

function createChatEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: ChatEventType,
  payload: TPayload,
  ts = Date.now()
): ChatEvent<TPayload> {
  chatEventSequence = (chatEventSequence + 1) % 1000;
  return {
    id: (ts * 1000) + chatEventSequence,  // D-01 的 timestamp-based ID 方案
    sessionId,
    type,
    ts,
    payload
  };
}
```

**按 D-02 要求，PTY 的 `createSessionEvent` 与 chat 共用同一实现逻辑：**
- 提取到 `apps/gateway/src/ids.ts` 或 gateway 内一个新的 `events.ts` 公共模块
- 函数签名：`createSessionEvent(sessionId, type, payload, ts?)` → 返回 `SessionEvent`
- sequence 计数器与 chat 各自独立（文件级变量），只要算法一致即可

**Analog 2：publishEvent 模式（`apps/gateway/src/pty.ts` 行 188-199）**

```typescript
// 已存在的 publishEvent，直接用于替代 store.appendEvent → publish 的两步操作
publishEvent(event: SessionEvent): void {
  this.publish(event);
}

private publish(event: SessionEvent): void {
  const listeners = this.listeners.get(event.sessionId);
  if (!listeners) { return; }
  for (const listener of listeners) {
    listener(event);
  }
}
```

**改造后模式（Plan 1 核心替换）：**

```typescript
// 改造前（现有）
this.store.insertSession(session);
this.publish(
  this.store.appendEvent(session.id, 'session.started', { ... })
);

// 改造后（目标）
this.sessions.set(session.id, live);   // 内存 Map 替代 insertSession
this.publishEvent(createSessionEvent(session.id, 'session.started', { ... }));
// 同时 send 给 relay:  send({ type: 'gateway.event', gatewayId, event })
```

**新增 getSession / listSessions 公开方法（Plan 2 需要）：**

```typescript
// 在 PtySessionManager class 里新增：
getSession(id: string): Session | undefined {
  return this.sessions.get(id)?.session;
}

listSessions(): Session[] {
  return [...this.sessions.values()].map(live => live.session);
}

updateSessionStatus(id: string, status: SessionStatus): void {
  const live = this.sessions.get(id);
  if (live) { live.session.status = status; }
}
```

---

### `apps/gateway/src/session-runner.ts` — Plan 1（删 store 调用）

**Analog：** 自身现有结构，`publishEvent` 已有，模式与 `pty.ts` 相同。

**所有 store 调用位置（需逐一删除或替换）：**

| 行 | 调用 | 替换方式 |
|----|------|---------|
| 115 | `this.store.insertSession(session)` | 删除（runner 是子进程，不维护内存 Map） |
| 116 | `new AgentStatusPublisher(session.id, this.store, ...)` | 改为无 store 版本（见下） |
| 132-141 | `this.store.appendEvent(...'session.started')` | `createSessionEvent` + `publishEvent` |
| 143-147 | `this.store.appendEvent(...'runner.started')` | **D-09 说可删**（runner.* 事件不在 relay whitelist） |
| 150-155 | `this.store.appendEvent(...'terminal.output')` + `touchSession` | `createSessionEvent` + `publishEvent`，删 `touchSession` |
| 172-174 | `touchRunnerHeartbeat` + `appendEvent('runner.heartbeat')` | **删掉**（heartbeat 不在 whitelist） |
| 251-254 | `appendEvent('user.input')` | `createSessionEvent` + `publishEvent` |
| 268-273 | `appendEvent('terminal.resize')` | `createSessionEvent` + `publishEvent` |
| 292-293 | `updateSessionStatus` + `appendEvent('session.exited')` | `createSessionEvent` + `publishEvent`，状态只在内存更新 |
| 295 | `appendEvent('runner.exited')` | **删掉** |

**publishEvent 在 session-runner.ts 中的已有实现（行 316-323）：**

```typescript
private publishEvent(event: SessionEvent): void {
  const frame: RunnerEventFrame = { type: 'event', eventId: event.id, sessionId: event.sessionId };
  for (const client of this.clients) {
    if (client.subscribed && client.socket.writable) {
      sendFrame(client.socket, frame);
    }
  }
}
```

注意：session-runner 的 `publishEvent` 用于推事件 ID 给 runner client（daemon.ts），不直接发 relay。relay 侧由 `relay-client.ts` 的 `runnerClient.subscribeEvents` 回调调用 `send({ type: 'gateway.event' })` 完成。

**AgentStatusPublisher 依赖 store 的问题：**
需要查看 `session-status-deriver.ts` 是否能解耦。如果 `AgentStatusPublisher` 内部有 `store.appendEvent`，需要同步修改，用 `createSessionEvent` + callback 替代。

---

### `apps/gateway/src/relay-client.ts` — Plan 1 + 2 + Plan 2（sessions-restore）

**改动点 1：`getStoredSession` 改内存（行 76）**

```typescript
// 改造前
const getStoredSession = (sessionId: string) => options.store['getSession'](sessionId);

// 改造后（Plan 2）
const getStoredSession = (sessionId: string) => options.ptySessions?.getSession(sessionId);
```

**改动点 2：`listRelaySessions` 改内存（行 450-471）**

```typescript
// 改造前：options.store.listSessions() 涵盖 chat + PTY
// 改造后：chat sessions 通过别的机制维护（relay 侧已有 latestSessions Map）
// PTY sessions 读 ptySessions.listSessions()
const listRelaySessions = async (): Promise<Session[]> => {
  const sessions = options.ptySessions?.listSessions() ?? [];
  // ... 保留 isLiveSession 检查，删掉 markSessionLost(store.updateSessionStatus)
};
```

**改动点 3：`markSessionLost` 改内存（行 639-648）**

```typescript
// 改造前
const markSessionLost = (sessionId: string): void => {
  const session = getStoredSession(sessionId);
  if (session?.status === 'running') {
    options.store.updateSessionStatus(sessionId, 'lost');
    options.store.appendEvent(sessionId, 'session.error', { ... });
  }
};

// 改造后（Plan 1 + 2）
const markSessionLost = (sessionId: string): void => {
  const session = getStoredSession(sessionId);
  if (session?.status === 'running') {
    options.ptySessions?.updateSessionStatus(sessionId, 'lost');
    // 直接发 relay 帧，不写 SQLite
    const errEvent = createSessionEvent(sessionId, 'session.error', {
      code: 'session_lost',
      message: 'Gateway relay client lost the session runner'
    });
    send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(errEvent) });
  }
};
```

**改动点 4：新增 `case 'gateway.sessions-restore'`（Plan 2）**

新增帧的 handleFrame switch case，参考现有 `case 'gateway.auth.ok'` 模式（行 322-327）：

```typescript
// 改造前：handleFrame 里 gateway.auth.ok case
case 'gateway.auth.ok':
  setConnectionState('connected');
  void sendSessions();
  return;

// 新增 case（参考此结构）
case 'gateway.sessions-restore':
  for (const session of frame.sessions) {
    // 检查 PID 是否存活，存活则 load 进内存，不存活标记 lost
    const isAlive = session.pid ? isPidAlive(session.pid) : false;
    options.ptySessions?.restoreSession({
      ...session,
      status: isAlive ? 'running' : 'lost'
    });
  }
  void sendSessions();
  return;
```

**改动点 5：删掉 `agent.select` 的 `store.appendEvent`（行 597-602）**

```typescript
// 改造前
const selectEvent = options.store.appendEvent(subSession.id, 'agent.select', { options: matchedOptions, raw });
send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(selectEvent) });

// 改造后（直接构造，不写 SQLite）
const selectEvent = createSessionEvent(subSession.id, 'agent.select', { options: matchedOptions, raw });
send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(selectEvent) });
```

---

### `packages/protocol/src/index.ts` — Plan 2（新增帧类型）

**Analog：** 自身现有 `RelayServerToGatewayFrame` 和 `RelayGatewayToServerFrame` union 类型（行 78-103）。

**新增 1：`gateway.sessions-restore`（server → gateway）**

```typescript
// 当前 RelayServerToGatewayFrame（行 78-103）末尾新增：
export type RelayServerToGatewayFrame =
  | { type: 'gateway.auth.ok'; gatewayId: string }
  // ... 现有成员 ...
  | { type: 'client.switch-model'; clientId: string; sessionId: string; provider: string; model: string }
  // 新增：
  | { type: 'gateway.sessions-restore'; gatewayId: string; sessions: RelaySession[] };
```

**新增 2：`client.new-pty-session`（server → gateway 转发帧）**

```typescript
// 新增到 RelayServerToGatewayFrame：
| { type: 'client.new-pty-session'; clientId: string; provider: string; command: string; cwd: string; cols: number; rows: number; gatewayId: string }
```

**新增 3：`client.new-pty-session`（client → server）**

```typescript
// 新增到 RelayClientToServerFrame（行 105-120）：
| { type: 'client.new-pty-session'; provider: string; command: string; cwd: string; cols: number; rows: number; gatewayId: string }
```

**参考：现有同类帧的添加模式**
- `client.chat`（行 115-116）：两个 overload 合并在同一 union 里，用 `sessionId: null | string` 区分。
- `gateway.session-created`（行 73）：作为已有 `RelayGatewayToServerFrame` 成员。

---

### `apps/relay/src/relay.ts` — Plan 2（gateway auth 后推 sessions-restore）

**Analog：** `broadcastGatewayUnavailableForScope`（行 1156-1163）——按 gatewayId/scope 过滤推送，这是 `gateway.sessions-restore` 推送必须遵守的 R3 规范样板：

```typescript
// 现有：按 scope 过滤推送（不跨账号）
function broadcastGatewayUnavailableForScope(gatewayId: string, gatewayScope: RelayAuthScope): void {
  for (const client of clients.values()) {
    if (!clientCanUseGateway(client.scope, gatewayScope)) continue;
    if (client.gatewayId && client.gatewayId !== gatewayId) continue;
    sendToSocket<RelayServerToClientFrame>(client.socket, { ... });
  }
}
```

**新增逻辑插入位置：** gateway auth 成功后（行 338-342），在 `sendToSocket(gateway.auth.ok)` 之后：

```typescript
// 现有（行 339-342）
authenticated = true;
clearTimeout(authTimer);
sendToSocket<RelayServerToGatewayFrame>(socket, { type: 'gateway.auth.ok', gatewayId });
broadcastGatewayStatus(gatewayId, 'connected', auth.scope);
return;

// 改造后（在 auth.ok 之后、return 之前插入）：
authenticated = true;
clearTimeout(authTimer);
sendToSocket<RelayServerToGatewayFrame>(socket, { type: 'gateway.auth.ok', gatewayId });
broadcastGatewayStatus(gatewayId, 'connected', auth.scope);
// 新增：推 sessions-restore
void sendSessionsRestoreToGateway(gatewayId, socket);
return;
```

**`sendSessionsRestoreToGateway` 实现参考 `syncToServer` 调用模式（行 88-104）：**

```typescript
async function sendSessionsRestoreToGateway(gatewayId: string, gatewaySocket: WebSocket): Promise<void> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) return;
  try {
    const response = await fetch(
      `${options.serverSyncUrl}/api/relay/runtime-sync/gateway-sessions/${encodeURIComponent(gatewayId)}`,
      {
        headers: { 'x-tether-runtime-sync-secret': options.runtimeSyncSecret },
        signal: AbortSignal.timeout(3000)
      }
    );
    if (!response.ok) return;
    const sessions = await response.json() as RelaySession[];
    sendToSocket<RelayServerToGatewayFrame>(gatewaySocket, {
      type: 'gateway.sessions-restore',
      gatewayId,
      sessions
    });
  } catch { /* non-fatal */ }
}
```

**R3 隔离保证：** `gateway.sessions-restore` 只发给该 gatewayId 对应的那个 WebSocket 实例，无需遍历所有 gateway。

---

### `apps/cli/src/main.ts` — Plan 2 + 3（删 attach 命令、改 WS 创建、删 SQLite fallback）

**Plan 2：`tether run/claude/codex` 改走 relay WS**

现有 HTTP 创建会话路径（行 343-363）：

```typescript
// 现有：HTTP POST
async function createSessionViaGateway(provider, options, gatewayUrl): Promise<CreatedGatewaySession> {
  const response = await fetch(`${gatewayUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify(buildCreateSessionPayload(provider, options))
  });
  ...
}
```

改造后需要替换为：通过 relay WS 连接发 `client.new-pty-session` 帧，然后等待 `gateway.session-created` 帧返回。参考 `attachPtySession` 中已有的 WS 连接建立模式（行 1279 附近）。

**Plan 3：删 `tether ls` 的 SQLite fallback（行 396-413）**

```typescript
// 现有：有 SQLite fallback
program.command('ls').action(async () => {
  const gatewaySessions = await fetchGatewaySessions().catch(() => undefined);
  const store = new Store();
  const sessions = gatewaySessions ?? store.listSessions();   // <- 删掉 fallback
  ...
});

// 目标（D-05）：
program.command('ls').action(async () => {
  const sessions = await fetchGatewaySessions();  // 不可达则抛错退出
  for (const session of sessions) { ... }
});
```

**Plan 3：删 `tether attach` 命令（D-04）**

直接删除 `program.command('attach')` 整段（行 370-391）。

**Plan 3：删所有 `new Store()` 调用**

| 行 | 上下文 | 删除方式 |
|----|--------|---------|
| 382 | `tether attach` | 随 attach 命令一起删 |
| 398-399 | `tether ls` | 删 Store fallback |
| 443 | `tether url` | 改从 gateway HTTP `GET /api/sessions/:id` 查 |
| 457-458 | `tether send` | 改从 gateway HTTP 查 session |
| 485-488 | `tether stop` | 删 store.listSessions fallback，改 HTTP |
| 519 | `stopSession` | 删 store.getSession，改 HTTP |
| 627 | `startGatewayForeground` | `new Store()` + `new PtySessionManager(store)` 同步改为无 store 的构造 |

---

## Shared Patterns

### 1. Timestamp-based Event ID 生成
**Source:** `apps/gateway/src/chat-session-runner.ts` 行 78, 93-107
**Apply to:** `pty.ts`、`session-runner.ts`、`relay-client.ts` 中所有 `createSessionEvent` 调用
```typescript
let sessionEventSequence = 0;  // 文件级，不与 chat 共享

function createSessionEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: SessionEventType,
  payload: TPayload,
  ts = Date.now()
): SessionEvent<TPayload> {
  sessionEventSequence = (sessionEventSequence + 1) % 1000;
  return {
    id: (ts * 1000) + sessionEventSequence,
    sessionId,
    type,
    ts,
    payload
  };
}
```

### 2. relay 帧推送（gateway → relay）
**Source:** `apps/gateway/src/relay-client.ts` 行 270-288（`send` / `sendChatEvent` 函数）
**Apply to:** 所有需要替换 `store.appendEvent` + `publish` 的地方，改为同时调 `publishEvent` 和 `send`

```typescript
const send = (frame: RelayGatewayToServerFrame) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
};
// 事件既本地 publish，也发到 relay
this.publishEvent(event);
send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
```

### 3. 按账号隔离的 relay 推送（R3 规范）
**Source:** `apps/relay/src/relay.ts` 行 1156-1172（`broadcastGatewayUnavailableForScope` / `broadcastGatewayStatus`）
**Apply to:** `gateway.sessions-restore` 推送、`client.new-pty-session` 转发
```typescript
// 模板：任何新的推送/转发都必须按 gatewayId + scope 过滤
for (const client of clients.values()) {
  if (!clientCanUseGateway(client.scope, gatewayScope)) continue;
  if (client.gatewayId && client.gatewayId !== gatewayId) continue;
  sendToSocket(client.socket, frame);
}
```

### 4. switch case 帧处理
**Source:** `apps/gateway/src/relay-client.ts` 行 320-447（`handleFrame` switch）
**Apply to:** 新增 `case 'gateway.sessions-restore'` 和 `case 'client.new-pty-session'`
```typescript
// 已有 case 结构（参考 gateway.auth.ok）：
case 'gateway.auth.ok':
  setConnectionState('connected');
  void sendSessions();
  return;
// 新 case 遵循相同的 return 而非 break 模式
```

### 5. Protocol union 类型扩展
**Source:** `packages/protocol/src/index.ts` 行 68-141
**Apply to:** 新增 `client.new-pty-session` 和 `gateway.sessions-restore` 帧类型
```typescript
// 在对应 union 末尾追加 | { type: '...'; ... } 成员
// 不新建 type alias，直接 inline 在 union 中（与现有风格一致）
```

---

## No Analog Found

| 文件/功能 | 原因 |
|-----------|------|
| `PtySessionManager.restoreSession()` 方法 | 新方法，无现有 analog；参考 `PtySessionManager.create()` 的内存 Map 写入模式 |
| relay 侧 `GET gateway-sessions/:gatewayId` HTTP 查询 | relay server 已有 `syncToServer` 单向写，无从 MySQL 反查 sessions 的模式，需参考 server 侧接口文档 |

---

## Plan → File 映射（给 planner 参考）

| Plan | 主要文件 | 关键模式 |
|------|---------|---------|
| Plan 1 | `pty.ts`、`session-runner.ts`、`relay-client.ts` | 删 `store.appendEvent` → `createSessionEvent` + `publishEvent` + `send(gateway.event)` |
| Plan 2 | `protocol/index.ts`、`relay.ts`、`relay-client.ts` | 新增帧类型 → relay auth 后推 sessions-restore → gateway 接收并 load 内存 Map |
| Plan 3 | `store.ts`（删除）、`cli/main.ts`、`pty.ts`（移除 Store 依赖）| grep 验收 → 删文件 → typecheck |

---

## Metadata

**Analog search scope:** `apps/gateway/src/`、`apps/relay/src/`、`apps/cli/src/`、`packages/protocol/src/`
**Files scanned:** 8
**Pattern extraction date:** 2026-05-12
