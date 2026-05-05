# Phase 11: Agent 实时对话视图 - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/protocol/src/index.ts` | config (types) | request-response | `packages/protocol/src/index.ts` (self) | exact (修改) |
| `apps/gateway/src/store.ts` | model | CRUD | `apps/gateway/src/store.ts` (self) | exact (修改) |
| `apps/gateway/src/journal-watcher.ts` | service | file-I/O + event-driven | `apps/gateway/src/session-runner.ts` | role-match |
| `apps/gateway/src/session-runner.ts` | service | event-driven | `apps/gateway/src/session-runner.ts` (self) | exact (修改) |
| `apps/gateway/src/chat-handler.ts` | utility | request-response | `apps/gateway/src/relay-client.ts` (writeInput) | role-match |
| `apps/gateway/src/daemon.ts` | controller | request-response | `apps/gateway/src/daemon.ts` (self) | exact (修改) |
| `apps/gateway/src/relay-client.ts` | middleware | event-driven | `apps/gateway/src/relay-client.ts` (self) | exact (修改) |
| `apps/relay/src/relay.ts` | middleware | request-response | `apps/relay/src/relay.ts` (self) | exact (修改) |
| `apps/web/src/routes.tsx` | config | request-response | `apps/web/src/routes.tsx` (self) | exact (修改) |
| `apps/web/src/pages/session-chat-page.tsx` | component | request-response | `apps/web/src/pages/session-simple-page.tsx` | exact |
| `apps/web/src/components/session/chat-session-surface.tsx` | component | event-driven | `apps/web/src/components/session/chat-session-surface.tsx` (self) | exact (重写) |
| `apps/web/src/i18n/messages.ts` | config | — | `apps/web/src/i18n/messages.ts` (self) | exact (修改) |

---

## Pattern Assignments

### `packages/protocol/src/index.ts` (config, 追加 union 成员)

**Analog:** `packages/protocol/src/index.ts` 自身

**当前 union 结构** (lines 58-76):
```typescript
export type RelayServerToGatewayFrame =
  | { type: 'gateway.auth.ok'; gatewayId: string }
  | { type: 'gateway.auth.failed'; code: string; message: string }
  | { type: 'client.list'; clientId: string }
  | { type: 'client.subscribe'; clientId: string; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; clientId: string; sessionId: string; data: string }
  | { type: 'client.resize'; clientId: string; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; clientId: string; sessionId: string }
  | { type: 'client.detach'; clientId: string; sessionId: string };

export type RelayClientToServerFrame =
  | { type: 'client.auth'; token?: string; ticket?: string; scope?: RelayAuthScope; secret?: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; sessionId: string }
  | { type: 'client.detach'; sessionId: string };
```

**追加位置：** 在各 union 末尾追加，不插入中间（与现有排列一致）：
```typescript
// RelayClientToServerFrame 末尾追加:
| { type: 'client.chat'; sessionId: string; message: string }

// RelayServerToGatewayFrame 末尾追加:
| { type: 'client.chat'; clientId: string; sessionId: string; message: string }
```

---

### `apps/gateway/src/store.ts` (model, CRUD — 追加 conversation_turns 表)

**Analog:** `apps/gateway/src/store.ts` 自身

**CREATE TABLE 模式** (lines 104-137) — 新表加入同一 `db.exec()` 块：
```typescript
// 在 constructor 内 db.exec(` ... `) 块末尾，idx_session_events_cursor 之后加入：
CREATE TABLE IF NOT EXISTS conversation_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  turn_index  INTEGER NOT NULL,
  role        TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  tools       TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE(session_id, turn_index)
);
```

**现有 `appendEvent` 同步方法模式** (lines 233-252) — 新方法全部同步，无 async/await：
```typescript
appendEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: SessionEventType,
  payload: TPayload,
  ts = Date.now()
): SessionEvent<TPayload> {
  const result = this.db
    .prepare(
      `INSERT INTO session_events (session_id, type, ts, payload_json)
       VALUES (?, ?, ?, ?)`
    )
    .run(sessionId, type, ts, JSON.stringify(payload));
  return { id: Number(result.lastInsertRowid), sessionId, type, ts, payload };
}
```

**新方法 `insertConversationTurn` — 事务模式** (参考 DB-02 要求，SELECT+INSERT 原子化)：
```typescript
insertConversationTurn(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  tools?: string,
  ts = Date.now()
): number {  // returns assigned turn_index
  this.db.exec('BEGIN');
  try {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM conversation_turns WHERE session_id = ?'
    ).get(sessionId) as { next_index: number };
    this.db.prepare(
      `INSERT OR IGNORE INTO conversation_turns (session_id, turn_index, role, content, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, row.next_index, role, content, tools ?? null, ts);
    this.db.exec('COMMIT');
    return row.next_index;
  } catch (e) {
    this.db.exec('ROLLBACK');
    throw e;
  }
}
```

**新方法 `listConversationTurns` — 参考 `listEvents`** (lines 254-265)：
```typescript
listConversationTurns(sessionId: string): ConversationTurn[] {
  return this.db.prepare(
    'SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_index ASC'
  ).all(sessionId) as ConversationTurn[];
}
```

**`SessionEventType` 追加位置** (lines 37-52) — 末尾追加 3 个新类型：
```typescript
export type SessionEventType =
  | 'session.started'
  | ...
  | 'agent.handoff'
  | 'agent.typing'   // NEW
  | 'agent.turn'     // NEW
  | 'agent.select';  // NEW
```

---

### `apps/gateway/src/journal-watcher.ts` (service, file-I/O + event-driven — 新建)

**Analog:** `apps/gateway/src/session-runner.ts`

**类结构模式** (session-runner.ts lines 64-74) — JournalWatcher 用同样的私有字段+构造函数风格：
```typescript
export class SessionRunner {
  private server?: net.Server;
  private term?: IPty;
  private heartbeat?: NodeJS.Timeout;
  private exited = false;
  private readonly clients = new Set<RunnerClientConnection>();

  constructor(private readonly store: Store, private readonly options: CreateSessionRunnerOptions) {
    this.socketPath = runnerSocketPath(options.id, options.socketDir);
  }
```

**JournalWatcher 类骨架** — 复制此类结构：
```typescript
import { closeSync, openSync, readSync, statSync, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionEvent, Store } from './store.js';
import type { ProviderName } from '@tether/core';

export class JournalWatcher {
  private lastOffset = 0;
  private residual = '';
  private watcher?: FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private existenceTimer?: NodeJS.Timeout;
  private filePath?: string;  // set in start() after resolveJournalPath

  constructor(
    private readonly sessionId: string,
    private readonly provider: ProviderName,
    private readonly agentSessionId: string,
    private readonly projectPath: string,
    private readonly store: Store,
    private readonly publishEvent: (event: SessionEvent) => void
  ) {}

  start(): void {
    // filePath resolved here so providers with no path return undefined gracefully
    this.filePath = resolveJournalPath(this.provider, this.projectPath, this.agentSessionId);
    if (!this.filePath) return; // unsupported provider
    // ... existence check and attachWatcher
  }
  stop(): void { ... }
  private tryRead(): void { ... }
  private processEntry(entry: Record<string, unknown>): void { ... }
}
```

**publishEvent callback 模式** — 从 session-runner.ts lines 304-311 复制，JournalWatcher 接收相同签名的回调：
```typescript
// session-runner.ts publishEvent 模式 (lines 304-311):
private publishEvent(event: SessionEvent): void {
  const frame: RunnerEventFrame = { type: 'event', eventId: event.id, sessionId: event.sessionId };
  for (const client of this.clients) {
    if (client.subscribed && client.socket.writable) {
      sendFrame(client.socket, frame);
    }
  }
}
// JournalWatcher 接收同签名回调: (event: SessionEvent) => void
// 使用: const turnIndex = this.store.insertConversationTurn(sessionId, 'assistant', content, toolsJson);
//       const event = this.store.appendEvent(sessionId, 'agent.turn', { ..., turnIndex });
//       this.publishEvent(event);
```

**增量读取 + 残行模式** (RESEARCH.md Code Examples — tryRead):
```typescript
private tryRead(): void {
  try {
    const { size } = statSync(this.filePath);
    if (size <= this.lastOffset) return;
    const fd = openSync(this.filePath, 'r');
    const buf = Buffer.alloc(size - this.lastOffset);
    readSync(fd, buf, 0, buf.length, this.lastOffset);
    closeSync(fd);
    this.lastOffset = size;
    const chunk = this.residual + buf.toString('utf8');
    const lines = chunk.split('\n');
    this.residual = lines.pop() ?? '';  // 保留不完整的最后一行
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        this.processEntry(entry);
      } catch { /* 跳过格式异常行 */ }
    }
  } catch { /* 文件可能暂时不存在 */ }
}
```

**文件存在等待模式** — 先 1s 轮询等待文件出现，再切换到 fs.watch：
```typescript
start(): void {
  try {
    statSync(this.filePath); // 文件已存在
    this.attachWatcher();
  } catch {
    // 文件不存在: 每 1s 检查
    this.existenceTimer = setInterval(() => {
      try {
        statSync(this.filePath);
        clearInterval(this.existenceTimer);
        this.existenceTimer = undefined;
        this.attachWatcher();
      } catch { /* 继续等待 */ }
    }, 1000);
    this.existenceTimer?.unref?.();
  }
}

private attachWatcher(): void {
  this.tryRead();
  this.watcher = watch(this.filePath, () => this.tryRead());
  // 保底 2s 轮询
  this.pollTimer = setInterval(() => this.tryRead(), 2000);
  this.pollTimer?.unref?.();
}
```

**Claude 路径构建** — 从 session-runner.ts `snapshotAgentDir` (lines 326-332) 提取：
```typescript
// session-runner.ts lines 329-332:
const encoded = projectPath.replaceAll('/', '-');
const dir = path.join(home, '.claude', 'projects', encoded);
// JSONL: path.join(dir, `${agentSessionId}.jsonl`)
```

---

### `apps/gateway/src/session-runner.ts` (service — 修改，添加 JournalWatcher 集成)

**Analog:** `apps/gateway/src/session-runner.ts` 自身

**私有字段声明模式** (lines 65-70) — 在现有字段后追加：
```typescript
// 现有:
private readonly clients = new Set<RunnerClientConnection>();
// 追加:
private journalWatcher?: JournalWatcher;
```

**pollAgentSessionId.then() 集成点** (lines 115-121) — 在 `updateAgentSessionId` 后追加：
```typescript
// 当前代码 (lines 115-121):
pollAgentSessionId(this.options.provider, this.options.projectPath, term.pid, preSpawnSnapshot)
  .then((agentSessionId) => {
    if (agentSessionId) {
      this.store.updateAgentSessionId(this.options.id, agentSessionId);
    }
  })
  .catch(() => { /* detection failure is non-fatal */ });

// 修改后 (追加 journalWatcher 启动):
pollAgentSessionId(this.options.provider, this.options.projectPath, term.pid, preSpawnSnapshot)
  .then((agentSessionId) => {
    if (agentSessionId) {
      this.store.updateAgentSessionId(this.options.id, agentSessionId);
      this.journalWatcher = new JournalWatcher(
        this.options.id,
        this.options.provider,
        agentSessionId,
        this.options.projectPath,
        this.store,
        (event) => this.publishEvent(event)  // 复用现有 publishEvent
      );
      this.journalWatcher.start();
    }
  })
  .catch(() => { /* non-fatal */ });
```

**handleTermExit 清理点** (lines 272-284) — 在方法首行追加 stop()：
```typescript
private handleTermExit(sessionId: string, exitCode: number, signal?: number): void {
  if (this.exited) return;
  this.exited = true;
  this.journalWatcher?.stop();  // 追加 (第一行，最早清理)
  // ... 以下不变
```

**closeServer 清理点** (lines 287-302) — 同样追加：
```typescript
private async closeServer(): Promise<void> {
  this.journalWatcher?.stop();  // 追加
  // ... 以下不变
```

---

### `apps/gateway/src/chat-handler.ts` (utility — 新建，可选)

**Analog:** `apps/gateway/src/relay-client.ts` `writeInput` 函数 (lines 276-298)

**writeInput 模式**（relay-client.ts lines 276-298）— handleChatMessage 参考此结构：
```typescript
const writeInput = async (clientId: string, sessionId: string, data: string) => {
  const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
  if (!subscription) {
    sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
    return;
  }
  if (subscription.mode !== 'control') {
    sendError(clientId, sessionId, 'observe_only', 'observer clients cannot send input');
    return;
  }
  const session = options.store.getSession(sessionId);
  const runnerClient = session ? options.runnerClientForSession?.(session) : undefined;
  if (runnerClient) {
    await runnerClient.write(data, clientId).catch(() => {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    });
    return;
  }
  ...
};
```

**handleChatMessage 骨架** — 三步动作（insert user turn → pty write → emit agent.typing）。Returns `Promise<SessionEvent>` so callers can publish the agent.typing event to their respective WS clients:
```typescript
export async function handleChatMessage(
  sessionId: string,
  message: string,
  store: Store,
  runnerClient: SessionRunnerClient | undefined
): Promise<SessionEvent> {
  const safeMessage = message.slice(0, 4000);
  store.insertConversationTurn(sessionId, 'user', safeMessage);
  if (runnerClient) {
    await runnerClient.write(safeMessage + '\n', 'chat').catch(() => { /* PTY may have exited */ });
  }
  return store.appendEvent(sessionId, 'agent.typing', {});
  // publishEvent 由调用方负责（daemon.ts 和 relay-client.ts 各自的 publishEvent）
}
```

---

### `apps/gateway/src/daemon.ts` (controller — 修改)

**Analog:** `apps/gateway/src/daemon.ts` 自身

**GET API 路由模式** (lines 335-362) — 新 conversation 接口复制此模式：
```typescript
app.get('/api/sessions/:id/snapshot', async (c) => {
  const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
  if (!actor.ok) {
    return c.json({ error: actor.error }, actor.status);
  }
  const session = options.store.getSession(c.req.param('id'));
  if (!session) {
    return c.json({ error: 'session not found' }, 404);
  }
  const ownership = authorizeSessionAccess(session, actor.payload);
  if (!ownership.ok) {
    return c.json({ error: ownership.error }, ownership.status);
  }
  // ... 查询并返回
  return c.json({ session, text, capturedAt: Date.now() });
});
```

**`GET /api/sessions/:id/conversation` 新路由**（复制上方模式）：
```typescript
app.get('/api/sessions/:id/conversation', async (c) => {
  const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
  if (!actor.ok) return c.json({ error: actor.error }, actor.status);
  const session = options.store.getSession(c.req.param('id'));
  if (!session) return c.json({ error: 'session not found' }, 404);
  const ownership = authorizeSessionAccess(session, actor.payload);
  if (!ownership.ok) return c.json({ error: ownership.error }, ownership.status);
  const turns = options.store.listConversationTurns(session.id);
  return c.json({ turns });
});
```

**WS message handler 模式** (lines 772-828) — client.chat case 按 input case 结构追加：
```typescript
// 现有 input case (lines 778-798):
if (frame.type === 'input' && typeof frame.data === 'string') {
  client.lastSeenAt = Date.now();
  if (client.mode === 'observe' || controllers.get(session.id) !== clientId) {
    socket.send(JSON.stringify({ type: 'error', code: ..., message: ... }));
    return;
  }
  if (runnerClient) {
    runnerClient.write(frame.data, clientId).catch(() => { ... });
    return;
  }
  ...
  return;
}

// 新增 chat case (紧跟 input case 后):
if (frame.type === 'chat' && typeof frame.message === 'string') {
  client.lastSeenAt = Date.now();
  if (client.mode === 'observe' || controllers.get(session.id) !== clientId) {
    socket.send(JSON.stringify({ type: 'error', code: 'observe_only', message: '...' }));
    return;
  }
  if (runnerClient) {
    void handleChatMessage(session.id, frame.message, options.store, runnerClient)
      .then((event) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'event', event })); })
      .catch(() => { socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: '...' })); });
    return;
  }
}
```

**agent.select 检测** — 在 runnerClient.subscribeEvents callback (lines 752-758) 内，每次收到 `terminal.output` 后检测：
```typescript
// 当前 subscribeEvents 回调 (lines 752-757):
unsubscribe = await runnerClient.subscribeEvents((frame) => {
  const event = options.store.listEvents(frame.sessionId, frame.eventId - 1, 1)[0];
  if (event && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: 'event', event }));
  }
}, replayCursor);

// 修改后追加 agent.select 检测 (参考现有 stripAnsi，line 1199):
// 在 socket.send event 后追加逻辑
if (event.type === 'terminal.output' && !selectEmitted) {
  recentOutputBuf += stripAnsi((event.payload as { data?: string }).data ?? '');
  // 保持最近 50 行
  scheduleSelectDetect(sessionId);
}
```

---

### `apps/gateway/src/relay-client.ts` (middleware — 修改)

**Analog:** `apps/gateway/src/relay-client.ts` 自身

**handleFrame switch case 模式** (lines 139-167) — 在 `client.input` case 后追加：
```typescript
// 现有 client.input case (line 155-156):
case 'client.input':
  void writeInput(frame.clientId, frame.sessionId, frame.data);
  return;

// 追加 client.chat case — store.getSession() lookup is REQUIRED (not optional):
case 'client.chat': {
  const session = options.store.getSession(frame.sessionId);
  if (!session) return; // session not found — discard frame
  const runnerClient = options.runnerClientForSession?.(session);
  void handleChatMessage(frame.sessionId, frame.message, options.store, runnerClient)
    .then((event) => {
      send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
    })
    .catch(() => { /* PTY may have exited; suppress */ });
  return;
}
```

---

### `apps/relay/src/relay.ts` (middleware — 修改)

**Analog:** `apps/relay/src/relay.ts` 自身

**client.input case 模式** (lines 300-314) — client.chat 完全复制此结构，仅改 type 和转发字段：
```typescript
// 现有 client.input case (lines 300-314):
case 'client.input':
  if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
    sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
    break;
  }
  if (subscriptions.get(frame.sessionId) !== 'control') {
    sendToClient(clientId, {
      type: 'error',
      sessionId: frame.sessionId,
      code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
      message: subscriptions.has(frame.sessionId) ? 'observer clients cannot send input' : 'client is not subscribed to this session'
    });
    break;
  }
  forwardToGateway({ type: 'client.input', clientId, sessionId: frame.sessionId, data: frame.data });
  break;

// 追加 client.chat case (完全镜像，只改最后一行的转发字段):
case 'client.chat':
  if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
    sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
    break;
  }
  if (subscriptions.get(frame.sessionId) !== 'control') {
    sendToClient(clientId, {
      type: 'error',
      sessionId: frame.sessionId,
      code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
      message: subscriptions.has(frame.sessionId) ? 'observer clients cannot send input' : 'client is not subscribed to this session'
    });
    break;
  }
  forwardToGateway({ type: 'client.chat', clientId, sessionId: frame.sessionId, message: frame.message });
  break;
```

---

### `apps/web/src/routes.tsx` (config — 修改)

**Analog:** `apps/web/src/routes.tsx` 自身

**mode 类型声明** (line 12) — 改一处类型，改一处路由路径：
```typescript
// 当前 (line 12):
renderSessionView: (sessionId: string, mode: 'control' | 'replay' | 'simple') => React.ReactNode;

// 修改为:
renderSessionView: (sessionId: string, mode: 'control' | 'replay' | 'chat') => React.ReactNode;
```

**路由路径** (lines 51-58) — 删除 `/simple`，新增 `/chat`：
```typescript
// 删除:
<Route
  path="/remote/session/:sessionId/simple"
  element={<RequireUserAuth><SessionViewRoute mode="simple" renderSessionView={renderSessionView} /></RequireUserAuth>}
/>

// 新增:
<Route
  path="/remote/session/:sessionId/chat"
  element={<RequireUserAuth><SessionViewRoute mode="chat" renderSessionView={renderSessionView} /></RequireUserAuth>}
/>
```

**SessionViewRoute mode 类型** (lines 73-77) — 同步修改：
```typescript
// 修改 mode prop 类型:
function SessionViewRoute({
  mode,
  renderSessionView
}: {
  mode: 'control' | 'replay' | 'chat';  // 'simple' → 'chat'
  renderSessionView: (sessionId: string, mode: 'control' | 'replay' | 'chat') => React.ReactNode;
```

---

### `apps/web/src/pages/session-chat-page.tsx` (component — 新建，重命名自 session-simple-page.tsx)

**Analog:** `apps/web/src/pages/session-simple-page.tsx`

**整个文件模式** (session-simple-page.tsx lines 1-8) — 基本相同，只改 import 路径和导出名：
```typescript
// 当前 session-simple-page.tsx:
import {
  ChatSessionSurface,
  type ChatSessionSurfaceProps
} from '../components/session/chat-session-surface.js';

export function SessionSimplePage(props: ChatSessionSurfaceProps) {
  return <ChatSessionSurface {...props} />;
}

// 新建 session-chat-page.tsx:
import {
  ChatSessionSurface,
  type ChatSessionSurfaceProps
} from '../components/session/chat-session-surface.js';

export function SessionChatPage(props: ChatSessionSurfaceProps) {
  return <ChatSessionSurface {...props} />;
}
```

---

### `apps/web/src/components/session/chat-session-surface.tsx` (component — 整体重写)

**Analog:** `apps/web/src/components/session/chat-session-surface.tsx` 自身

**保留不变的部分** — 以下代码直接从原文件复制：

**Imports 模式** (lines 1-9):
```typescript
import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TerminalSquare } from 'lucide-react';
import { Button, Textarea } from '@tether/design';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { gatewayAuthHeaders, requestGatewayWsTicket } from '../../lib/api.js';
import { SessionDetailHeader, TerminalSurfaceSkeleton } from './session-detail-chrome.js';
```

**辅助函数** (lines 116-165) — 完整保留：
```typescript
function buildRelayClientUrl(relayUrl: string, fillRelayUrlMsg: string, protocolInvalidMsg: string): string { ... }
function buildGatewayStreamUrl(sessionId: string, query: string): string { ... }
function parseWsFrame(data: unknown): Record<string, unknown> | undefined { ... }
function gatewayRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> { ... }
```

**WebSocket 连接模式** (lines 212-572) — 保留 `disposed`, `scheduleReconnect`, `openStreamWebSocket`, 完整的 relay/direct 分支和重连逻辑，**删除** LineBuffer 相关代码：

删除项：
- `LineBuffer` 类 (lines 58-104)
- `lineBuffer`, `pendingInput`, `pendingInputTimer`, `liveRafRef` refs
- `commitInput`, `handleUserInput` 函数
- `handleEvent` 中的 `terminal.output` 和 `user.input` case

新增事件处理（替换删除的 handler）：
```typescript
// 替换 handleEvent 内容:
const handleEvent = (event: SessionEvent) => {
  if (event.id <= after) return;
  after = Math.max(after, event.id);
  window.localStorage.setItem(`tether:${sessionId}:latestEventId`, String(event.id));

  if (event.type === 'agent.turn') {
    setIsReady(true);
    const turn = event.payload as { role: string; content: string; tools?: unknown[]; turnIndex: number };
    setChatMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: turn.content, tools: turn.turns ?? [] }]);
    setTypingVisible(false);
    return;
  }
  if (event.type === 'agent.typing') {
    setTypingVisible(true);
    setIsReady(true);
    return;
  }
  if (event.type === 'agent.select') {
    const payload = event.payload as { options: { index: number; label: string }[]; raw: string };
    setSelectOptions(payload.options);
    setSelectRaw(payload.raw);
    return;
  }
  if (event.type === 'session.exited') {
    setStatus(t.statusExited);
  }
};
```

**消息发送模式** (原 sendLine lines 574-611) — 替换为 sendChat：
```typescript
// 原 sendLine 用 client.input + enter 两次发送，新版简化为 client.chat 单帧:
const sendChat = React.useCallback(
  (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputText.trim();
    if (!value) return;
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus(t.statusWsUnavailable);
      return;
    }
    ws.send(JSON.stringify(
      connectionSettings.connectionMode === 'relay'
        ? { type: 'client.chat', sessionId, message: value }
        : { type: 'chat', message: value }
    ));
    setInputText('');
    setStatus(connectionSettings.connectionMode === 'relay' ? t.statusRelaySent : t.statusWsSent);
  },
  [connectionSettings.connectionMode, inputText, sessionId, t]
);
```

**历史加载** — 进入时调用 REST API 而非事件流回放：
```typescript
// 替换 replayEvents 的 fetchReplayPage 逻辑:
const loadHistory = async () => {
  try {
    const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/conversation`);
    if (response.status === 401) { logoutNormal(); return; }
    if (!response.ok) return;
    const data = (await response.json()) as { turns: ConversationTurn[] };
    setChatMessages(data.turns.map((turn) => ({
      id: genId(),
      role: turn.role,
      content: turn.content,
      tools: turn.tools ? (JSON.parse(turn.tools) as ToolInfo[]) : []
    })));
    setIsReady(true);
  } catch { /* 失败则等待 WS 事件 */ }
};
```

---

### `apps/web/src/main.tsx` (修改 — renderSessionView switch)

**Analog:** `apps/web/src/main.tsx` 自身

**switch 模式** (lines 301-327) — 替换 `mode === 'simple'` 为 `mode === 'chat'`：
```typescript
// 当前 (lines 311-318):
if (mode === 'simple') {
  return (
    <SessionSimplePage
      sessionId={sessionId}
      connectionSettings={connectionSettings}
      onConnectionSettingsChange={updateConnectionSettings}
    />
  );
}

// 修改为:
if (mode === 'chat') {
  return (
    <SessionChatPage
      sessionId={sessionId}
      connectionSettings={connectionSettings}
      onConnectionSettingsChange={updateConnectionSettings}
    />
  );
}
```

**import 修改** (line 59):
```typescript
// 删除:
import { SessionSimplePage } from './pages/session-simple-page.js';
// 新增:
import { SessionChatPage } from './pages/session-chat-page.js';
```

---

### `apps/web/src/i18n/messages.ts` (config — 追加 i18n key)

**Analog:** `apps/web/src/i18n/messages.ts` 自身

**key 声明模式** (lines 6-159) — 每个 key 在 `zh` 和 `en` 两个对象中同时声明，按功能分组：
```typescript
// 现有示例 (lines 79-80):
statusConnecting: '连接中',
statusExited: '已退出',

// 新增 agent chat 相关 key（按功能紧跟 status* 一组）:
// zh 对象:
agentTypingIndicator: 'AI 正在思考…',
agentFallbackHint: '无法获取结构化回复，请切换终端视图查看',
agentSelectPrompt: '请选择：',
agentChatSend: '发送',
agentToolChip: '工具调用',
terminalView: '终端视图',

// en 对象（同样位置）:
agentTypingIndicator: 'AI is thinking…',
agentFallbackHint: 'Structured reply unavailable. Switch to terminal view.',
agentSelectPrompt: 'Select an option:',
agentChatSend: 'Send',
agentToolChip: 'Tool call',
terminalView: 'Terminal',
```

---

## Shared Patterns

### 认证 (Auth)
**Source:** `apps/gateway/src/daemon.ts` lines 335-347
**Apply to:** `GET /api/sessions/:id/conversation` 新路由
```typescript
const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
if (!actor.ok) return c.json({ error: actor.error }, actor.status);
const session = options.store.getSession(c.req.param('id'));
if (!session) return c.json({ error: 'session not found' }, 404);
const ownership = authorizeSessionAccess(session, actor.payload);
if (!ownership.ok) return c.json({ error: ownership.error }, ownership.status);
```

### Relay 访问控制 (Access Control)
**Source:** `apps/relay/src/relay.ts` lines 300-314
**Apply to:** `apps/relay/src/relay.ts` client.chat case
```typescript
if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
  sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: '...' });
  break;
}
if (subscriptions.get(frame.sessionId) !== 'control') {
  sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: ..., message: ... });
  break;
}
```

### Store 同步 API (DatabaseSync)
**Source:** `apps/gateway/src/store.ts` lines 233-252
**Apply to:** `insertConversationTurn`, `listConversationTurns` — 全部同步，无 async/await
```typescript
// 正确 (同步):
const result = this.db.prepare('...').run(...);
// 错误 (项目中禁止对 DatabaseSync 使用 await):
const result = await this.db.prepare('...').run(...);
```

### publishEvent 回调
**Source:** `apps/gateway/src/session-runner.ts` lines 304-311
**Apply to:** `JournalWatcher` — 通过构造函数参数接收 `publishEvent` 回调，不直接持有 socket
```typescript
// 用法:
// const turnIndex = this.store.insertConversationTurn(sessionId, 'assistant', content, toolsJson);
// const event = this.store.appendEvent(sessionId, 'agent.turn', { ..., turnIndex });
// this.publishEvent(event);
```

### 前端 WS 连接 + 重连
**Source:** `apps/web/src/components/session/chat-session-surface.tsx` lines 212-572
**Apply to:** 新 `ChatSessionSurface` 重写 — 保留 disposed 标记、scheduleReconnect、openStreamWebSocket 原封不动
```typescript
let disposed = false;
let reconnectStopped = false;
let closeWasExpected = false;
// ... scheduleReconnect, openStreamWebSocket 完整保留
```

### 前端 i18n
**Source:** `apps/web/src/components/session/chat-session-surface.tsx` lines 185-186
**Apply to:** 所有前端文案 — 通过 `useI18n()` 获取 `t`，禁止硬编码字符串
```typescript
const { t } = useI18n();
// 所有可见文案: t.agentTypingIndicator, t.agentFallbackHint, ...
```

### 前端组件规范
**Source:** `apps/web/CLAUDE.md`
**Apply to:** `session-chat-page.tsx`, `chat-session-surface.tsx` 重写
- 必须用 `Button`, `Textarea`，禁止手写 button/textarea 样式
- 图标必须用 `lucide-react`
- 同时支持 light / dark 主题
- Token: `bg-card`, `text-foreground`, `border-input`，禁止双前缀写法

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/gateway/src/journal-watcher.ts` (Codex 路径 glob 部分) | service | file-I/O | 项目中无 glob 递归搜索目录的先例；需参考 RESEARCH.md 中的 readdirSync 递归方案 |

---

## Metadata

**Analog search scope:** `apps/gateway/src/`, `apps/relay/src/`, `apps/web/src/`, `packages/protocol/src/`
**Files scanned:** 12 (含自我修改文件)
**Pattern extraction date:** 2026-05-05
