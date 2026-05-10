# Phase 13: Mobile Web Chat - Pattern Map

**Mapped:** 2026-05-10
**Files analyzed:** 22 (new/modified)
**Analogs found:** 20 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/src/pages/chats-page.tsx` | page | request-response | `apps/web/src/pages/session-control-page.tsx` | role-match |
| `apps/web/src/components/chats/chat-bubble-user.tsx` | component | request-response | `apps/web/src/components/session/chat-bubble.tsx` | exact |
| `apps/web/src/components/chats/chat-bubble-agent.tsx` | component | streaming | `apps/web/src/components/session/chat-bubble.tsx` | role-match |
| `apps/web/src/components/chats/tool-card.tsx` | component | event-driven | `apps/web/src/components/session/chat-bubble.tsx` (ChatThinkingBubble) | partial |
| `apps/web/src/components/chats/result-card.tsx` | component | request-response | `apps/web/src/components/session/chat-bubble.tsx` | partial |
| `apps/web/src/components/chats/streaming-cursor.tsx` | component | streaming | `apps/web/src/components/session/chat-bubble.tsx` (ChatThinkingBubble) | partial |
| `apps/web/src/components/chats/thinking-dots.tsx` | component | streaming | `apps/web/src/components/session/chat-bubble.tsx` (ChatThinkingBubble) | exact |
| `apps/web/src/components/chats/permission-prompt.tsx` | component | event-driven | `apps/web/src/components/session/chat-bubble.tsx` | partial |
| `apps/web/src/components/chats/system-message.tsx` | component | event-driven | `apps/web/src/components/session/chat-bubble.tsx` | partial |
| `apps/web/src/components/chats/model-avatar.tsx` | component | request-response | `apps/web/src/components/session/chat-bubble.tsx` (AgentAvatar) | exact |
| `apps/web/src/routes.tsx` | route | request-response | `apps/web/src/routes.tsx` 自身 | exact |
| `apps/web/src/i18n/messages.ts` | utility | — | `apps/web/src/i18n/messages.ts` 自身 | exact |
| `apps/gateway/src/store.ts` | model | CRUD | `apps/gateway/src/store.ts` 自身 | exact |
| `apps/gateway/src/chat-session-runner.ts` | service | streaming | `apps/gateway/src/session-runner-spawn.ts` | partial |
| `apps/gateway/src/relay-client.ts` | service | event-driven | `apps/gateway/src/relay-client.ts` 自身 | exact |
| `apps/relay/src/relay.ts` | service | event-driven | `apps/relay/src/relay.ts` 自身 | exact |
| `packages/protocol/src/index.ts` | utility | — | `packages/protocol/src/index.ts` 自身 | exact |
| `apps/server/sql/004_chat_messages.sql` | migration | CRUD | `apps/server/sql/002_gateway_runtime_sync.sql` | exact |
| `apps/server/app/controller/chat.ts` | controller | CRUD | `apps/server/app/controller/session.ts` | exact |
| `apps/server/app/service/chatRepository.ts` | service | CRUD | `apps/server/app/service/sessionRepository.ts` | exact |
| `apps/server/app/router.ts` | route | — | `apps/server/app/router.ts` 自身 | exact |
| `apps/server/app/controller/runtime-sync.ts` | controller | event-driven | `apps/server/app/controller/runtime-sync.ts` 自身 | exact |

---

## Pattern Assignments

---

### `apps/web/src/pages/chats-page.tsx` (page, request-response)

**Analog:** `apps/web/src/pages/session-control-page.tsx`（薄路由入口页）

**Imports pattern** (`apps/web/src/pages/session-control-page.tsx` lines 1-2):
```typescript
import { SessionSurface, type SessionSurfaceProps } from '../components/session/session-surface.js';
```

新页面同理，直接导入布局组件：
```typescript
import * as React from 'react';
import { useParams } from 'react-router-dom';
import { ChatsLayout } from '../components/chats/chats-layout.js';
```

**Core pattern** — 薄入口，把 sessionId 从 URL 取出传给布局组件：
```typescript
export function ChatsPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  return <ChatsLayout activeSessionId={sessionId} />;
}
```

**Auth pattern** — 不在页面内做鉴权，守卫由 `routes.tsx` 的 `RequireUserAuth` 承担（见 routes 部分）。

---

### `apps/web/src/components/chats/chat-bubble-user.tsx` (component, request-response)

**Analog:** `apps/web/src/components/session/chat-bubble.tsx`，`ChatBubble` 组件（role=user 分支，lines 62-117）

**Imports pattern** (lines 1-7):
```typescript
import * as React from 'react';
import { Bot, Terminal, X } from 'lucide-react';

import { useI18n } from '../../hooks/use-i18n.js';
```

**Core pattern** — 用户气泡：纯文本，右对齐（D-39），直接从旧 `ChatBubble` 拆出：
```typescript
// chat-bubble.tsx lines 62-117（提取 role=user 分支）
export function ChatBubbleUser({ content }: { content: string }) {
  // D-39: 用户气泡不渲染 Markdown，保留换行即可
  return (
    <div className="chat-row chat-row-user">
      <div className="chat-row-bubbles">
        <div className="chat-bubble chat-bubble-user">
          <div className="chat-bubble-content" style={{ whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        </div>
      </div>
      <UserAvatar />
    </div>
  );
}
```

**i18n pattern** — 通过 `useI18n()` 取 `t`，不硬编码文案：
```typescript
const { t } = useI18n();
// 然后用 t.chatRetry 等 key
```

---

### `apps/web/src/components/chats/chat-bubble-agent.tsx` (component, streaming)

**Analog:** `apps/web/src/components/session/chat-bubble.tsx`（ChatBubble role=agent 分支 + ChatThinkingBubble）

**Imports pattern:**
```typescript
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

import { useI18n } from '../../hooks/use-i18n.js';
import { StreamingCursor } from './streaming-cursor.js';
```

**Core streaming pattern** — 流式实时渲染（D-36/37/38）：
```typescript
// react-markdown + remark-gfm + rehype-highlight，已安装（RESEARCH.md confirmed）
export function ChatBubbleAgent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const renderText = isStreaming ? closeUnclosedFence(text) : text;
  return (
    <div className="chat-row chat-row-agent">
      <AgentAvatar />
      <div className="chat-row-bubbles">
        <div className="chat-bubble chat-bubble-agent">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              pre: CustomPre,   // 加复制按钮
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              ),
              img: ({ alt }) => (
                <span className="text-muted-foreground italic">[image: {alt ?? ''}]</span>
              )
            }}
          >
            {renderText}
          </ReactMarkdown>
          {isStreaming && <StreamingCursor />}
        </div>
      </div>
    </div>
  );
}

// D-38: 流式阶段补齐未闭合 code fence
function closeUnclosedFence(text: string): string {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  return fenceCount % 2 === 1 ? text + '\n```' : text;
}
```

---

### `apps/web/src/components/chats/tool-card.tsx` (component, event-driven)

**Analog:** HTML mockup `docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html` lines 194-255（CSS + HTML 参考）；`@tether/design` 的 `Collapsible` 组件（RESEARCH.md "Don't Hand-Roll"）

**Core pattern** — 可折叠工具调用卡片，用 `@tether/design` 的 `Collapsible`：
```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@tether/design';

export type ToolCardProps = {
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  defaultOpen?: boolean;
};

export function ToolCard({ toolName, input, result, isError, defaultOpen = false }: ToolCardProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="tool-card">
      <CollapsibleTrigger className="tool-card-header">
        <span className="tool-icon">fn</span>
        <span className="tool-name">{toolName}</span>
        <span className="tool-args-inline">{JSON.stringify(input).slice(0, 60)}</span>
        <ChevronRight className="tool-chevron" />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-card-body">
        <pre>{JSON.stringify(input, null, 2)}</pre>
        {result && (
          <div className={`tool-result ${isError ? 'tool-result-error' : ''}`}>
            <pre>{result}</pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

---

### `apps/web/src/components/chats/result-card.tsx` (component, request-response)

**Analog:** HTML mockup lines 373-400（`.result-card` CSS）；无直接 React 组件 analog

**Core pattern** — 花费卡片，追加在 agent 气泡下方（D-02c，不替换文本）：
```typescript
export type ResultCardProps = {
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_usd?: number;
  };
  durationMs?: number;
};

export function ResultCard({ usage, durationMs }: ResultCardProps) {
  const { t } = useI18n();
  return (
    <div className="result-card">
      {durationMs && (
        <div className="item">
          <span className="label">{t.chatsDuration}</span>
          <span className="value">{(durationMs / 1000).toFixed(1)}s</span>
        </div>
      )}
      <div className="item">
        <span className="label">{t.chatsInputTokens}</span>
        <span className="value">{usage.input_tokens}</span>
      </div>
      <div className="item">
        <span className="label">{t.chatsOutputTokens}</span>
        <span className="value">{usage.output_tokens}</span>
      </div>
      {usage.cost_usd != null && (
        <div className="item">
          <span className="label">{t.chatsCost}</span>
          <span className="value">${usage.cost_usd.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}
```

---

### `apps/web/src/components/chats/streaming-cursor.tsx` (component, streaming)

**Analog:** `apps/web/src/components/session/chat-bubble.tsx` lines 161-163（`.chat-typing-dots` 动画）

**Core pattern** — 闪烁光标，CSS 动画，纯展示组件：
```typescript
// 参考 chat-bubble.tsx 的 chat-typing-dots 动画写法
export function StreamingCursor() {
  return <span className="streaming-cursor" aria-hidden="true" />;
}
// CSS: @keyframes blink 闪烁，通过 className 与全局样式关联
```

---

### `apps/web/src/components/chats/thinking-dots.tsx` (component, streaming)

**Analog:** `apps/web/src/components/session/chat-bubble.tsx`，`ChatThinkingBubble`（lines 130-182，完整 analog）

**Core pattern** — 直接拆出 `ChatThinkingBubble` 内部的 thinking dots 部分（lines 161-163）：
```typescript
// chat-bubble.tsx lines 161-163：
<span className="chat-typing-dots" aria-label={t.agentTypingIndicator}>
  <span />
  <span />
  <span />
</span>
```

新 `ThinkingDots` 组件提取此模式，独立封装：
```typescript
import { useI18n } from '../../hooks/use-i18n.js';

export function ThinkingDots() {
  const { t } = useI18n();
  return (
    <span className="chat-typing-dots" aria-label={t.agentTypingIndicator}>
      <span /><span /><span />
    </span>
  );
}
```

---

### `apps/web/src/components/chats/permission-prompt.tsx` (component, event-driven)

**Analog:** 无直接 analog（旧 chat-bubble.tsx 中没有 permission prompt 实现）。参考 HTML mockup 中 amber 边框样式，使用 `@tether/design` 的 `InfoBlock` / `Alert`。

**Pattern** — amber 边框卡片，展示权限请求：
```typescript
import { InfoBlock } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';

export function PermissionPrompt({ toolName, description }: { toolName: string; description?: string }) {
  const { t } = useI18n();
  return (
    <InfoBlock variant="warning" title={t.chatsPermissionTitle}>
      <p>{t.chatsPermissionAsk.replace('{tool}', toolName)}</p>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
      <p className="text-muted-foreground text-xs mt-1">{t.chatsPermissionDeferred}</p>
    </InfoBlock>
  );
}
// 注：批准/拒绝实际执行逻辑属于 Phase 2，本 phase 只渲染提示
```

---

### `apps/web/src/components/chats/system-message.tsx` (component, event-driven)

**Analog:** 无直接 analog（旧 chat-bubble.tsx 没有 system-message pill）。参考 D-29 描述的"已切换至 X 模型"pill 样式。

**Pattern** — 居中 pill 样式，用于系统消息（如模型切换提示）：
```typescript
export function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center my-2">
      <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
        {text}
      </span>
    </div>
  );
}
```

---

### `apps/web/src/components/chats/model-avatar.tsx` (component, request-response)

**Analog:** `apps/web/src/components/session/chat-bubble.tsx`，`AgentAvatar`（lines 37-44）

**Exact analog** (`chat-bubble.tsx` lines 37-44):
```typescript
function AgentAvatar({ provider }: { provider?: string }) {
  void provider;
  return (
    <div className="chat-avatar chat-avatar-agent" aria-hidden="true">
      <Bot />
    </div>
  );
}
```

新 `ModelAvatar` 基于此模式，按 provider 区分颜色（D-09 Specifics：Claude=紫色系 #c084fc/#6366f1，Codex=蓝色系，opencode=橙色系）：
```typescript
export function ModelAvatar({ provider }: { provider: string }) {
  const gradient = providerGradient(provider); // 按 provider 返回 CSS gradient class
  return (
    <div className={`chat-avatar chat-avatar-agent ${gradient}`} aria-hidden="true">
      {providerInitial(provider)}
    </div>
  );
}
```

---

### `apps/web/src/routes.tsx` (route, request-response)

**Analog:** `apps/web/src/routes.tsx` 自身（lines 1-109）

**Imports pattern** (lines 1-9):
```typescript
import type * as React from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';

import { useAuth } from './hooks/use-auth.js';
import { readStoredNormalAuth } from './lib/api.js';
// ... 页面 import
```

**New routes pattern** — 新增 `/chats` 和 `/chats/:sessionId`，复用 `RequireUserAuth`（lines 38-61 模式）：
```typescript
// 在 Routes 内新增，紧接现有 /sessions 路由：
<Route
  path="/chats"
  element={(
    <RequireUserAuth>
      <ChatsPage />
    </RequireUserAuth>
  )}
/>
<Route
  path="/chats/:sessionId"
  element={(
    <RequireUserAuth>
      <ChatsPage />
    </RequireUserAuth>
  )}
/>

// catch-all 重定向从 /sessions 改为 /chats（D-06c）：
<Route path="*" element={<Navigate replace to="/chats" />} />
```

**RedirectAuthenticated 同步修改** (line 105)：
```typescript
// 原来：return <Navigate replace to="/sessions" />;
// 改为：return <Navigate replace to="/chats" />;
```

---

### `apps/web/src/i18n/messages.ts` (utility, —)

**Analog:** `apps/web/src/i18n/messages.ts` 自身（lines 1-6，WEB_MESSAGES 对象结构）

**Pattern** — 在 `zh` 和 `en` 两个 key 下同步添加所有新文案（apps/web/CLAUDE.md 规定）：
```typescript
// 在 zh: { ... } 和 en: { ... } 各自添加对应文案，示例位于 lines 6-80
// 现有模式（lines 117-133 chat 相关 key 示例）：
chatThinking: '思考中',
chatThinkingDeep: '正在深度思考',
chatStopGen: '停止',
// 新增 key 格式（chats 前缀区别旧 chat 前缀）：
chatsNavLabel: 'Chats',
chatsNewSession: '新建会话',
chatsSend: '发送',
chatsInputPlaceholder: '输入消息…',
chatsDuration: '耗时',
chatsInputTokens: '输入 token',
chatsOutputTokens: '输出 token',
chatsCost: '费用',
chatsPermissionTitle: '权限请求',
chatsPermissionAsk: '{tool} 申请操作权限',
chatsPermissionDeferred: '批准/拒绝将在后续版本实现',
chatsInFlight: 'AI 正在回复…',
chatsReplyLost: '回复丢失，请重试',
chatsSelectProvider: '选择工具',
chatsSelectModel: '选择模型',
chatsCwd: '工作目录',
chatsModelSwitched: '已切换至 {provider} · {model}，上下文已摘要传入',
// ... en 对应翻译
```

---

### `apps/gateway/src/store.ts` (model, CRUD)

**Analog:** `apps/gateway/src/store.ts` 自身（完整文件，lines 1-437）

**Constructor DDL pattern** (lines 106-141）——在 `constructor` 内 `CREATE TABLE IF NOT EXISTS`：
```typescript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (...);
  CREATE TABLE IF NOT EXISTS session_events (...);
  CREATE INDEX IF NOT EXISTS idx_session_events_cursor ...;
`);
this.migrate();
```

**新增 `session_chats_events` 表** — 同样在 constructor exec 块内追加（D-40）：
```sql
CREATE TABLE IF NOT EXISTS session_chats_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  type         TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_chats_events_cursor
  ON session_chats_events(session_id, id);
```

**新增方法 pattern** — 仿照 `appendEvent`（lines 236-255）和 `listEvents`（lines 257-268）：
```typescript
// appendEvent 模式（lines 236-255）：
appendChatEvent(sessionId: string, type: ChatEventType, payload: Record<string, unknown>, ts = Date.now()): void {
  this.db
    .prepare('INSERT INTO session_chats_events (session_id, type, ts, payload_json) VALUES (?, ?, ?, ?)')
    .run(sessionId, type, ts, JSON.stringify(payload));
}

listChatEvents(sessionId: string): ChatEvent[] {
  const rows = this.db
    .prepare('SELECT * FROM session_chats_events WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as ChatEventRow[];
  return rows.map(chatEventFromRow);
}
```

**migrate() pattern** (lines 311-354) — 仿照已有列检测，新增 `sessions` 表缺失列检测：
```typescript
// 如需给 sessions 表加列（如 transport='chat' 不需要新列，transport 列已存在）
// 参考 lines 317-352 各列的 if (!columns.has(...)) 检测模式
```

---

### `apps/gateway/src/chat-session-runner.ts` (service, streaming)

**Analog:** `apps/gateway/src/session-runner-spawn.ts`（参考模式，不复用代码，D-00）

**spawn 参考** (`session-runner-spawn.ts` lines 17-24)：
```typescript
// PTY 链路 spawn（仅作对比参考，chat 链路独立实现）：
const child = spawn(process.execPath, [...NODE_RUNTIME_FLAGS, ...runnerExecArgv(), entry, payload], {
  detached: true,
  stdio: 'ignore',  // PTY 不用 piped
  env: process.env
});
child.unref();
```

**新 ChatSessionRunner piped subprocess pattern**（D-01b，独立实现）：
```typescript
import { spawn, type ChildProcess } from 'node:child_process';

// 内存 Map：活跃 subprocess + 累积文本 buffer（D-45）
const activeSubprocesses = new Map<string, {
  process: ChildProcess;
  accumulatedText: string;
  startedAt: number;
}>();

// spawn 方式（piped，非 PTY）
const child = spawn('claude', [
  '-p', message,
  '--output-format', 'stream-json',
  ...(aiSessionId ? ['--resume', aiSessionId] : [])
], {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

// stdout 解析（NDJSON，每行一个 JSON）
let lineBuffer = '';
child.stdout.on('data', (chunk: Buffer) => {
  lineBuffer += chunk.toString();
  const lines = lineBuffer.split('\n');
  lineBuffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      handleStreamEvent(event, sessionId, onFrame);
    } catch { /* skip bad line */ }
  }
});
```

---

### `apps/gateway/src/relay-client.ts` (service, event-driven)

**Analog:** `apps/gateway/src/relay-client.ts` 自身（lines 140-169，`handleFrame` switch）

**handleFrame switch pattern** (lines 140-169):
```typescript
const handleFrame = (frame: RelayServerToGatewayFrame) => {
  switch (frame.type) {
    case 'gateway.auth.ok':
      setConnectionState('connected');
      void sendSessions();
      return;
    case 'client.subscribe':
      void subscribeClient(...);
      return;
    // ...
  }
};
```

**新增 `client.chat` 分支** — 在 switch 内追加：
```typescript
case 'client.chat':
  void handleChatFrame(frame.clientId, frame.sessionId, frame);
  return;
case 'client.list-providers':
  void sendProviderList(frame.clientId);
  return;
case 'client.switch-model':
  void handleSwitchModel(frame.clientId, frame.sessionId, frame.provider, frame.model);
  return;
```

**send 方法 pattern** (lines 126-130)：
```typescript
const send = (frame: RelayGatewayToServerFrame) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
};
```

---

### `apps/relay/src/relay.ts` (service, event-driven)

**Analog:** `apps/relay/src/relay.ts` 自身（lines 59-87）

**RUNTIME_EVENT_WHITELIST pattern** (lines 59-65):
```typescript
const RUNTIME_EVENT_WHITELIST = new Set([
  'terminal.output',
  'terminal.input',
  'session.error',
  'session.exited',
  'agent.status'
]);
```

**扩展 whitelist**（D-21，Pitfall 2）：
```typescript
const RUNTIME_EVENT_WHITELIST = new Set([
  'terminal.output',
  'terminal.input',
  'session.error',
  'session.exited',
  'agent.status',
  'agent.result',   // 新增：触发写 gateway_chat_messages
  'agent.tool'      // 新增：触发写 gateway_runtime_events
]);
```

**syncToServer pattern** (lines 67-87):
```typescript
async function syncToServer(endpoint: string, body: unknown): Promise<void> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) return;
  try {
    const response = await fetch(`${options.serverSyncUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': options.runtimeSyncSecret
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) console.warn(`[relay] sync failed: ${endpoint} HTTP ${response.status}`);
  } catch (error) {
    console.warn(`[relay] sync error: ${endpoint}`, String(error));
  }
}
```

**parseFrame + hasForbiddenKey pattern** (lines 716-741) — 新 `client.chat` 帧同样需通过 `hasForbiddenKey` 检查：
```typescript
// hasForbiddenKey 在 gateway.message 处理前已有（lines 728-741），
// client.chat 帧在 handleClient 路径上同样受 hasForbiddenKey 保护
```

---

### `packages/protocol/src/index.ts` (utility, —)

**Analog:** `packages/protocol/src/index.ts` 自身（lines 51-89，现有帧类型 discriminated union）

**Discriminated union pattern** (lines 51-89):
```typescript
export type RelayGatewayToServerFrame =
  | { type: 'gateway.auth'; ... }
  | { type: 'gateway.sessions'; ... }
  | { type: 'gateway.event'; gatewayId: string; event: RelayTerminalEvent };

export type RelayClientToServerFrame =
  | { type: 'client.auth'; ... }
  | { type: 'client.chat'; sessionId: string; message: string };  // 当前旧结构

export type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'error'; sessionId?: string; code: string; message: string };
```

**新增帧** — 按相同 discriminated union 模式追加：
```typescript
// RelayClientToServerFrame 修改 client.chat：
| { type: 'client.chat'; sessionId: null; provider: string; model: string; cwd: string; message: string }
| { type: 'client.chat'; sessionId: string; message: string }
| { type: 'client.list-providers' }
| { type: 'client.switch-model'; sessionId: string; provider: string; model: string }

// RelayServerToGatewayFrame 新增：
| { type: 'client.chat'; clientId: string; sessionId: string | null; provider?: string; model?: string; cwd?: string; message: string }
| { type: 'client.list-providers'; clientId: string }
| { type: 'client.switch-model'; clientId: string; sessionId: string; provider: string; model: string }

// RelayGatewayToServerFrame 新增：
| { type: 'gateway.session-created'; gatewayId: string; clientId: string; sessionId: string }
| { type: 'gateway.chat-catchup'; gatewayId: string; clientId: string; sessionId: string; text: string }

// RelayServerToClientFrame 新增：
| { type: 'gateway.session-created'; sessionId: string }
| { type: 'agent.delta'; sessionId: string; text: string }
| { type: 'agent.result'; sessionId: string; text: string; usage: { input_tokens: number; output_tokens: number; cost_usd?: number }; stop_reason?: string }
| { type: 'agent.tool'; sessionId: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
| { type: 'gateway.chat-catchup'; sessionId: string; text: string }
| { type: 'gateway.providers'; providers: Array<{ provider: string; models: string[] }> }
```

---

### `apps/server/sql/004_chat_messages.sql` (migration, CRUD)

**Analog:** `apps/server/sql/002_gateway_runtime_sync.sql`（lines 1-59，MySQL CREATE TABLE 格式）

**Pattern** (lines 1-33 of 002 as reference):
```sql
CREATE TABLE IF NOT EXISTS gateway_sessions (
  id VARCHAR(128) NOT NULL,
  ...
  PRIMARY KEY (id),
  KEY idx_gateway_sessions_account_workspace (account_id, workspace_id)
);
```

**新迁移文件** (D-41)：
```sql
-- migration 003 已 DROP 旧表，004 重建新结构
CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  session_id  VARCHAR(128) NOT NULL,
  role        VARCHAR(16)  NOT NULL,        -- 'user' | 'assistant'
  content     MEDIUMTEXT   NOT NULL,
  usage_json  TEXT         DEFAULT NULL,    -- { input_tokens, output_tokens, cost_usd }，仅 assistant 行
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_messages_session_id (session_id)
);
```

---

### `apps/server/app/controller/chat.ts` (controller, CRUD)

**Analog:** `apps/server/app/controller/session.ts`（lines 1-41，完整文件）

**完整 analog** (`session.ts` lines 1-41):
```typescript
import { Controller } from 'egg';

type AuthScope = {
  accountId?: string; workspaceId?: string; userId?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; workspaceId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    workspaceId: auth?.workspaceId ?? '',
    userId: auth?.userId ?? ''
  };
}

export default class SessionController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId, userId } = authScope(ctx);
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const sessions = await ctx.service.sessionRepository.listSessions(accountId, workspaceId, userId, limit, 0);
    ctx.success({ sessions });
  }
}
```

**新 ChatController**（复制此模式）：
```typescript
import { Controller } from 'egg';

export default class ChatController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId } = authScope(ctx);
    const sessions = await ctx.service.chatRepository.listChatSessions(accountId, workspaceId);
    ctx.success({ sessions });
  }

  public async messages(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    const messages = await ctx.service.chatRepository.listMessages(sessionId, accountId, workspaceId);
    ctx.success({ messages });
  }
}
```

**规则**（server/CLAUDE.md）：controller 只做四件事：取参数、最小归一化、调用 `ctx.service`、`ctx.success(data)`。

---

### `apps/server/app/service/chatRepository.ts` (service, CRUD)

**Analog:** `apps/server/app/service/sessionRepository.ts`（lines 1-80+）

**Service class pattern** (`sessionRepository.ts` lines 1-30):
```typescript
import { Service } from 'egg';

export default class SessionRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  private sqlDateToMs(value: unknown): number { ... }
  private nullableString(value: unknown): string | undefined { ... }
  private parseJsonObject(value: unknown): Record<string, unknown> { ... }
  private sessionFromRow(row: Record<string, unknown>): GatewaySessionRecord { ... }
}
```

**Query pattern** (`sessionRepository.ts` lines 80+，通过 `ctx.service.db.query`）：
```typescript
// 新 chatRepository：
export default class ChatRepositoryService extends Service {
  public async listChatSessions(accountId: string, workspaceId: string): Promise<ChatSession[]> {
    const rows = await this.ctx.service.db.query(
      `SELECT * FROM gateway_sessions
       WHERE account_id = ? AND workspace_id = ? AND transport = 'chat'
       ORDER BY last_active_at DESC LIMIT 50`,
      [accountId, workspaceId]
    );
    return (rows as Record<string, unknown>[]).map(this.sessionFromRow.bind(this));
  }

  public async listMessages(sessionId: string, accountId: string, workspaceId: string) {
    // 先校验 sessionId 属于当前 account（参考 runtimeSyncRepository.ts sessionWithinScope）
    const rows = await this.ctx.service.db.query(
      `SELECT gcm.* FROM gateway_chat_messages gcm
       JOIN gateway_sessions gs ON gs.id = gcm.session_id
       WHERE gcm.session_id = ? AND gs.account_id = ? AND gs.workspace_id = ?
       ORDER BY gcm.created_at ASC`,
      [sessionId, accountId, workspaceId]
    );
    return (rows as Record<string, unknown>[]).map(this.messageFromRow.bind(this));
  }
}
```

---

### `apps/server/app/router.ts` (route, —)

**Analog:** `apps/server/app/router.ts` 自身（lines 1-44）

**Route registration pattern** (lines 5-40):
```typescript
const requireNormalAccess = middleware.requireTokenClass({ expected: ['normal_client_access'] });

// 现有模式：
router.get('/api/server/sessions', requireNormalAccess, controller.session.list);
router.get('/api/server/sessions/:id/events', requireNormalAccess, controller.session.events);

// 新增（D-42，路径前缀 /api/server/）：
router.get('/api/server/chat-sessions', requireNormalAccess, controller.chat.sessions);
router.get('/api/server/chat-sessions/:sessionId/messages', requireNormalAccess, controller.chat.messages);
```

---

## Shared Patterns

### 认证（Auth）

**Source:** `apps/web/src/routes.tsx` lines 80-94（`RequireUserAuth`）
**Apply to:** `chats-page.tsx` 路由声明（由 routes.tsx 承担，页面内不做）
```typescript
function RequireUserAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  if (!authReady) return null;
  if (!storedNormalAuth) return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  return <>{children}</>;
}
```

### HTTP API 调用（Web 侧）

**Source:** `apps/web/src/lib/api.ts` lines 1-115（`createHttpClient()`、`getStoredNormalAccessToken`）
**Apply to:** `chats-page.tsx` 内的 HTTP 调用（会话列表、历史消息）
```typescript
// 现有模式（api.ts lines 96-113）：
const http = createHttpClient();
// token 通过 createHttpClient() 内部的 getStoredNormalAccessToken 自动附加

// 新增 chat API 函数（放在 api.ts 中，或新建 apps/web/src/lib/chat-api.ts）：
export async function fetchChatSessions() {
  return http.get<{ sessions: ChatSession[] }>('/api/server/chat-sessions');
}

export async function fetchChatMessages(sessionId: string) {
  return http.get<{ messages: ChatMessage[] }>(`/api/server/chat-sessions/${sessionId}/messages`);
}
```

### WS 帧发送（Web 侧）

**Source:** `apps/web/src/components/session/session-surface.tsx` lines 146-148（`sendRelayFrame`）
**Apply to:** ChatsLayout / ChatPanel 中的 WS 帧发送
```typescript
function sendRelayFrame(ws: WebSocket, frame: RelayClientToServerFrame): void {
  ws.send(JSON.stringify(frame));
}

function parseWsFrame(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const frame = JSON.parse(data) as unknown;
    if (frame && typeof frame === 'object' && !Array.isArray(frame)) return frame as Record<string, unknown>;
  } catch { return undefined; }
  return undefined;
}
```

### WS Relay URL 构建

**Source:** `apps/web/src/components/session/session-surface.tsx` lines 111-129（`buildRelayClientUrl`）
**Apply to:** ChatsLayout 内建立 WS 连接
```typescript
function buildRelayClientUrl(relayUrl: string, t: WebMessages): string {
  const url = new URL(relayUrl.trim());
  // ws:/wss: 协议检测
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
```

### Server Controller 响应格式

**Source:** `apps/server/app/controller/session.ts` lines 19-26（`ctx.success(data)`）
**Apply to:** `apps/server/app/controller/chat.ts`
```typescript
// 成功：ctx.success({ sessions })
// 错误：ctx.throw(status, msg)（交给 error middleware）
// 不手写 try/catch，不直接 ctx.error()
```

### Gateway SQLite 查询 pattern

**Source:** `apps/gateway/src/store.ts` lines 144-268（`listSessions`、`appendEvent`、`listEvents`）
**Apply to:** `apps/gateway/src/store.ts` 新增 chat 相关方法
```typescript
// prepare + run 模式（lines 244-248）：
this.db
  .prepare('INSERT INTO session_events (session_id, type, ts, payload_json) VALUES (?, ?, ?, ?)')
  .run(sessionId, type, ts, JSON.stringify(payload));

// prepare + all 模式（lines 261-265）：
const rows = this.db
  .prepare('SELECT * FROM session_events WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
  .all(sessionId, after, safeLimit) as SessionEventRow[];
```

### Relay syncToServer 调用

**Source:** `apps/relay/src/relay.ts` lines 67-87（`syncToServer` 函数）
**Apply to:** `apps/relay/src/relay.ts` 中 `agent.result` / `agent.tool` 事件处理
```typescript
// 调用 syncToServer 写 gateway_chat_messages：
await syncToServer('/api/relay/runtime-sync/gateway/chat-message', {
  scope: { accountId, workspaceId, gatewayId },
  message: { sessionId, role: 'assistant', content: text, usageJson: JSON.stringify(usage) }
});
```

### i18n 文案使用 pattern

**Source:** `apps/web/src/pages/login-page.tsx` lines 22-23；`apps/web/src/components/session/chat-bubble.tsx` line 71
**Apply to:** 所有新 chats 组件和页面
```typescript
const { t } = useI18n();
// 然后用 t.chatsNavLabel 等 key（不硬编码中英文字符串）
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/web/src/components/chats/chats-layout.tsx` | component | request-response | 三栏飞书式布局（56px + 280px + flex-1）在现有 app 中无先例，参考 RESEARCH.md D-07a/b/c 和 HTML mockup |
| `apps/web/src/components/chats/chat-session-list.tsx` | component | request-response | 带头像、预览、时间戳的会话列表，现有 session 列表走终端模式无气泡列表先例 |

这两个文件从 RESEARCH.md Pattern 6（HTTP 加载时序）和 HTML mockup CSS 变量直接参考实现。

---

## Metadata

**Analog search scope:** `apps/web/src/`、`apps/gateway/src/`、`apps/relay/src/`、`apps/server/app/`、`packages/protocol/src/`、`apps/server/sql/`
**Files scanned:** 18 个已有文件（直接 Read）
**Pattern extraction date:** 2026-05-10
