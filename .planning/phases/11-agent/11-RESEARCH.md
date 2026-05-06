# Phase 11: Agent 实时对话视图 - Research

**Researched:** 2026-05-05
**Domain:** JSONL file watching, SQLite migration, WebSocket frame forwarding, React chat UI
**Confidence:** HIGH (all findings verified from codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**协议层**
- `RelayClientToServerFrame` 追加 `{ type: 'client.chat'; sessionId: string; message: string }`
- `RelayServerToGatewayFrame` 追加 `{ type: 'client.chat'; clientId: string; sessionId: string; message: string }`

**数据层 — conversation_turns 表**
```sql
CREATE TABLE conversation_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  turn_index  INTEGER NOT NULL,
  role        TEXT    NOT NULL,   -- 'user' | 'assistant'
  content     TEXT    NOT NULL,   -- markdown 文本（仅 text 部分）
  tools       TEXT,               -- JSON string，工具调用数组（仅 assistant）
  created_at  INTEGER NOT NULL,
  UNIQUE(session_id, turn_index)
);
```
- `turn_index` 赋值：`SELECT COALESCE(MAX(turn_index), -1) + 1 FROM conversation_turns WHERE session_id = ?`，读写在同一事务内
- user turn 和 assistant turn 共用同一序列
- Store 新增方法：`insertConversationTurn` / `listConversationTurns`

**新事件类型（追加到 SessionEventType）**
- `'agent.typing'`
- `'agent.turn'`
- `'agent.select'`

**agent.turn / agent.select payload 结构：** 见 CONTEXT.md

**Gateway 处理 client.chat**
- `store.insertConversationTurn(role: 'user', ...)` → `pty.write(message + "\n")` → `emit agent.typing`
- Relay 模式：relay-client.ts 处理
- Direct 模式：daemon.ts WebSocket handler 新增 case

**JournalWatcher**
- pollAgentSessionId resolve 后启动，session 退出时 stop()
- 文件不存在时：每 1s 检查
- 主路径 fs.watch + 保底 2s setInterval
- 增量读取：维护 lastOffset

**Turn 完成判定**
- Claude：JSONL 新增 `type: "assistant"` 行含 text 或 tool_use
- Codex：task_completed 触发，汇总 task_started 至 task_completed 间的 response_item

**推送路径：** JournalWatcher → store.appendEvent → publishEvent → Runner socket → Daemon WebSocket → Relay → Mobile

**API：** `GET /api/sessions/:id/conversation` → `{ turns: ConversationTurn[] }`

**前端路由**
- 删除 `/remote/session/:sessionId/simple`
- 新建 `/remote/session/:sessionId/chat`（mode=`'chat'`）
- `session-simple-page.tsx` → `session-chat-page.tsx`
- `ChatSessionSurface` 整体重写
- `routes.tsx` mode 类型：`'control' | 'replay' | 'chat'`

### Claude's Discretion
- JournalWatcher 内部防抖实现细节（连续事件去重）
- 前端 markdown 渲染库选型（复用现有或新增轻量库）
- agent.turn 气泡的具体 CSS 样式（遵循 apps/web/CLAUDE.md token 规范）
- box-drawing 表格解析的具体正则实现

### Deferred Ideas (OUT OF SCOPE)
- Copilot 支持
- 工具调用结果展开
- PTY 实时流替换
</user_constraints>

---

## Summary

Phase 11 adds a JSONL-based structured conversation view alongside the existing PTY stream. The implementation has three parallel tracks: (1) a gateway-side `JournalWatcher` class that reads Claude/Codex JSONL files incrementally and writes structured turns to a new `conversation_turns` DB table, (2) a new `client.chat` protocol frame that routes user messages through Relay → Gateway → PTY, and (3) a new `/remote/session/:id/chat` frontend page with dual-bubble chat UI replacing the current `session-simple-page`.

The codebase is very clean and consistent. The migration pattern is column-level ALTER TABLE (not versioned migration files). The relay forwarding pattern is a simple `switch` case in `relay.ts` and `relay-client.ts`. Protocol types are pure TypeScript union types with no codegen. All these patterns are verified from the actual source files.

**Primary recommendation:** Follow the 9-step implementation order from the PRD exactly. Each step has clear file targets and verifiable success criteria.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| JSONL file watching | Gateway (Runner process) | — | JSONL files exist only on gateway host machine |
| conversation_turns persistence | Gateway (Store) | — | DB is local to gateway |
| client.chat routing | Relay Server | — | Relay forwards client frames to gateway |
| client.chat execution (pty.write + emit) | Gateway (daemon.ts / relay-client.ts) | — | PTY is owned by gateway |
| agent.turn push | Gateway → Relay → Mobile | — | Reuses existing event publish path |
| Conversation history API | Gateway HTTP | — | REST endpoint reading conversation_turns |
| Chat bubble UI | Frontend (React) | — | All rendering client-side |
| agent.select detection | Gateway (daemon.ts terminal.output handler) | — | PTY output only visible at gateway |

---

## Standard Stack

### Core (all already in project — no new installs needed for backend)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:fs | built-in | fs.watch + readFileSync (incremental) | No dependency needed |
| node:sqlite (DatabaseSync) | built-in (Node ≥ 22) | conversation_turns table | Already used in Store |
| ws | ^8.20.0 | WebSocket in relay/gateway | Already in use |

### Frontend — markdown rendering (Claude's Discretion area)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-markdown | latest | Markdown → React | If full CommonMark needed |
| marked | latest | Markdown → HTML string | Lightweight, no React dep |
| (hand-rolled) | — | Basic bold/code/table only | If scope is narrow enough |

**Recommendation (discretion):** The existing `ChatSessionSurface` uses `<pre>` for plain text. The new version needs markdown tables, code blocks, and bold. `react-markdown` is the standard React-ecosystem choice and handles all of these. However, the project currently has no markdown library — adding `react-markdown` (~8KB gzipped) is the correct call. Alternative: use `marked` + `dangerouslySetInnerHTML` if React tree overhead is a concern for many bubbles. [ASSUMED — no current project decision]

**Installation (if react-markdown chosen):**
```bash
pnpm --filter @tether/web add react-markdown
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-markdown | marked + dangerouslySetInnerHTML | XSS risk with dangerouslySetInnerHTML unless sanitized |
| fs.watch + poll fallback | chokidar | Chokidar is heavier; fs.watch is sufficient for single-file local watch |

---

## Architecture Patterns

### System Architecture Diagram

```
Mobile client
  │
  │  client.chat { sessionId, message }
  ▼
Relay Server (/client WebSocket)
  │  handleClientFrame → case 'client.chat' → forwardToGateway
  │
  │  RelayServerToGatewayFrame { type: 'client.chat', clientId, sessionId, message }
  ▼
Gateway (relay-client.ts, handleFrame → case 'client.chat')
  ├── store.insertConversationTurn(role: 'user', ...)        ← write DB
  ├── runnerClient.write(message + "\n", clientId)           ← write PTY
  └── store.appendEvent('agent.typing', ...) → publishEvent  ← push to mobile

Agent running in PTY (terminal.output events continue unchanged)
  │
  └── JSONL file updated on disk (Claude: ~/.claude/projects/..., Codex: ~/.codex/sessions/...)

JournalWatcher (fs.watch + 2s poll fallback)
  │  tryRead(): stat → read [lastOffset..newSize] → parse lines → filter assistant turns
  │
  ├── store.insertConversationTurn(role: 'assistant', ...)   ← INSERT OR IGNORE
  └── store.appendEvent('agent.turn', payload) → publishEvent
                │
                └── Runner socket → Daemon WS → Relay → Mobile

Mobile reconnect path:
  GET /api/sessions/:id/conversation → { turns: ConversationTurn[] }
  ↓
  Render history bubbles → subscribe WS → incremental agent.turn events

terminal.output (daemon.ts onData handler):
  ├── existing: appendEvent('terminal.output', ...)
  └── NEW: agent.select detection (300ms debounce, ≥2 numbered lines)
           → appendEvent('agent.select', { options, raw })
```

### Recommended Project Structure
```
apps/gateway/src/
├── store.ts                    + conversation_turns table (migrate()) + insertConversationTurn + listConversationTurns
├── session-runner.ts           pollAgentSessionId.then → new JournalWatcher(...)
├── journal-watcher.ts          NEW — JournalWatcher class
├── daemon.ts                   + case 'client.chat' in WS handler + agent.select detection
├── relay-client.ts             + case 'client.chat' in handleFrame

apps/relay/src/
├── relay.ts                    + case 'client.chat' in handleClientFrame

packages/protocol/src/
├── index.ts                    + client.chat to RelayClientToServerFrame + RelayServerToGatewayFrame

apps/web/src/
├── routes.tsx                  'simple' → 'chat', add /chat route
├── pages/session-chat-page.tsx  renamed from session-simple-page.tsx, rewritten
├── components/session/chat-session-surface.tsx  full rewrite (JSONL-based)
├── i18n/messages.ts            + new keys (agentTurn, typingIndicator, fallbackHint, etc.)
└── main.tsx                    'simple' → 'chat' in renderSessionView switch
```

---

## DB Migration Pattern

**[VERIFIED: apps/gateway/src/store.ts]**

The project does NOT use versioned migration files. The pattern is:

1. `CREATE TABLE IF NOT EXISTS` for new tables in the constructor's `db.exec()` block
2. `private migrate()` method called from constructor handles ALTER TABLE for new columns on existing tables

For `conversation_turns` (a new table, not a new column), the correct pattern is to add it to the `db.exec()` call in the constructor alongside `sessions` and `session_events`:

```typescript
// In Store constructor, inside the db.exec(` ... `) block:
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

**turn_index transaction pattern:**
```typescript
// Must use BEGIN/COMMIT to make the SELECT + INSERT atomic
insertConversationTurn(sessionId: string, role: 'user' | 'assistant', content: string, tools?: string, ts = Date.now()): void {
  this.db.exec('BEGIN');
  try {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM conversation_turns WHERE session_id = ?'
    ).get(sessionId) as { next_index: number };
    this.db.prepare(
      'INSERT OR IGNORE INTO conversation_turns (session_id, turn_index, role, content, tools, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(sessionId, row.next_index, role, content, tools ?? null, ts);
    this.db.exec('COMMIT');
  } catch (e) {
    this.db.exec('ROLLBACK');
    throw e;
  }
}

listConversationTurns(sessionId: string): ConversationTurn[] {
  return this.db.prepare(
    'SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_index ASC'
  ).all(sessionId) as ConversationTurn[];
}
```

`DatabaseSync` is Node's built-in synchronous SQLite (already used). Transactions with `DatabaseSync` use `db.exec('BEGIN')` / `db.exec('COMMIT')` / `db.exec('ROLLBACK')`.

---

## pollAgentSessionId — Exact Integration Point

**[VERIFIED: apps/gateway/src/session-runner.ts lines 115-121]**

The current code in `SessionRunner.start()`:

```typescript
pollAgentSessionId(this.options.provider, this.options.projectPath, term.pid, preSpawnSnapshot)
  .then((agentSessionId) => {
    if (agentSessionId) {
      this.store.updateAgentSessionId(this.options.id, agentSessionId);
    }
  })
  .catch(() => { /* detection failure is non-fatal */ });
```

JournalWatcher must be started **inside this `.then()` callback**, after `agentSessionId` is known:

```typescript
pollAgentSessionId(...)
  .then((agentSessionId) => {
    if (agentSessionId) {
      this.store.updateAgentSessionId(this.options.id, agentSessionId);
      // NEW:
      this.journalWatcher = new JournalWatcher(
        this.options.id,
        this.options.provider,
        agentSessionId,
        this.options.projectPath,
        this.store,
        (event) => this.publishEvent(event)
      );
      this.journalWatcher.start();
    }
  })
  .catch(() => { /* non-fatal */ });
```

**Cleanup point:** `handleTermExit()` (line 272–285) is called by `term.onExit()`. Add `this.journalWatcher?.stop()` at the top of `handleTermExit`:

```typescript
private handleTermExit(sessionId: string, exitCode: number, signal?: number): void {
  if (this.exited) return;
  this.exited = true;
  this.journalWatcher?.stop();  // NEW
  // ... rest unchanged
}
```

Also clean up in `closeServer()` for safety:
```typescript
private async closeServer(): Promise<void> {
  this.journalWatcher?.stop();  // NEW
  // ... rest unchanged
}
```

`journalWatcher` must be added as a private field on `SessionRunner`:
```typescript
private journalWatcher?: JournalWatcher;
```

---

## Relay Server — client.chat Forwarding

**[VERIFIED: apps/relay/src/relay.ts — handleClientFrame switch, lines 267-363]**

The `client.input` forwarding pattern (lines 300-314):

```typescript
case 'client.input':
  if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
    sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: '...' });
    break;
  }
  if (subscriptions.get(frame.sessionId) !== 'control') {
    sendToClient(clientId, { type: 'error', ... });
    break;
  }
  forwardToGateway({ type: 'client.input', clientId, sessionId: frame.sessionId, data: frame.data });
  break;
```

`client.chat` must replicate this pattern exactly — same auth checks, same subscription check, different forwarded frame type:

```typescript
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

**isClientFrame guard** (line 595): Must accept `client.chat` frames — currently the function is permissive for unknown types (returns true if `type` is a string), so no change needed unless the guard becomes exhaustive.

---

## relay-client.ts — client.chat Handling

**[VERIFIED: apps/gateway/src/relay-client.ts — handleFrame switch, lines 139-167]**

`client.input` handling (line 155):
```typescript
case 'client.input':
  void writeInput(frame.clientId, frame.sessionId, frame.data);
  return;
```

`writeInput` (lines 276-298) checks subscription mode, gets runner client, calls `runnerClient.write(data, clientId)`.

For `client.chat`, the handler does NOT go through `writeInput` — it needs a different path that: (1) inserts user turn, (2) writes PTY, (3) emits agent.typing. The cleanest approach is a dedicated `handleClientChat(clientId, sessionId, message)` function in relay-client.ts, or calling a gateway-level `handleChatMessage` helper shared with daemon.ts.

**Important:** relay-client.ts has no direct access to `store.appendEvent` for `agent.typing` — it does have access to `options.store`. The publish path must call `options.store.appendEvent(sessionId, 'agent.typing', {})` and then use the runner client's subscription mechanism to push it, OR call a shared function passed in from daemon.ts. The simplest approach: create a standalone `handleChatMessage(sessionId, message, store, runnerClientForSession)` helper in a new file or at the top of daemon.ts, importable by both daemon.ts and relay-client.ts.

---

## daemon.ts — Direct Mode client.chat and agent.select

**[VERIFIED: apps/gateway/src/daemon.ts — WS message handler, lines 772-829]**

The current `socket.on('message', ...)` handler handles `'input'` and `'resize'` frame types. For `client.chat`, add a new case parallel to `input`:

```typescript
if (frame.type === 'chat' && typeof frame.message === 'string') {
  // handleChatMessage(sessionId, frame.message, ...)
  return;
}
```

Note: the direct-mode WS uses its own frame format (`{ type: 'input' }` not `{ type: 'client.input' }`). The chat frame sent directly should be `{ type: 'chat', message: string }` to match the existing convention.

**agent.select detection** belongs in the `term.onData` handler (lines 140-147 in session-runner.ts). However, session-runner.ts is spawned as a separate process — it communicates via Unix socket, not directly with daemon.ts WebSocket clients. The `terminal.output` event is published via `publishEvent()` which goes to runner socket subscribers (daemon.ts).

Daemon.ts receives events via `runnerClient.subscribeEvents()` callback (line 752-758). The agent.select detection must therefore be in daemon.ts in the event subscriber callback — when a `terminal.output` event arrives, daemon.ts checks the PTY buffer for numbered options.

Daemon.ts needs a per-session buffer of recent terminal output (last ~50 lines) and a debounce timer for agent.select detection. This state lives inside the WS connection handler closure, alongside the existing `clients`, `controllers` maps.

---

## Event Publish Path (Full Chain)

**[VERIFIED: tracing through session-runner.ts → daemon.ts → relay-client.ts]**

```
SessionRunner.publishEvent(event)
  └── sends RunnerEventFrame { type: 'event', eventId, sessionId } to subscribed Unix socket clients

daemon.ts runnerClient.subscribeEvents(callback)
  └── callback receives frame → listEvents(frame.sessionId, frame.eventId - 1, 1)[0]
  └── socket.send(JSON.stringify({ type: 'event', event }))  ← to browser WS

relay-client.ts runnerClient.subscribeEvents(callback)
  └── callback receives frame → listEvents(...)
  └── send({ type: 'gateway.event', gatewayId, event: toRelayEvent(event) })  ← to Relay WS

relay.ts sendEventToSubscribers(event)
  └── for each subscribed client: sendToSocket({ type: 'event', event })  ← to mobile WS
```

**Key insight:** `JournalWatcher` does NOT call `publishEvent` directly on the runner — it calls `store.appendEvent(...)` and then needs to call the same publish mechanism. Since JournalWatcher is created by SessionRunner, it should receive a `publishEvent` callback:

```typescript
class JournalWatcher {
  constructor(
    private readonly sessionId: string,
    private readonly provider: string,
    private readonly agentSessionId: string,
    private readonly projectPath: string,
    private readonly store: Store,
    private readonly publishEvent: (event: SessionEvent) => void  // ← SessionRunner.publishEvent
  )
```

This matches exactly the pattern already in SessionRunner where `this.publishEvent(this.store.appendEvent(...))` is called.

---

## Protocol Extension Pattern

**[VERIFIED: packages/protocol/src/index.ts]**

Protocol types are plain TypeScript union types — no codegen, no schema files. To add `client.chat`:

```typescript
// RelayClientToServerFrame — add at end of union:
| { type: 'client.chat'; sessionId: string; message: string }

// RelayServerToGatewayFrame — add at end of union:
| { type: 'client.chat'; clientId: string; sessionId: string; message: string }
```

After adding these, TypeScript exhaustive switch checks in relay.ts and relay-client.ts will emit errors for unhandled cases — this is the desired behavior and guides implementation.

---

## JournalWatcher — JSONL File Paths

**[VERIFIED: apps/gateway/src/session-runner.ts — snapshotAgentDir + pollAgentSessionId]**

Claude JSONL path (derived from existing code):
```typescript
// Existing pattern in snapshotAgentDir:
const encoded = projectPath.replaceAll('/', '-');
const dir = path.join(home, '.claude', 'projects', encoded);
// JSONL file: path.join(dir, `${agentSessionId}.jsonl`)
```

Codex JSONL path — NOT a single well-known path. Codex writes to `~/.codex/sessions/YYYY/MM/DD/rollout-*-<agentSessionId>.jsonl`. The directory structure requires a glob search. One approach:
```typescript
// Search for the file:
import { glob } from 'node:fs/promises';  // Node 22+
const pattern = path.join(home, '.codex', 'sessions', '**', `*${agentSessionId}.jsonl`);
```
Or use `readdirSync` recursively on `~/.codex/sessions`. The PRD confirms the agentSessionId IS in the filename, so a glob is reliable. [VERIFIED: PRD section "Codex JSONL 路径"]

**Node 22 `glob` API:** Available as `import { glob } from 'node:fs/promises'` in Node 22+. [ASSUMED — node version not pinned in package.json, but project uses `node:sqlite` which is also Node 22+, so this is safe]

---

## Frontend — Rewrite Scope

**[VERIFIED: apps/web/src/components/session/chat-session-surface.tsx]**

The existing `ChatSessionSurface` (650 lines) is a PTY-based chat that uses `LineBuffer` to parse raw PTY output into "messages". It handles:
- WS connection (direct + relay modes)
- Replay via HTTP events API
- `terminal.output` → LineBuffer → bubbles
- `user.input` → bubbles

**What the rewrite MUST keep:**
- WS connection logic (same auth flow, same direct/relay branching) — can reuse `openStreamWebSocket`, `buildRelayClientUrl`, `buildGatewayStreamUrl`
- Auto-reconnect pattern (`scheduleReconnect`, `disposed` flag)
- `requestGatewayWsTicket`, `gatewayAuthHeaders` from `../../lib/api.js`
- `useAuth`, `useI18n` hooks

**What the rewrite REPLACES:**
- `LineBuffer` class — remove entirely
- `terminal.output` handler → replaced by `agent.turn` handler
- `user.input` handler → not needed (user turns come from DB via REST, not PTY)
- `sendLine` sends `client.chat` instead of `client.input` + `client.input` enter
- History loading: `GET /api/sessions/:id/conversation` instead of events API

**New event handlers needed:**
```typescript
if (event.type === 'agent.turn') {
  // append AI bubble with markdown content + tool chips
}
if (event.type === 'agent.typing') {
  // show typing indicator
}
if (event.type === 'agent.select') {
  // show option chips above composer
}
```

**Sending messages** — direct mode: `{ type: 'chat', message }`, relay mode: `{ type: 'client.chat', sessionId, message }` (no separate enter needed — gateway appends `\n`).

**route wiring in main.tsx:** The `renderSessionView` switch at line 301 needs `mode === 'chat'` case, and `mode` type in `WebRoutesProps` needs updating. `routes.tsx` type annotation must change from `'control' | 'replay' | 'simple'` to `'control' | 'replay' | 'chat'`.

**CLAUDE.md frontend constraints:**
- All text must go through `src/i18n/messages.ts` + `useI18n()`
- File name: `session-chat-page.tsx` (kebab-case)
- Export name: `SessionChatPage` (PascalCase)
- Must support light + dark themes
- Must use `Button`, `Textarea`, `lucide-react` icons — no hand-written styles
- Route must be added to `apps/web/CLAUDE.md` route table

**daemon.ts route handler:** The path `/remote/session/:id` is served as SPA (line 610). Changing the route to `/chat` only requires updating `routes.tsx` and `main.tsx` — no server-side changes needed since all `/remote/*` serve the same `index.html`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom parser | react-markdown | CommonMark edge cases (nested code, tables) are numerous |
| File watching reliability | Pure poll loop | fs.watch + poll fallback | Already specified in PRD; kernel events for low latency |
| SQLite transactions | Manual locking | `db.exec('BEGIN'/'COMMIT'/'ROLLBACK')` | Already used in project via DatabaseSync |
| ANSI stripping for agent.select | Custom regex | Reuse existing `stripAnsi` in daemon.ts (line 1199) | Already written and tested |

---

## Common Pitfalls

### Pitfall 1: DatabaseSync is Synchronous — No await
**What goes wrong:** Treating DatabaseSync like a Promise-based driver and using `await` on queries.
**Why it happens:** Most Node SQLite libraries are async; DatabaseSync is Node's built-in sync variant.
**How to avoid:** All Store methods are synchronous. No `async`/`await` in `insertConversationTurn` or `listConversationTurns`.
**Warning signs:** TypeScript error "Type 'undefined' is not a Promise".

### Pitfall 2: fs.watch on Non-Existent Path Throws
**What goes wrong:** Calling `fs.watch(filePath)` before the JSONL file exists.
**Why it happens:** Claude may not write the JSONL file until after the first exchange.
**How to avoid:** JournalWatcher.start() must stat the file first; if absent, use setInterval(1000) to poll for existence, then switch to fs.watch once found.
**Warning signs:** `ENOENT` thrown from `fs.watch`.

### Pitfall 3: Residual Line on JSONL Read
**What goes wrong:** Last bytes of a read window contain a partial JSON line (file written mid-line).
**Why it happens:** JSONL files are appended incrementally; a 2s poll may catch a partial write.
**How to avoid:** Keep a `residualBuffer` string. On each read, split by `\n`, parse all but the last segment, carry forward the last segment as the new residual. Only parse it when a subsequent read completes it.
**Warning signs:** JSON.parse errors on valid-looking content.

### Pitfall 4: turn_index Race Condition
**What goes wrong:** Two concurrent inserts (e.g., user turn from gateway + concurrent assistant turn from JournalWatcher) get the same `turn_index`.
**Why it happens:** SELECT MAX + INSERT is not atomic without a transaction.
**How to avoid:** Wrap the SELECT + INSERT in a single `BEGIN`/`COMMIT` block. `UNIQUE(session_id, turn_index)` + `INSERT OR IGNORE` provides idempotency for the watcher's fallback polls.
**Warning signs:** Constraint violation logged, missing turns in UI.

### Pitfall 5: agent.select Emitting on Every terminal.output
**What goes wrong:** Mobile shows option chips repeatedly for the same prompt.
**Why it happens:** Forgetting to set `selectEmitted = true` after emit, or resetting too eagerly.
**How to avoid:** Use `selectEmitted` boolean that is set to `true` after emit and only reset when a NEW `terminal.output` arrives (not on the same one that triggered the detection).
**Warning signs:** Option chip re-renders on each keypress.

### Pitfall 6: relay.ts isClientFrame Needs client.chat
**What goes wrong:** `client.chat` frame is silently dropped by `isClientFrame` guard.
**Why it happens:** `isClientFrame` currently validates `client.resize` strictly but returns `true` for other string types. If this guard becomes exhaustive (type check), `client.chat` must be explicitly included.
**How to avoid:** After adding `client.chat` to the protocol union, confirm `isClientFrame` in relay.ts passes it through.
**Warning signs:** No forwarding to gateway despite client sending the frame.

### Pitfall 7: routes.tsx WebRoutesProps Type Must Change
**What goes wrong:** TypeScript error when passing `mode='chat'` to `renderSessionView`.
**Why it happens:** `renderSessionView` signature uses `'control' | 'replay' | 'simple'`.
**How to avoid:** Change the type in `routes.tsx` to `'control' | 'replay' | 'chat'` and update `main.tsx` renderSessionView switch simultaneously.
**Warning signs:** TS compile error in routes.tsx.

---

## Code Examples

### Store.insertConversationTurn (with transaction)
```typescript
// Source: derived from existing Store pattern (DatabaseSync, this.db)
insertConversationTurn(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  tools?: string,
  ts = Date.now()
): void {
  this.db.exec('BEGIN');
  try {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_index FROM conversation_turns WHERE session_id = ?'
    ).get(sessionId) as { next_index: number };
    this.db.prepare(
      `INSERT OR IGNORE INTO conversation_turns
       (session_id, turn_index, role, content, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, row.next_index, role, content, tools ?? null, ts);
    this.db.exec('COMMIT');
  } catch (e) {
    this.db.exec('ROLLBACK');
    throw e;
  }
}
```

### JournalWatcher.tryRead() — incremental read with residual
```typescript
// Source: PRD design doc + Node fs API
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
    this.residual = lines.pop() ?? '';  // keep incomplete last line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        this.processEntry(entry);
      } catch { /* malformed line — skip */ }
    }
  } catch { /* file may be transiently absent */ }
}
```

### relay.ts — client.chat case (in handleClientFrame switch)
```typescript
// Source: mirrors client.input case at lines 300-314 of relay.ts
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

### Frontend — sending client.chat
```typescript
// Source: mirrors existing sendLine pattern in chat-session-surface.tsx
const sendChat = (message: string) => {
  const ws = socket.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(
    connectionSettings.connectionMode === 'relay'
      ? { type: 'client.chat', sessionId, message }
      : { type: 'chat', message }
  ));
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PTY output parsed client-side for chat | JSONL structured turns from file | Phase 11 | Reliable markdown, tool call info |
| No history API for structured chat | GET /api/sessions/:id/conversation | Phase 11 | Reconnect recovery |
| client.input + enter for sending | client.chat frame | Phase 11 | Cleaner semantic, single write |

**Deprecated in this phase:**
- `session-simple-page.tsx`: Deleted and replaced by `session-chat-page.tsx`
- `LineBuffer` class: Only used in the old ChatSessionSurface, removed with rewrite
- `/remote/session/:sessionId/simple` route: Deleted from routes.tsx

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | react-markdown is the right markdown library choice | Standard Stack | Could use marked or hand-rolled; low risk since it's discretionary |
| A2 | Node 22 `glob` from `node:fs/promises` is available | JournalWatcher | If Node < 22, need manual readdir recursion for Codex path discovery |
| A3 | Direct-mode WS frame for chat uses `{ type: 'chat' }` (not `client.chat`) to match existing `{ type: 'input' }` convention | daemon.ts | If convention should be `{ type: 'client.chat' }`, both sides must agree |

---

## Open Questions (RESOLVED)

1. **Codex JSONL glob approach**
   - What we know: Codex path is `~/.codex/sessions/YYYY/MM/DD/rollout-*-<agentSessionId>.jsonl`
   - What's unclear: Node 22's `glob` from `node:fs/promises` stability; project may prefer sync readdir
   - Recommendation: Use sync `readdirSync` recursively (max depth 3: year/month/day) to avoid async complexity in JournalWatcher.start()
   - RESOLVED: Use synchronous `readdirSync` recursion (max depth 3: year/month/day) in `journal-watcher.ts`. Plan 03 Task 1 implements this approach.

2. **agent.select detection location in separate-process runner**
   - What we know: SessionRunner is a separate process; `terminal.output` events go through the Unix socket
   - What's unclear: Whether the daemon.ts event subscriber should buffer output for select detection, or if session-runner.ts should have the logic
   - Recommendation: Daemon.ts subscriber, since it already re-reads events and has WS clients to push to. SessionRunner is intentionally minimal.
   - RESOLVED: Detect in `daemon.ts` subscribeEvents callback. After `store.appendEvent('agent.select')`, also send `runner.send({ type: 'agent.select', ... })` on the runner socket so `relay-client.ts` subscribeEvents loop receives it and forwards to relay clients. Plan 04 Task 1 implements this.

3. **handleChatMessage shared helper scope**
   - What we know: Both daemon.ts (direct) and relay-client.ts (relay) need to execute the same chat handling logic
   - What's unclear: Whether to put this in a new shared file or duplicate
   - Recommendation: Create `apps/gateway/src/chat-handler.ts` with `handleChatMessage(sessionId, message, store, runnerClientForSession)` that both files import.
   - RESOLVED: Create `apps/gateway/src/chat-handler.ts`. `handleChatMessage` returns the `SessionEvent` for `agent.typing`; callers (daemon.ts, relay-client.ts) invoke `publishEvent(event)` after receiving it. Plan 02 Task 2 implements this.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node:fs (watch, readSync) | JournalWatcher | ✓ | Node 22 built-in | — |
| node:sqlite (DatabaseSync) | conversation_turns | ✓ | Node 22 built-in (already used) | — |
| node:fs/promises glob | Codex path discovery | ✓ | Node 22+ | readdir recursion |

All backend dependencies are Node built-ins already in use. No new runtime dependencies required for gateway or relay.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node built-in test runner (`node:test`) |
| Config file | none — invoked via `node --experimental-sqlite --no-warnings=ExperimentalWarning --import tsx --test src/*.test.ts` |
| Quick run command | `pnpm --filter @tether/gateway test` |
| Full suite command | `pnpm --filter @tether/gateway test && pnpm --filter @tether/relay test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | conversation_turns table: turn_index sequential, INSERT OR IGNORE idempotent, listConversationTurns ascending | unit | `pnpm --filter @tether/gateway test` (store.test.ts) | ❌ Wave 0 |
| DB-02 | insertConversationTurn transaction prevents duplicate turn_index under concurrent writes | unit | `pnpm --filter @tether/gateway test` | ❌ Wave 0 |
| RELAY-01 | Relay forwards client.chat frame to gateway with clientId, sessionId, message intact | unit | `pnpm --filter @tether/relay test` (relay.test.ts) | ❌ Wave 0 |
| GW-01 | Gateway handles client.chat: user turn in DB + pty.write + agent.typing emitted | manual | db query + pty echo + ws capture | — |
| WATCH-01 | JournalWatcher: DB has assistant turn after JSONL append; idempotent on double-read | manual (requires live Claude session) | run session, check DB | — |
| API-01 | GET /api/sessions/:id/conversation returns turns in turn_index order | manual | curl after session | — |
| FE-01 | Frontend: history bubbles load, real-time turn appends, select chips render, reconnect restores | manual | mobile browser test | — |

### Sampling Rate
- **Per task commit:** `pnpm --filter @tether/gateway test && pnpm --filter @tether/gateway typecheck`
- **Per wave merge:** above + `pnpm --filter @tether/relay test && pnpm --filter @tether/web typecheck`
- **Phase gate:** Full suite green + manual 5-point mobile verification before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/gateway/src/store.test.ts` — add `conversation_turns` test cases (file exists, add new test block)
- [ ] `apps/relay/src/relay.test.ts` — add `client.chat` forwarding test (file exists, add new test block)

*(Existing test files exist; only new test cases needed, not new files)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing ws ticket / relay token — no new auth surface |
| V3 Session Management | no | — |
| V4 Access Control | yes | `authorizeSessionAccess` already checks account/workspace/userId/gatewayId ownership; client.chat inherits same check via relay subscription guard |
| V5 Input Validation | yes | message length must be bounded; content passed to `pty.write` as-is (same risk as existing `client.input`) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| client.chat to unowned session | Spoofing | `clientCanAccessSession` check in relay.ts — same as client.input |
| Oversized message to pty.write | Tampering | Add message length cap (e.g., 4000 chars, matching existing `/api/sessions/:id/send` limit) |
| JSONL path traversal via agentSessionId | Tampering | agentSessionId comes from `pollAgentSessionId` (derived from PID-based session file), not from client input — low risk; validate it matches UUID format before constructing path |
| Duplicate agent.turn injection | Tampering | `INSERT OR IGNORE` + `UNIQUE(session_id, turn_index)` prevents DB duplicates; publishEvent is fire-and-forget, no replay attack surface |

---

## Sources

### Primary (HIGH confidence)
- `apps/gateway/src/store.ts` — DB schema, migration pattern, DatabaseSync usage, appendEvent
- `apps/gateway/src/session-runner.ts` — pollAgentSessionId location and .then callback, handleTermExit cleanup point, publishEvent mechanism
- `apps/gateway/src/relay-client.ts` — handleFrame switch, writeInput pattern, full relay client logic
- `apps/gateway/src/daemon.ts` — WS message handler, existing frame types, API routes, authorizeSessionAccess
- `apps/relay/src/relay.ts` — handleClientFrame switch, forwardToGateway, isClientFrame guard, clientCanAccessSession
- `packages/protocol/src/index.ts` — exact union types for RelayClientToServerFrame, RelayServerToGatewayFrame
- `apps/web/src/components/session/chat-session-surface.tsx` — existing WS connection logic, relay/direct branching, i18n usage
- `apps/web/src/routes.tsx` — current mode type, route structure
- `apps/web/src/main.tsx` — renderSessionView switch, SessionSimplePage usage
- `apps/web/CLAUDE.md` — frontend rules: i18n, routing, tokens, component constraints
- `docs/working/2026-05-05-agent-jsonl-history-view.md` — JSONL data structures, implementation order

### Secondary (MEDIUM confidence)
- `apps/gateway/src/store.test.ts` — test framework pattern (node:test, no external runner)
- `apps/relay/src/relay.test.ts` — relay test pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from package.json; no speculative additions
- Architecture: HIGH — all integration points verified from source files
- Pitfalls: HIGH — derived from actual code patterns (e.g., DatabaseSync sync API, fs.watch restriction)
- Frontend rewrite scope: HIGH — read existing ChatSessionSurface in full

**Research date:** 2026-05-05
**Valid until:** 2026-06-05 (stable codebase, internal only)
