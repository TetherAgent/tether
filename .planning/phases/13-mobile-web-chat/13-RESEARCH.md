# Phase 13: Mobile Web Chat - Research

**Researched:** 2026-05-10
**Domain:** React WebSocket Chat UI / Gateway subprocess pipeline / Server HTTP API
**Confidence:** HIGH

---

## Summary

本阶段在现有 `apps/web`（React + Vite + Tailwind CSS v4 + `@tether/design`）中新增 `/chats` 路由，实现类微信三栏聊天界面，通过 Relay WS → Gateway `stream-json subprocess` 链路执行 AI 对话，并将历史通过 HTTP 从 Server DB 加载。

**核心交付物分为 6 条实现主线：**

1. **Protocol 扩展**：在 `packages/protocol/src/index.ts` 中添加所有新帧类型（目前 `client.chat` 仅有旧结构，需要扩展 `sessionId: null | string`，并新增 `gateway.session-created`、`agent.delta`、`agent.result`、`agent.tool`、`gateway.chat-catchup`、`client.list-providers`、`client.switch-model` 等帧）。
2. **Gateway ChatSessionRunner**：新独立模块，piped subprocess（非 PTY），解析 `--output-format stream-json` stdout，维护 in-memory buffer，写入 `session_chats_events` 表。
3. **Relay 路由更新**：处理新帧的 Relay 转发逻辑，扩展 `syncToServer` 白名单（加入 `agent.result`、`agent.tool`）。
4. **Server DB 迁移**：`apps/server/sql/004_chat_messages.sql` 重建 `gateway_chat_messages` 表（去掉 `turn_index`/`tools_json`，新增 `usage_json`），新增两个 HTTP API（`GET /api/server/chat-sessions` 和 `GET /api/server/chat-sessions/:id/messages`）。
5. **Web UI**：新增 `/chats` 和 `/chats/:sessionId` 路由，三栏布局，Markdown 渲染，WebSocket chat 帧收发，移动端响应。
6. **Relay 同步**：Gateway 写 `session_chats_events` → Relay 收到 `gateway.event` 帧 → syncToServer 同步 `agent.result` 到 `gateway_chat_messages`。

**Primary recommendation:** 严格按 D-00 执行链路隔离——chat 链路所有代码独立于 PTY 链路，不复用任何 PTY 或 JournalWatcher 代码。新帧类型先在 `packages/protocol` 定义，再在 Relay 和 Gateway 中实现。

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-00:** 全新独立 chat 链路，不依赖 PTY / JournalWatcher（均已删除）。Gateway 侧新增 `ChatSessionRunner`：piped subprocess（非 PTY），每条消息一次 spawn，通过 `--resume` 续接上下文。独立可运行，不复用任何 PTY 或 JournalWatcher 代码。
- **D-01:** Web 发消息走 `client.chat` WS 帧，两种形式：首条 `{ type: 'client.chat', sessionId: null, provider, model, cwd, message }`；续接 `{ type: 'client.chat', sessionId: string, message }`。
- **D-01b:** Gateway 执行：`spawn('claude', ['-p', message, '--output-format', 'stream-json', ...(aiSessionId ? ['--resume', aiSessionId] : [])], { cwd })`
- **D-02:** 认证复用现有 WS 通道（`client.auth` → `client.auth.ok`）。
- **D-02b:** 新 Relay 事件：`content_block_delta text → agent.delta`，`message_stop → agent.result`，`tool_use → agent.tool`，`error → session.error`（已有）。
- **D-02c:** `agent.result` 到网页后追加花费卡片，不替换流式文本。
- **D-06b:** 路由：`/chats`（默认）和 `/chats/:sessionId`。组件：`ChatsLayout`、`ChatSessionList`、`ChatPanel`。
- **D-06c:** 登录后默认跳转改为 `/chats`（现为 `/sessions`）。旧 `/sessions` 路由保留。
- **D-07a/b/c:** 三栏布局（56px 导航 + 280px 会话列表 + flex-1 聊天区）。
- **D-08:** 移动端 <768px 折叠为汉堡菜单 + `Sheet` 抽屉。
- **D-20:** Gateway SQLite 写 `session_chats_events`：`user.message`（立即）、`agent.result`（message_stop 后）、`agent.tool`。
- **D-21:** Relay 同步 `agent.result` / `agent.tool` / `session.error` → Server DB `gateway_chat_messages` + `gateway_runtime_events`。
- **D-22:** Gateway 查本地 `sessions.agent_session_id`；本地无则从 Server DB `gateway_sessions` 拉取。
- **D-23/24:** Gateway 工具归一化层，`ClaudeChatRunner` / `CodexChatRunner` / `CopilotChatRunner`。
- **D-26/27:** 两层选择（provider + model）；`client.list-providers` 触发 Gateway 检测。
- **D-29:** 支持 `client.switch-model` 中途切换，摘要上下文。
- **D-32:** 隐式会话创建——第一条 `client.chat` 触发 Gateway 创建 session，回 `gateway.session-created { sessionId }`。
- **D-33:** `session_chats_events` 不写 `agent.delta`，仅写完整事件。
- **D-34:** cwd 在首条消息时选定，不可修改。
- **D-35:** 跨 Gateway 机器无法续接。
- **D-36/37/38:** react-markdown + remark-gfm + rehype-highlight，流式实时渲染，`agent.result` 后完整重渲染。
- **D-39:** 用户气泡纯文本，AI 气泡完整 Markdown。
- **D-40:** Gateway SQLite 新表 `session_chats_events`（DDL 见 CONTEXT.md），在 `store.ts` constructor 内 `CREATE IF NOT EXISTS`。
- **D-41:** Server DB MySQL 迁移文件 `apps/server/sql/004_chat_messages.sql`，重建 `gateway_chat_messages`（去掉 `turn_index`/`tools_json`，新增 `usage_json`）。
- **D-42:** HTTP API：`GET /api/server/chat-sessions`（会话列表），`GET /api/server/chat-sessions/:sessionId/messages`（历史消息）——均 `normal_client_access`。
- **D-43:** HTTP 负责历史，WS 负责实时，两条通道严格隔离。
- **D-44:** In-flight 锁——从 `client.chat` 发出到 `agent.result` 到达，输入框和发送按钮禁用。
- **D-45:** Gateway subprocess 独立于 WS 连接运行；维护 in-memory buffer（`Map<sessionId, { accumulatedText }>`）；重连后发 `gateway.chat-catchup { sessionId, text: accumulatedText }`；subprocess 崩溃时显示"回复丢失"。

### Claude's Discretion
- **D-25 待研究：** Codex CLI 和 Copilot CLI 的流式输出格式、session 续接机制、工具可用性检测。
- **D-30 待研究：** `claude` 命令是否暴露订阅信息（`claude config` / `claude status`）。

### Deferred Ideas (OUT OF SCOPE)
- PWA push 通知
- Flutter 客户端（Phase 9）
- 多 workspace 切换（Phase 10）
- 会话内权限审批实际执行逻辑
- 离线模式
- 多 Gateway 跨机器续接
</user_constraints>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chat UI 路由 + 布局 | Browser (React) | — | 三栏布局、响应式切换均在客户端 |
| 历史消息加载 | Browser → Server HTTP | — | D-43：HTTP 专职历史，禁止通过 WS 推历史 |
| WS 实时帧收发 | Browser ↔ Relay ↔ Gateway | — | client.chat / agent.delta / agent.result 的实时通道 |
| claude subprocess 执行 | Gateway | — | 本地执行，piped stdin/stdout，非 PTY |
| stream-json 事件解析 | Gateway | — | 内部管道解析，Gateway 独有职责 |
| session_chats_events 存储 | Gateway SQLite | — | D-40 独立表，PTY 链路隔离 |
| 会话元数据同步到 Server | Relay → Server HTTP | — | D-21 syncToServer 调用 |
| gateway_chat_messages 存储 | Server DB (MySQL) | — | D-41 migration 004 |
| chat-sessions HTTP API | Server (Egg.js) | — | D-42 normal_client_access 读接口 |
| Markdown 渲染 | Browser | — | react-markdown 在客户端 |
| in-memory delta buffer | Gateway 内存 | — | D-45 reconnect catchup |
| 工具可用性检测 | Gateway | — | 检测本机 CLI 安装状态 |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | 10.1.0 | Markdown 渲染 | **已安装**，项目已引入 |
| remark-gfm | 4.0.1 | GFM 扩展（表格、strikethrough） | **已安装** |
| rehype-highlight | 7.0.2 | 代码块语法高亮 | **已安装** |
| highlight.js | 11.11.1 | 高亮主题（github/github-dark） | **已安装** |
| @tether/design | workspace:* | UI 组件（Sheet、Collapsible、Textarea 等） | 项目设计系统 |
| lucide-react | 1.14.0 | 图标（MessageSquare、Menu、Send 等） | **已安装**，apps/web 规范要求 |
| better-sqlite3 / node:sqlite | 已在 Gateway 使用 | Gateway SQLite 数据库 | 现有模式：`DatabaseSync` from `node:sqlite` |

[VERIFIED: package.json] react-markdown@10.1.0、remark-gfm@4.0.1、rehype-highlight@7.0.2 均已在 `apps/web/package.json` 的 `dependencies` 中。**无需额外安装**。

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process spawn | Node.js 内置 | Chat subprocess 非 PTY 执行 | ChatSessionRunner 中用 piped stdio |
| @tether/http | workspace:* | HTTP client（Web 侧调用 Server API） | 复用现有 `createHttpClient()` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| rehype-highlight | react-syntax-highlighter | rehype-highlight 已安装且体积更小 |
| highlight.js github 主题 | shiki | shiki 未安装，rehype-highlight 已满足需求 |
| react-markdown 实时渲染 | 等 agent.result 后渲染 | D-38 明确要求实时渲染 |

**Installation:** 无需新安装——所有 Markdown 渲染依赖已在 apps/web 中。

---

## Architecture Patterns

### System Architecture Diagram

```
[Browser /chats]
    │
    │ 1. HTTP GET /api/server/chat-sessions          (历史加载)
    │ 2. HTTP GET /api/server/chat-sessions/:id/messages
    ▼
[Server (Egg.js)]
    │ gateway_sessions / gateway_chat_messages (MySQL)
    │
    │ (列表/消息渲染完成后)
    │
[Browser WS /ws/client] ──client.auth──► [Relay]
    │                                         │
    │ client.chat {sessionId:null,...}         │ 转发 client.chat
    │                                         ▼
    │                                    [Gateway]
    │                                         │ ChatSessionRunner
    │                                         │ spawn('claude', ['-p', msg, '--output-format', 'stream-json'])
    │                                         │ stdout: content_block_delta ──► agent.delta
    │                                         │ stdout: message_stop        ──► agent.result
    │                                         │ stdout: tool_use            ──► agent.tool
    │                                         │
    │                   gateway.session-created│ (首条消息时)
    │ ◄────────────────────────────────────────┤
    │ agent.delta ◄────────────────────────────┤ (实时流)
    │ agent.result ◄───────────────────────────┤
    │                                         │
    │                                         │ INSERT session_chats_events (SQLite)
    │                                         │ send gateway.event → [Relay]
    │                                         │         │
    │                                         │         ▼ syncToServer (void, 不阻塞)
    │                                         │    [Server HTTP /api/relay/runtime-sync]
    │                                         │    INSERT gateway_chat_messages (MySQL)
    │
    │ [Browser 断线重连]
    │    HTTP 加载历史 → 发现 last=user.message 无 agent.result → 占位气泡
    │ ──WS 重连──► [Relay] ──► [Gateway]
    │                               │ 有活跃 subprocess → 发 gateway.chat-catchup {text: accumulatedText}
    │ ◄─── gateway.chat-catchup ────┤
    │    替换占位气泡，继续接 agent.delta
```

### Recommended Project Structure

```
packages/protocol/src/
└── index.ts                    # 新增 chat 帧类型（扩展现有文件）

apps/gateway/src/
├── store.ts                    # 新增 session_chats_events 表 DDL + 方法
├── relay-client.ts             # 新增 client.chat 处理（ChatSessionRunner 集成）
└── chat-session-runner.ts      # 新建：ChatSessionRunner（piped subprocess）

apps/relay/src/
└── relay.ts                    # 扩展 RUNTIME_EVENT_WHITELIST + handleClientFrame 新帧

apps/server/sql/
└── 004_chat_messages.sql       # 新建：重建 gateway_chat_messages + 添加 agent_session_id 列

apps/server/app/
├── controller/chat.ts          # 新建：chat-sessions list + messages 接口
├── service/chatRepository.ts   # 新建：gateway_chat_messages 数据访问
└── router.ts                   # 新增路由：GET /api/server/chat-sessions[/:id/messages]

apps/web/src/
├── routes.tsx                  # 新增 /chats 和 /chats/:sessionId 路由
├── pages/chats-page.tsx        # 新建：ChatsPage（路由入口）
├── components/chats/
│   ├── chats-layout.tsx        # 三栏布局外壳
│   ├── chat-session-list.tsx   # 左中两栏（56px + 280px）
│   ├── chat-panel.tsx          # 右栏（聊天区）
│   ├── chat-bubble-user.tsx    # 用户气泡（纯文本）
│   ├── chat-bubble-agent.tsx   # AI 气泡（Markdown）
│   ├── tool-card.tsx           # 工具调用卡片（Collapsible）
│   ├── result-card.tsx         # 花费卡片
│   ├── streaming-cursor.tsx    # 流式光标
│   ├── thinking-dots.tsx       # 等待动画
│   ├── permission-prompt.tsx   # 权限提示（amber 边框）
│   ├── system-message.tsx      # 系统消息 pill
│   └── model-avatar.tsx        # 模型头像（渐变色）
└── i18n/messages.ts            # 新增 chat 相关文案 key
```

### Pattern 1: 新帧类型在 Protocol 中的定义方式

**What:** 所有新帧必须添加到 `packages/protocol/src/index.ts` 的 discriminated union 类型。

**When to use:** 任何跨越 Relay 边界的新通信类型。

**现有帧格式参考：**
```typescript
// Source: packages/protocol/src/index.ts（当前状态）
// 当前 client.chat 只有旧结构：
// RelayClientToServerFrame: { type: 'client.chat'; sessionId: string; message: string }
// RelayServerToGatewayFrame: { type: 'client.chat'; clientId: string; sessionId: string; message: string }

// 需要扩展/新增：
// client.chat 首条（sessionId 为 null）需要在 RelayClientToServerFrame 中支持：
// { type: 'client.chat'; sessionId: null; provider: string; model: string; cwd: string; message: string }
// | { type: 'client.chat'; sessionId: string; message: string }

// 新增 Server→Client 帧：
// gateway.session-created: { type: 'gateway.session-created'; sessionId: string }
// agent.delta:             { type: 'agent.delta'; sessionId: string; text: string }
// agent.result:            { type: 'agent.result'; sessionId: string; text: string; usage: {...} }
// agent.tool:              { type: 'agent.tool'; sessionId: string; name: string; input: Record<string,unknown>; result?: string; isError?: boolean }
// gateway.chat-catchup:    { type: 'gateway.chat-catchup'; sessionId: string; text: string }
// client.list-providers:   { type: 'client.list-providers' }（RelayClientToServerFrame）
// client.switch-model:     { type: 'client.switch-model'; sessionId: string; provider: string; model: string }
```

### Pattern 2: Gateway ChatSessionRunner（piped subprocess）

**What:** 非 PTY、piped stdio subprocess，解析 `--output-format stream-json` NDJSON stdout。

**When to use:** 每条 `client.chat` 消息触发一次 spawn（使用 `--resume` 续接）。

**设计要点：**
```typescript
// Source: [CITED: CONTEXT.md D-01b]
// 参考模式（不复用 session-runner-spawn.ts，独立实现）
import { spawn } from 'node:child_process';

// 执行方式
const child = spawn('claude', [
  '-p', message,
  '--output-format', 'stream-json',
  ...(aiSessionId ? ['--resume', aiSessionId] : [])
], {
  cwd,       // D-34: 首条消息时指定，后续固定
  stdio: ['ignore', 'pipe', 'pipe'],  // piped stdout（非 PTY）
  env: process.env
});

// stdout 解析：NDJSON，每行一个 JSON 对象
child.stdout.on('data', (chunk) => {
  // 按行分割，解析每个 JSON event
  for (const line of chunk.toString().split('\n')) {
    const event = tryParseJson(line);
    if (!event) continue;
    
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      // 追加到 accumulatedText buffer（D-45）
      // emit agent.delta 到 Relay
    }
    if (event.type === 'message_stop') {
      // 写库 session_chats_events (agent.result)
      // 写库 sessions.agent_session_id
      // emit agent.result 到 Relay
      // 清除 buffer
    }
    if (event.type === 'tool_use' || event.type === 'tool_result') {
      // emit agent.tool 到 Relay
    }
  }
});
```

**关键：`ai_session_id` 获取位置**（CONTEXT.md 标注"待研究"）：
- [ASSUMED] `--output-format stream-json` 中，`session_id` 通常在最终的 `result` 事件里，或在 `message_start` / `message_stop` 中作为 `session_id` 字段返回。需要在 Gateway 实测或查 Claude CLI 文档确认。根据 Claude SDK 文档，通常在 `message_stop` 事件的响应体中有 `session_id` 字段。

### Pattern 3: react-markdown 流式渲染

**What:** 实时将累积的文本字符串输入 react-markdown，未闭合 code fence 以原始 pre 兜底。

**When to use:** `agent.delta` 阶段实时渲染，`agent.result` 后完整重渲染（D-38）。

```tsx
// Source: [CITED: react-markdown v10 官方文档]
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// 流式渲染示例（在 ChatBubbleAgent 组件中）
function ChatBubbleAgent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // 代码块：加复制按钮
        pre: CustomPre,
        // 链接：target="_blank" rel="noopener noreferrer"（D-36）
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        // 图片：渲染为 alt 文本（D-36）
        img: ({ alt }) => (
          <span className="text-muted-foreground italic">[image: {alt}]</span>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
```

**highlight.js 主题切换：**
```tsx
// 根据 html.dark 类切换高亮主题
import 'highlight.js/styles/github.css';        // light
import 'highlight.js/styles/github-dark.css';   // dark
// 通过 CSS @import 条件或在 styles.css 中按 .dark 前缀覆盖
```

### Pattern 4: Gateway in-memory buffer（D-45）

**What:** Map 维护活跃 subprocess 和累积文本，用于断线重连的 catchup。

```typescript
// Source: [CITED: CONTEXT.md D-45]
// 在 ChatSessionRunner 或 daemon 层维护

// 活跃 subprocess map
const activeSubprocesses = new Map<sessionId, {
  process: ChildProcess;
  accumulatedText: string;
  startedAt: number;
}>();

// 客户端重连时
function handleClientReconnect(clientId: string, sessionId: string) {
  const active = activeSubprocesses.get(sessionId);
  if (active) {
    // 发 catchup 帧（包含已累积的全部文本）
    sendToClient(clientId, {
      type: 'gateway.chat-catchup',
      sessionId,
      text: active.accumulatedText
    });
    // 后续继续推送新的 agent.delta
  }
  // 若 activeSubprocesses 中无记录 → 不发 catchup → 前端超时后显示"回复丢失"
}
```

### Pattern 5: Server 新增 Chat API（Egg.js 分层规范）

**What:** 按 `apps/server/CLAUDE.md` 规范：新建 `controller/chat.ts` + `service/chatRepository.ts`，路由前缀 `/api/server/`。

```typescript
// Source: [CITED: apps/server/CLAUDE.md 分层规则]
// apps/server/app/controller/chat.ts
export default class ChatController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId } = authScope(ctx);
    const transport = 'chat'; // 过滤 chat transport
    const sessions = await ctx.service.chatRepository.listChatSessions(accountId, workspaceId, transport);
    ctx.success({ sessions });
  }
  public async messages(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId } = authScope(ctx);
    const messages = await ctx.service.chatRepository.listMessages(
      ctx.params.sessionId, accountId, workspaceId
    );
    ctx.success({ messages });
  }
}

// apps/server/app/router.ts 新增：
router.get('/api/server/chat-sessions', requireNormalAccess, controller.chat.sessions);
router.get('/api/server/chat-sessions/:sessionId/messages', requireNormalAccess, controller.chat.messages);
```

### Pattern 6: Web WS 连接建立时序（D-43）

**What:** 先 HTTP 加载历史，DOM 渲染完成后再建 WS。

```typescript
// Source: [CITED: CONTEXT.md D-43]
// 进入 /chats/:sessionId 时：
useEffect(() => {
  // 1. HTTP 拉历史
  const messages = await fetchChatMessages(sessionId);
  setMessages(messages);
  
  // 2. 检查是否有未完成的 AI 回复
  const lastMsg = messages.at(-1);
  const isInflight = lastMsg?.role === 'user'; // 无对应 assistant 行
  
  if (isInflight) {
    setPlaceholderBubble(true);  // 显示 ThinkingDots
  }
  
  // 3. 建立 WS（无论是否 in-flight）
  const ws = connectRelay();
  ws.onmessage = (frame) => {
    if (frame.type === 'gateway.chat-catchup') {
      setPlaceholderBubble(false);
      setStreamingText(frame.text);  // 替换占位
    }
    if (frame.type === 'agent.delta') {
      appendStreamingText(frame.text);
    }
    if (frame.type === 'agent.result') {
      finalizeMessage(frame);
      setIsInflight(false);
    }
  };
}, [sessionId]);
```

### Anti-Patterns to Avoid

- **复用 session-runner-spawn.ts 代码：** chat 链路必须独立，PTY runner 通过 Unix socket 通信而 chat runner 是 piped subprocess，两者完全不同。[CITED: CONTEXT.md D-00]
- **在 WS 中推历史消息：** D-43 明确禁止；历史消息只走 HTTP，WS 只推实时数据。
- **写 agent.delta 到 SQLite：** D-33 明确禁止；只写 agent.result（message_stop 后的完整回复）。
- **在 agent.result 到达时替换气泡文本：** D-02c 要求追加花费卡片，文本不替换——流式拼出的文本就是最终文本。
- **依赖 client.subscribe 控制 chat 帧路由：** chat 会话通过 `client.chat { sessionId }` 直接路由，不需要先 subscribe。当前 Relay 代码对 `client.chat` 要求 subscription，这个行为对 chat 链路来说是**阻塞**，需要重新评估（见 Open Questions Q-1）。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown 渲染 | 自己解析 Markdown 字符串 | react-markdown + remark-gfm + rehype-highlight（已安装） | 处理嵌套、转义、GFM 扩展的边界情况极多 |
| 代码高亮 | 手写 token 着色 | highlight.js 主题（已安装） | 语言检测和边界情况复杂 |
| 移动端抽屉 | 自制 slide 动效 | `Sheet` from `@tether/design` | D-08 明确指定；Radix UI 的无障碍支持 |
| 折叠工具卡片 | 手写展开/折叠逻辑 | `Collapsible` from `@tether/design` | D-09 明确指定 |
| 滚动容器 | 原生 div + overflow | `ScrollArea` from `@tether/design` | 统一跨平台滚动行为 |
| HTTP 客户端 | 手写 fetch 封装 | `@tether/http` `createHttpClient()` | 统一 token header、error normalization |

**Key insight:** Markdown 渲染库已全部安装；UI 组件库已初始化。本阶段几乎不需要安装新包。

---

## Runtime State Inventory

本阶段不是 rename/refactor 类型，但涉及数据库表的 **DROP + 重建**，需要特别注意。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (Server MySQL) | `gateway_chat_messages` 表已在 migration 003 中 DROP（`003_drop_chat_messages.sql`）；现在需要重建（migration 004） | 新建 `004_chat_messages.sql` 执行 CREATE TABLE |
| Stored data (Gateway SQLite) | `sessions` 表现有，需新增 `transport = 'chat'` 值；`session_chats_events` 表不存在（需新建） | store.ts constructor 添加 `CREATE TABLE IF NOT EXISTS session_chats_events` |
| Stored data (Server MySQL) | `gateway_sessions` 表已有 `transport` 列，可直接存 `transport='chat'`，`agent_session_id` 列已有 | 无需 migration，现有表可复用 |
| Live service config | Relay RUNTIME_EVENT_WHITELIST 当前不含 `agent.result` / `agent.tool` | 需在 relay.ts 中扩展白名单 |
| OS-registered state | None — 纯代码和 DB 变更 | — |
| Secrets/env vars | `TETHER_RUNTIME_SYNC_SECRET` 已有，syncToServer 已配置 | 新 chat 同步端点复用同一 secret |
| Build artifacts | apps/web/dist — 现有构建不含 /chats 路由 | 修改后重新 build |

**gateway_chat_messages 表状态：** migration 003 已执行 DROP TABLE；migration 004 需要重建新结构（去掉 `turn_index`、`tools_json`、`uq_chat_messages_session_turn` 唯一索引，新增 `usage_json`、`role`、`content`）。[VERIFIED: apps/server/sql/003_drop_chat_messages.sql]

---

## Common Pitfalls

### Pitfall 1: client.chat 帧的 sessionId 类型冲突

**What goes wrong:** 当前 `RelayClientToServerFrame` 中 `client.chat` 的 `sessionId` 是 `string`（非空）。Relay 的 `handleClientFrame` 中 `client.chat` case 要求 session 已存在（调用 `clientCanAccessSession`）并且已 subscribed，否则报错。新的首条消息 `sessionId: null` 在这套机制下会直接失败。

**Why it happens:** 旧 `client.chat` 帧（Phase 11）是为已有 PTY session 设计的，假设 session 已存在且已 subscribe。新 chat 链路是隐式创建，session 在消息发出时才存在。

**How to avoid:** 
- 在 Protocol 中将 `client.chat` 拆分为两种形式，或用 `sessionId: string | null` 联合类型。
- 在 Relay 的 `handleClientFrame` 中，对 `client.chat` 单独处理——当 `sessionId` 为 null 时，直接转发给 Gateway（不做 session 存在/subscribe 校验）；当 `sessionId` 非 null 时，也不要求必须 subscribed（chat 会话不走 subscribe 机制）。

**Warning signs:** 前端发送 `client.chat { sessionId: null }` 时收到 `error: session is outside client scope` 或 `not_subscribed`。

### Pitfall 2: Relay 白名单缺少新 event 类型

**What goes wrong:** `RUNTIME_EVENT_WHITELIST` 当前只有 `terminal.output`、`terminal.input`、`session.error`、`session.exited`、`agent.status`。Gateway 发送 `gateway.event { type: 'agent.result' }` 时，Relay 不会触发 syncToServer，导致 Server DB 的 `gateway_chat_messages` 永远不会被写入。

**Why it happens:** 白名单在 Phase 12 定为 PTY 链路事件类型，没有预留 chat 链路扩展位。

**How to avoid:** 在 relay.ts 中将 `agent.result`、`agent.tool` 加入 `RUNTIME_EVENT_WHITELIST`。

**Warning signs:** `GET /api/server/chat-sessions/:id/messages` 返回空数组，但 Gateway SQLite 中有记录。

### Pitfall 3: 流式渲染导致 Markdown 解析异常

**What goes wrong:** `agent.delta` 逐字到来，当累积的文本包含未闭合的 code fence（如 ` ```python` 还没有结束的 ` ``` `）时，react-markdown 会将后续所有内容视为代码，导致格式混乱。

**Why it happens:** react-markdown 是一次性解析完整文档的，增量输入无法保证语法完整性。

**How to avoid:** D-38 的解决方案：流式期间，若检测到未闭合 code fence，自动追加一个临时的 ` ``` ` 使解析器认为代码块已关闭，或降级为 `<pre>` 渲染原始文本。`agent.result` 到达后进行一次完整的重渲染。

**Warning signs:** 流式期间代码块之后的普通文本变成等宽字体且无法正常渲染。

### Pitfall 4: chat session 与 PTY session 的 listSessions 混用

**What goes wrong:** `GET /api/server/chat-sessions` 如果直接复用现有 `sessionRepository.listSessions`，会把 PTY session 和 chat session 混在一起返回，导致 Web 端在 `/chats` 列表中显示 PTY 会话。

**Why it happens:** `gateway_sessions` 表用 `transport` 列区分，但现有 list 接口没有按 transport 过滤。

**How to avoid:** 新的 `chatRepository.listChatSessions` 在 SQL 中加 `WHERE transport = 'chat'`，或复用现有接口时传入 transport 过滤参数。

**Warning signs:** `/chats` 列表中出现 PTY terminal 会话。

### Pitfall 5: agent_session_id 跨设备丢失

**What goes wrong:** Claude CLI 的 `--resume` 需要的 `ai_session_id` 只在 Gateway 本地 SQLite 中更新，如果用户切换设备（或 Gateway 重启后 SQLite 被清），无法续接上下文。

**Why it happens:** D-21 要求 `ai_session_id` 同步到 Server DB `gateway_sessions.agent_session_id`，但 syncToServer 的 gateway session upsert 可能不包含 `agent_session_id` 字段。

**How to avoid:** `message_stop` 处理后，除了更新本地 `sessions.agent_session_id`，还需通过 syncToServer 更新 Server DB 的 `gateway_sessions.agent_session_id`。D-22 的"本地无则从 Server DB 拉取"依赖这一点。

**Warning signs:** 第二设备发消息时每次都是新对话，没有历史上下文续接。

### Pitfall 6: i18n 文案忘记同步

**What goes wrong:** apps/web/CLAUDE.md 明确要求"所有可见文案必须来自 `src/i18n/messages.ts`"，但 chat 界面文案量很大，开发过程中可能遗漏。

**Why it happens:** 新组件开发时习惯性硬编码字符串。

**How to avoid:** UI-SPEC.md 的 Copywriting Contract 已经整理好所有文案的中英文版本，开发前先在 `messages.ts` 中定义所有 key，再在组件中通过 `useI18n()` 引用。

---

## Code Examples

### Gateway session_chats_events DDL（在 store.ts constructor 添加）

```sql
-- Source: CONTEXT.md D-40
CREATE TABLE IF NOT EXISTS session_chats_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  type         TEXT NOT NULL,   -- 'user.message' | 'agent.result' | 'agent.tool' | 'session.error'
  ts           INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_chats_events_cursor
  ON session_chats_events(session_id, id);
```

### Server DB gateway_chat_messages 新结构（migration 004）

```sql
-- Source: CONTEXT.md D-41
-- 注意：migration 003 已 DROP 旧表，004 重建新结构
CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id          BIGINT NOT NULL AUTO_INCREMENT,
  session_id  VARCHAR(128) NOT NULL,
  role        VARCHAR(16)  NOT NULL,        -- 'user' | 'assistant'
  content     MEDIUMTEXT   NOT NULL,        -- 完整消息文本
  usage_json  TEXT         DEFAULT NULL,    -- { input_tokens, output_tokens, cost_usd }，仅 assistant 行
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_messages_session_id (session_id)
);
```

### Web 侧 Markdown 渲染（ChatBubbleAgent）

```tsx
// Source: [CITED: react-markdown v10 文档 + CONTEXT.md D-36/37/38]
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

function ChatBubbleAgent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  // 流式期间检测未闭合 code fence，临时补齐
  const renderText = isStreaming ? closeUnclosedFence(text) : text;

  return (
    <div className="chat-bubble-agent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => (
            <div className="relative">
              <pre>{children}</pre>
              <CopyButton />
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
               className="text-info underline">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="text-muted-foreground italic">[image: {alt ?? ''}]</span>
          ),
        }}
      >
        {renderText}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

function closeUnclosedFence(text: string): string {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  return fenceCount % 2 === 1 ? text + '\n```' : text;
}
```

### Web 侧路由新增方式

```tsx
// Source: [CITED: apps/web/CLAUDE.md 路由规范] + apps/web/src/routes.tsx 现有模式
// 在 WebRoutes 中新增：
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

// 同时将 catch-all 重定向从 /sessions 改为 /chats：
<Route path="*" element={<Navigate replace to="/chats" />} />
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JournalWatcher 读 JSONL | stream-json subprocess piped stdout | Phase 13 准备期（commit 6f422f4） | 旧链路已删除，chat 链路必须独立实现 |
| gateway_chat_messages (turn_index, tools_json) | gateway_chat_messages (role, content, usage_json) | Phase 13（migration 004） | 重建表，去掉 JournalWatcher 遗留字段 |
| client.chat 只支持已有 sessionId | client.chat 支持 sessionId: null（隐式创建） | Phase 13 | Protocol 和 Relay 均需更新 |
| 旧 chat-bubble.tsx | 全新 chat-bubble-user.tsx + chat-bubble-agent.tsx | Phase 13 | 旧组件基于 agent.turn，新组件基于 agent.delta/result |

**Deprecated/outdated:**
- `apps/web/src/components/session/chat-bubble.tsx`：基于旧 Phase 11 agent.turn 帧，在本 phase 中应**重建**（CONTEXT.md 中已注明"已随旧 chat 链路删除，本 phase 从 HTML mockup 重建"）——实际上该文件仍存在，但其 `ChatBubbleProps` 和 role 模型与新链路不兼容，需要新建独立的 `src/components/chats/chat-bubble-*.tsx`。

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `claude --output-format stream-json` 的 `ai_session_id` 在 `message_stop` 事件的响应体中以 `session_id` 字段返回 | Pattern 2（ChatSessionRunner） | 如果在其他 event 字段中返回，需调整解析逻辑；但不影响功能——`--resume` 可以在 subprocess 结束后从 stdout 日志中找到 |
| A2 | Codex CLI 和 Copilot CLI 不支持 `--output-format stream-json`，需要独立解析格式 | D-25（待研究） | 如果两者支持类似格式，实现可以复用；否则每个 Runner 要独立解析 |
| A3 | `claude status` 或 `claude config` 命令会以某种可解析的格式输出订阅信息 | D-30（待研究） | 如果 CLI 没有订阅信息输出，设置页面显示"暂无订阅信息" |
| A4 | Relay 的 `client.chat` 分支在不要求 subscription 的前提下可以正确路由 | Pitfall 1 | 需要修改 Relay 的 handleClientFrame 逻辑 |

---

## Open Questions (RESOLVED)

1. **Q-1: Relay 的 client.chat 路由逻辑**
   - What we know: 当前 `handleClientFrame` 中 `client.chat` 要求 `clientCanAccessSession` + subscribed。`clientCanAccessSession` 要求 session 在 `latestSessions` Map 中存在。首条消息时 `sessionId: null`，session 根本不存在。
   - What's unclear: 新 chat 链路中，Relay 是否需要维护 chat session 的路由状态（类似 latestSessions），还是直接转发给 Gateway（让 Gateway 决定一切）？
   - Recommendation: 最简方案——Relay 对 `client.chat` 帧（无论 sessionId 是否为 null）直接转发给 client 绑定的 gateway，不做 session 存在性校验。chat session 不需要加入 `latestSessions`（因为 chat session 不支持 PTY replay、resize 等操作）。
   - **RESOLVED (Plan 03):** 采用 CHAT_EVENT_TYPES Set + payload.clientId 直接路由，完全绕开 subscription 流程。client.chat 在 relay.ts 中直接转发给 Gateway，不经过 clientCanAccessSession 校验。

2. **Q-2: Gateway 如何将 agent.delta/agent.result 推回 Relay**
   - What we know: 现有 `relay-client.ts` 通过 `send({ type: 'gateway.event', ... })` 发送事件，Relay 再通过 `sendEventToSubscribers` 发给订阅了该 sessionId 的 client。Chat session 是否需要 subscribe 机制？
   - What's unclear: 如果 chat session 不走 subscribe，Relay 怎么知道把 `gateway.event { type: 'agent.delta' }` 推给哪个 client？
   - Recommendation: chat session 仍然可以走现有的 subscribe 机制，但 subscribe 由 client 在收到 `gateway.session-created { sessionId }` 后自动发出，而不是在 session 列表中选择。或者，Gateway 在 `gateway.event` 中携带 `clientId`，Relay 按 clientId 路由（更简洁，不依赖 subscribe）。**后者更简单，推荐 planner 评估。**
   - **RESOLVED (Plan 03):** 采用 payload.clientId 直接路由方案。Gateway onDelta/onResult/onTool 回调在 gateway.event payload 中注入 clientId，Relay 的 CHAT_EVENT_TYPES 分支按 clientId 找 socket 直接发送，不走 sendEventToSubscribers。

3. **Q-3: claude --output-format stream-json 中 session_id 的字段位置**
   - What we know: Claude CLI 在某处返回续接用的 session ID，CONTEXT.md 标注此为"待研究"。
   - What's unclear: 具体在哪个 event 类型的哪个字段中。
   - Recommendation: 在 Gateway 实现中打印 stream-json 的完整输出做一次实测。文档上看，session_id 可能在 `message_start` 的 message 对象中。
   - **RESOLVED (Plan 02):** ChatSessionRunner 接受不确定性：优先从 message_start event 的 message.session_id 字段读取；若未获取，在 message_stop 时再查 event.session_id；两者均无则 fallback 到生成 UUID（D-35 允许）。Codex/Copilot 格式问题推迟为 D-25 TBD，本 Phase 只实现 ClaudeChatRunner。

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| claude CLI | ChatSessionRunner spawn | [ASSUMED] | — | 若未安装，provider 检测返回空列表，UI 提示"Gateway 无可用工具" |
| node:child_process | ChatSessionRunner | ✓ | Node.js 内置 | — |
| node:sqlite (DatabaseSync) | store.ts | ✓ | 已在 Gateway 使用 | — |
| MySQL | Server DB migration 004 | ✓（由 Phase 5 配置） | — | — |
| react-markdown | Web Markdown 渲染 | ✓ | 10.1.0（已安装） | — |
| remark-gfm | Web GFM 支持 | ✓ | 4.0.1（已安装） | — |
| rehype-highlight | Web 代码高亮 | ✓ | 7.0.2（已安装） | — |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest（apps/web）/ node:test（apps/gateway / apps/relay）|
| Quick run | `pnpm --filter @tether/web typecheck` |
| Gateway test | `pnpm --filter @tether/gateway test` |
| Server test | `pnpm --filter @tether/server test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| SC-1 | /chats 路由在登录后可访问 | e2e / manual | 手动浏览器验证 |
| SC-2 | 首条 client.chat 触发隐式会话创建，回 gateway.session-created | integration | `pnpm --filter @tether/gateway test` |
| SC-3 | agent.delta 实时追加，agent.result 追加花费卡片 | unit (component) | `pnpm --filter @tether/web typecheck` |
| SC-4 | HTTP 加载会话列表和历史消息 | unit (service) | `pnpm --filter @tether/server test` |
| SC-5 | 断线重连 catchup 流程 | integration | gateway test |
| SC-6 | session_chats_events 表创建，gateway_chat_messages migration 004 | unit (store) | gateway + server test |

### Wave 0 Gaps

- [ ] `apps/gateway/src/chat-session-runner.test.ts` — ChatSessionRunner spawn 和事件解析
- [ ] `apps/server/test/chat.test.ts` — chat-sessions list + messages API
- [ ] `apps/gateway/src/store.test.ts` — 需要覆盖 session_chats_events 新表方法（现有 store.test.ts 可扩展）

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | 复用现有 `client.auth` WS ticket 机制（D-17） |
| V3 Session Management | yes | chat session 绑定到已认证 WS 通道 |
| V4 Access Control | yes | `normal_client_access` 在 /api/server/chat-sessions 接口（D-42） |
| V5 Input Validation | yes | Gateway provider 白名单（SAFE-01），cwd 路径不执行命令 |
| V6 Cryptography | no | 无新的密码学需求 |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| FORBIDDEN_KEYS（command, args 等）通过 client.chat 帧注入 | Tampering | Relay 已有 `hasForbiddenKey` 检查（relay.ts line 729）—— chat 帧同样受此保护 |
| cwd 路径逃逸（如 `../../secret`） | Elevation | Gateway 只将 cwd 作为 spawn 的工作目录，不执行路径本身；需校验是绝对路径 |
| provider 名称注入（非白名单 provider） | Tampering | SAFE-01 白名单在 Gateway agent-select-detect 中已有模式，chat 链路首条消息也需校验 provider 在白名单内 |
| 大量 client.chat 消息导致 subprocess 泄漏 | DoS | D-44 in-flight 锁——同一会话不允许并发发消息；Gateway 需确保每个 sessionId 最多一个活跃 subprocess |
| agent.delta 注入 XSS | Tampering | react-markdown 默认不使用 dangerouslySetInnerHTML（D-37 明确禁止），rehype-sanitize 可选但 react-markdown 本身已安全 |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: apps/web/package.json] — 确认 react-markdown@10.1.0、remark-gfm@4.0.1、rehype-highlight@7.0.2 已安装
- [VERIFIED: packages/protocol/src/index.ts] — 现有帧类型定义，`client.chat` 当前结构
- [VERIFIED: apps/relay/src/relay.ts] — Relay 路由逻辑、RUNTIME_EVENT_WHITELIST、handleClientFrame
- [VERIFIED: apps/gateway/src/relay-client.ts] — Gateway Relay 客户端，handleFrame switch
- [VERIFIED: apps/gateway/src/store.ts] — Gateway SQLite 表结构，migrate() 模式
- [VERIFIED: apps/server/app/router.ts] — Server 路由前缀规范
- [VERIFIED: apps/server/app/controller/session.ts] — 现有 session list/events controller 模式
- [VERIFIED: apps/server/sql/002_gateway_runtime_sync.sql] — gateway_sessions 表现有 schema
- [VERIFIED: apps/server/sql/003_drop_chat_messages.sql] — 旧 gateway_chat_messages 已 DROP
- [VERIFIED: apps/web/src/routes.tsx] — 现有路由结构和 RequireUserAuth 守卫
- [VERIFIED: apps/web/src/contexts/auth-context.tsx] — AuthProvider 接口
- [VERIFIED: apps/web/src/lib/api.ts] — HTTP client 模式、getStoredNormalAccessToken
- [VERIFIED: .planning/phases/13-mobile-web-chat/13-UI-SPEC.md] — UI 设计合同（已审批）
- [VERIFIED: .planning/phases/13-mobile-web-chat/13-CONTEXT.md] — 所有 D-xx 决策
- [CITED: apps/web/CLAUDE.md] — i18n 规范、路由规范、组件使用规范
- [CITED: apps/server/CLAUDE.md] — Egg.js 分层规则、router/controller/service 规范

### Secondary (MEDIUM confidence)

- [CITED: npm registry] — react-markdown v10.1.0 API 与 v9 不兼容（hooks 移除），但项目已安装 v10 版本，无需迁移
- [CITED: docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html] — CSS 变量和组件参考样式

### Tertiary (LOW confidence)

- [ASSUMED] Claude CLI `--output-format stream-json` 的 session_id 字段位置（需实测确认）
- [ASSUMED] Codex/Copilot CLI 流式输出格式（D-25 待研究）
- [ASSUMED] `claude status` 能否读取订阅信息（D-30 待研究）

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 所有核心依赖已安装确认
- Architecture: HIGH — 基于已有代码模式和锁定决策
- Pitfalls: HIGH — 直接来自代码阅读发现的实际问题（Relay client.chat 路由、白名单缺失等）
- Gateway stream-json 解析: MEDIUM — claude CLI 行为基于文档推断，session_id 字段位置 ASSUMED

**Research date:** 2026-05-10
**Valid until:** 2026-06-10（claude CLI API 变化快，超过 30 天需重验）
