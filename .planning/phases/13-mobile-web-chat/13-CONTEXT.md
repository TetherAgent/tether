# Phase 13: Mobile Web Chat Interface - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<completed_prereqs>
## 已完成的前置工作（Phase 13 范围内，已提交）

### JournalWatcher 链路删除（commit 6f422f4）
本 phase 讨论期间完成的清理工作，为新 stream-json 链路腾出干净的基础：

**删除的文件：**
- `apps/gateway/src/journal-watcher.ts`
- `apps/gateway/src/journal-watcher.test.ts`
- `apps/gateway/src/chat-handler.ts`
- `apps/gateway/src/chat-handler.test.ts`

**新建：**
- `apps/server/sql/003_drop_chat_messages.sql` — DROP TABLE gateway_chat_messages

**修改的文件（17 处）：**
- `apps/gateway/src/session-runner.ts` — 移除 JournalWatcher 实例化
- `apps/gateway/src/store.ts` — 移除 agent.turn/agent.typing 事件类型、AgentTurn 类型、listAgentTurns()
- `apps/gateway/src/session-status-deriver.ts` — 移除 onAgentTurn/onTaskStarted/onTaskCompleted
- `apps/gateway/src/relay-client.ts` — 移除 client.conversation 处理、client.chat 分支
- `apps/gateway/src/daemon.ts` — 移除 /api/sessions/:id/conversation 端点、chat 帧处理
- `apps/relay/src/relay.ts` — 移除 gateway.conversation/client.conversation 分支
- `packages/protocol/src/index.ts` — 移除 RelayConversationTurn、conversation 相关帧类型
- `apps/web/src/components/session/chat-session-surface.tsx` — 移除 agent.turn/agent.typing 渲染
- `apps/server/app/controller/runtime-sync.ts` — 移除 conversation() 方法
- `apps/server/app/service/runtimeSyncRepository.ts` — 移除 gateway_chat_messages 操作
- `apps/server/app/service/sessionRepository.ts` — 移除 getConversation()
- `apps/server/app/controller/session.ts` — 移除 conversation() 方法
- `apps/server/app/router.ts` — 移除两条 conversation 路由
- 相关测试文件同步清理

**验证：** TypeScript 编译全部通过（protocol / gateway / relay / web / server）

</completed_prereqs>

<domain>
## Phase Boundary

在现有 `apps/web` 中新增类微信风格的聊天界面：用户可以从手机/浏览器创建 AI 会话
（选择 model）、发送消息、实时渲染 agent 的 JSON 事件流（tool 调用、回复、权限提示等）。

**本 phase 交付：**
- 在现有 `apps/web` 中新增类微信聊天界面（新路由 `/chats`，不删旧页面）
- 左侧导航（会话列表、新建会话入口、设置/账号）+ 右侧聊天区，类微信布局
- 通过 Relay WS 新帧创建 session（不依赖 CLI）
- Gateway 动态提供可用 model 列表
- Session ID 关联到 Server DB 用户账号（跨设备同步）
- Relay 同步**全量事件**到 Server DB

**不在本 phase：**
- 新建独立 app（沿用 apps/web）
- 删除现有 apps/web 旧页面（两套路由并存）
- Flutter 客户端（Phase 9）
- 多 workspace 支持（Phase 10）
- 离线模式/PWA push 通知

</domain>

<decisions>
## Implementation Decisions

### 完整 Chat 链路（确认版）

**发送一条消息的完整数据流：**
```
网页 --[WS client.chat]--> Relay --[WS]--> Gateway
  Gateway: spawn(claude -p <msg> [--resume <session_id>] --output-format stream-json)
    ↓ stdout: content_block_delta (text)
  Gateway emit agent.delta --[WS]--> Relay --[WS]--> 网页（打字机实时渲染）
    ↓ stdout: message_stop (usage/stop_reason)
  Gateway emit agent.result --[WS]--> Relay --[WS]--> 网页（追加花费卡片，文本不替换）
```

**存储：**
```
Gateway 本地 SQLite:
  sessions 表:     chat 会话元数据（transport='chat', agent_session_id）
  session_chats_events 表:
    - user.message（client.chat 收到时立即写）
    - agent.result（message_stop 后写，含完整回复 + usage）
    - agent.tool  （tool 调用时写）
    ※ agent.delta 不写库，仅内存流式推送

Relay 同步 → Server DB（MySQL）:
  gateway_sessions 表:     会话元数据（含 agent_session_id）
  gateway_chat_messages 表: 仅 user + assistant 完整消息行
  gateway_runtime_events 表: agent.result / agent.tool 原始事件
```

**会话续接：**
```
同一对话再发消息 → Gateway 查本地 SQLite 取 claude session_id
→ spawn(claude -p <msg> --resume <session_id> --output-format stream-json)
```

**页面初始加载（纯 HTTP，渲染完再建 WS）：**
```
进入 /chats
  → HTTP GET /api/server/chat-sessions              会话列表 → 渲染左侧列表
  → 点击某会话（或 URL 直接带 sessionId）
  → HTTP GET /api/server/chat-sessions/:id/messages 历史消息 → 直接渲染气泡
  → 检查最后一条记录：
      user.message 且无 agent.result？
        → 显示"AI 正在回复…"占位气泡
        → 建立 WS，订阅该 sessionId
        → Gateway 有活跃 subprocess → 发 gateway.chat-catchup { text }
            → 客户端替换占位，继续接 agent.delta → agent.result
        → Gateway 无活跃 subprocess（已崩溃）→ 显示"回复丢失，请重试"
      有 agent.result（历史完整）？
        → 渲染完毕，再建立 WS（准备接收新消息）
```

### 执行链路架构（关键）
- **D-00:** 全新独立 chat 链路，不依赖 PTY / JournalWatcher（均已删除）。
  - Gateway 侧新增 `ChatSessionRunner`：piped subprocess（非 PTY），每条消息一次 spawn，通过 `--resume` 续接上下文。
  - **设计要求：独立可运行，不复用任何 PTY 或 JournalWatcher 代码。**

### 消息发送路径
- **D-01:** Web 发消息走 `client.chat` WS 帧，Relay 透传给 Gateway。帧结构分两种：
  - **首条消息（新会话）：** `{ type: 'client.chat', sessionId: null, provider, model, cwd, message }`
  - **后续消息（续接）：** `{ type: 'client.chat', sessionId: string, message }`
  - Gateway 收到 `sessionId: null` → 隐式创建 ChatSession，立即回 `gateway.session-created { sessionId }`，再开始流式输出。
- **D-01b:** Gateway 执行：`spawn('claude', ['-p', message, '--output-format', 'stream-json', ...(aiSessionId ? ['--resume', aiSessionId] : [])], { cwd })`
- **D-02:** 认证复用现有 WS 通道（`client.auth` → `client.auth.ok`）。

### 新链路事件类型
- **D-02b:** Gateway 解析 `--output-format stream-json` stdout，映射到新 Relay 事件（加入 `packages/protocol/src/index.ts`）：
  - `content_block_delta` text → `agent.delta`（流式文本片段）
  - `message_stop` → `agent.result`（usage: input_tokens / output_tokens / cost / stop_reason）
  - tool_use block → `agent.tool`（tool 调用卡片）
  - `error` → `session.error`（已有，复用）
- **D-02c:** `agent.result` 到网页后**追加花费卡片**，不替换流式拼出的文本。

### 存储策略
- **D-20:** Gateway 在本地 SQLite 写入（表：`session_chats_events`）：
  - 用户消息（`client.chat` 收到时立即写，type = `'user.message'`）
  - AI 完整回复 + usage（`message_stop` 后写，type = `'agent.result'`）
  - tool 调用（type = `'agent.tool'`）
  - `ai_session_id` 更新写回 `sessions.agent_session_id`（`message_stop` 后）
- **D-21:** Relay 将 `agent.result` / `agent.tool` / `session.error` 同步到 Server DB（`gateway_chat_messages` + `gateway_runtime_events`），**`ai_session_id` 必须同时更新 `gateway_sessions.agent_session_id`**（手机端跨设备续接需要从 Server 读取）。
- **D-22:** 同一对话再发消息时，Gateway 优先查本地 `sessions.agent_session_id`，本地无则从 Server DB `gateway_sessions` 拉取，通过对应工具的续接参数传入。

> **待研究（planner 确认）：** `--output-format stream-json` 输出里 `ai_session_id` 具体在哪个 event 字段返回（需查 claude CLI 文档或实测）。

### DB Schema（已定）
- **D-40:** Gateway SQLite（`~/.tether/tether.db`）**复用** `sessions` 表存 chat 会话（新增 `transport = 'chat'`），**不复用** `session_events` 表。新增独立表 `session_chats_events`：

  ```sql
  -- 在 store.ts 的 constructor 内随 sessions 表一起 CREATE IF NOT EXISTS
  CREATE TABLE IF NOT EXISTS session_chats_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL,
    type         TEXT NOT NULL,   -- 'user.message' | 'agent.result' | 'agent.tool' | 'session.error'
    ts           INTEGER NOT NULL,
    payload_json TEXT NOT NULL    -- 不写 agent.delta，只写完整事件
  );
  CREATE INDEX IF NOT EXISTS idx_session_chats_events_cursor
    ON session_chats_events(session_id, id);
  ```

  `session_events` 表保持 PTY 链路专用，chat 链路的所有事件写 `session_chats_events`，两条链路隔离。

- **D-41:** Server DB（MySQL）新建迁移文件 `apps/server/sql/004_chat_messages.sql`：

  ```sql
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

  与已删除旧表的区别：去掉 `turn_index`（JournalWatcher 遗留），去掉 `tools_json`（tool 调用走 `gateway_runtime_events`），单独抽 `usage_json` 字段。`gateway_sessions` 表可直接复用（已有 `provider`、`project_path`、`agent_session_id`、`transport` 字段，新增 `transport = 'chat'` 值即可）。

- **D-42:** 历史记录加载 API：新增 `GET /api/server/chat-sessions/:sessionId/messages`（`normal_client_access`），从 `gateway_chat_messages` 按 `created_at ASC` 返回该会话全部 `{role, content, usage_json}` 记录。Web 在挂载聊天页时调用一次完成历史回放，无需流式。

### 会话创建方式（隐式）
- **D-32:** 用户**无需显式新建会话**。第一条 `client.chat` 消息携带 `provider + model + cwd`，Gateway 收到后隐式创建 ChatSession，返回 `sessionId`，后续消息复用同一 `sessionId`。
  - UI 上"新建"按钮只是清空当前对话区域，实际 session 在第一条消息发出时才在 Gateway 创建。
  - 无消息则无 session，不产生垃圾记录。

### 存储粒度（仅完整回复）
- **D-33:** `session_chats_events` 表**不写** `agent.delta` 逐片段。`agent.delta` 只在内存中累积后实时推 WS，不落库。`message_stop` 到来后一次性写入 `agent.result`（完整回复 + usage）。
  - Relay → Server DB 的 `gateway_chat_messages` 也只存 `agent.result` 完整行，不存 delta 碎片。
  - 理由：delta 高频（每字符一次），存储无意义；`agent.result` 已包含完整文本，历史回放够用。

### 工作目录（cwd）选择
- **D-34:** 创建会话时用户在 UI 上**一次性选择 project path（cwd）**，之后该会话的所有 spawn 均在此目录下执行。
  - `client.chat`（首条消息）帧携带 `cwd: string`（绝对路径）。
  - Gateway 执行：`spawn('claude', [...], { cwd })`，不依赖 Gateway 进程的工作目录。
  - 会话创建后 cwd 不可修改；换 cwd 需新建会话。
  - UI 提供路径输入框（或历史路径下拉），不做远端目录浏览（超出本 phase 范围）。

### 跨设备续接限制
- **D-35:** `ai_session_id`（Claude CLI `--resume` 用）仅在**同一台 Gateway 机器**上有效。
  - Claude CLI 的会话文件存储在 `~/.claude/projects/<hash>/` 目录，与 Gateway 机器绑定。
  - 跨 Gateway 机器（即切换到另一台 Mac）无法续接，需新建会话。
  - 同一 Gateway + 多设备 Web 访问（手机 + 电脑）= 可续接，`ai_session_id` 从 Server DB 取即可。
  - 此限制记录在 UI 设置说明中（"跨设备须使用同一台 Mac"）。

### 多工具支持（Claude / Codex / Copilot）
- **D-23:** Gateway 新增**工具归一化层**：无论底层是哪个 AI CLI，输出统一映射成 `agent.delta` / `agent.result` / `agent.tool` 事件，上层协议不感知差异。
- **D-24:** 每个工具对应独立的 Runner 实现（`ClaudeChatRunner` / `CodexChatRunner` / `CopilotChatRunner`），共享同一接口（spawn / parseEvent / resumeFlag）。
- **D-25:** **待研究（planner）：** Codex CLI 和 Copilot CLI 的流式输出格式、session 续接机制、工具可用性检测（是否已安装在 Gateway 机器上）。

### Model 选择（两层）
- **D-26:** 创建会话时两层选择：① 选 AI 工具（claude / codex / copilot）② 选具体模型（如 claude → sonnet / opus / haiku）。
- **D-27:** 工具列表由 Gateway 动态检测（检查 CLI 是否已安装并可用），模型列表由各 Runner 提供已知型号。`client.list-providers` → Relay 找该用户唯一绑定的 Gateway 转发（`gateways` 表 `uq_gateways_account_user` 约束保证一对一）。
- **D-28:** ~~`client.create-session` 帧~~ — **已被 D-32 取代，不存在此帧**。provider/model/cwd 随首条 `client.chat` 消息一起发送，Gateway 隐式创建会话。

### 中途换模型
- **D-29:** 支持对话中途切换工具/模型，切换流程：
  1. 客户端发 `client.switch-model` 帧（含新 provider + model）
  2. Gateway 调用当前工具对已有对话做**摘要**（用当前模型生成，内容：用户意图 + 关键结论）
  3. 以摘要作为新工具/模型的 system prompt，开启新的 `ai_session_id`
  4. 前端气泡不清空，插入一条系统消息"已切换至 X 模型，上下文已摘要传入"

### HTTP vs WebSocket 职责边界
- **D-43:** **HTTP 负责所有历史数据加载，WS 只负责实时流。两条通道严格隔离，不交叉。**

  | 操作 | 通道 |
  |------|------|
  | 加载会话列表 | HTTP `GET /api/server/chat-sessions` |
  | 加载某会话历史消息 | HTTP `GET /api/server/chat-sessions/:id/messages` |
  | 历史消息渲染 | 直接从 HTTP 响应渲染，不经过 WS |
  | 发送新消息 | WS `client.chat` |
  | 接收流式 delta | WS `agent.delta` |
  | 接收完整回复 | WS `agent.result` |
  | 会话列表刷新 | HTTP 再请求一次（由 `agent.result` 事件触发） |

  - 打开 `/chats/:sessionId` 时：先 HTTP 拉历史 → 渲染完成 → 再建立 WS（准备发新消息）
  - WS 断开时历史记录**不丢失**（已渲染在 DOM）
  - 禁止通过 WS 推送历史消息或补发已存库的事件

### 流式进行中 UI 锁定
- **D-44:** 从发出 `client.chat` 到收到 `agent.result` 期间，该会话处于 **in-flight 状态**：
  - 输入框禁用，发送按钮禁用（显示 loading 态）
  - 已发送的用户消息立即渲染，AI 气泡出现流式光标动画
  - `agent.delta` 实时追加文本，`agent.result` 到达后解锁、追加花费卡片
  - 同一会话不允许并发发消息

### 中途断线 / 退出场景
- **D-45:** Gateway subprocess 独立于 WS 连接运行，用户关闭页面不会中断它。`message_stop` 到达时 Gateway **无论有无客户端在线**都执行写库 + Relay 同步。

  **用户重新打开该会话时：**
  - HTTP 拉历史 → 若 AI 回复已存在 → 正常完整展示，无特殊处理
  - HTTP 拉历史 → 若 AI 回复不存在（subprocess 还在跑）→ UI 在最后一条用户消息后显示 **"AI 正在回复…"** 占位气泡（带动画），并标记该会话为 in-flight 锁定态
  - WS 重连后，Gateway 检测到该 sessionId 有活跃 subprocess → 继续推送剩余 `agent.delta` + 最终 `agent.result`；Web 端将"占位气泡"替换为实际内容

  **Gateway 实现要求：**
  - `ChatSessionRunner` 在 subprocess 生命周期内，维护 `sessionId → subprocess` 的内存 Map
  - 新的 WS 客户端订阅某 sessionId 时，若 Map 中存在活跃 subprocess → 立即开始（或恢复）推送事件
  - subprocess 退出后从 Map 中清除

  **中途断线重连（方向 B）：**
  - Gateway 在 subprocess 运行期间维护内存 buffer：`Map<sessionId, { accumulatedText: string }>`
  - 每个 `agent.delta` 追加到 buffer
  - 客户端重连后，Gateway 检测到该 sessionId 有活跃 subprocess → 立即发 `gateway.chat-catchup { sessionId, text: accumulatedText }` 帧
  - 客户端收到 catchup：用 `accumulatedText` 替换"AI 正在回复…"占位气泡，后续继续接收新 `agent.delta` 追加
  - `message_stop` 到达 → 写库 → 发 `agent.result` → 清除 buffer → 解锁输入框

  **边界情况：**
  - subprocess 运行时 Gateway 进程崩溃 → buffer 丢失、subprocess 不存在、DB 无回复记录 → UI 显示"回复丢失，请重试"按钮（允许重新发同一条消息）
  - 判断标准：HTTP 加载历史，最后一条是 `user.message` 且无 `agent.result`，且 WS 重连后未收到 catchup → 认为回复丢失

### Markdown 渲染
- **D-36:** Agent 回复气泡必须完整渲染 Markdown，包含：
  - **代码块**：语法高亮（`highlight.js` 或 `shiki`），深/浅色主题随 app 主题切换，一键复制按钮
  - **行内代码**：等宽字体 + 背景色区分
  - **标题 / 列表 / 引用块 / 表格**：正常 Markdown 语义渲染
  - **粗体 / 斜体 / 删除线**：正常渲染
  - **链接**：`target="_blank" rel="noopener"`，禁止自动跳转
  - **图片**：暂不支持（渲染为 alt 文本，超出本 phase 范围）
- **D-37:** 使用 `react-markdown` + `remark-gfm`（支持 GFM：表格、strikethrough、task list）作为渲染引擎，代码高亮用 `rehype-highlight` 或 `react-syntax-highlighter`。禁止用 `dangerouslySetInnerHTML` 直接插入原始 HTML。
- **D-38:** 流式打字机效果期间（`agent.delta` 阶段）：累积文本**实时**经过 Markdown 解析渲染，不等到 `agent.result` 才渲染格式；未闭合的代码块在流式阶段以原始文本兜底，`agent.result` 到达后重新完整渲染一次。
- **D-39:** 用户消息气泡：不渲染 Markdown，按纯文本显示（保留换行），避免用户输入被误格式化。

### 订阅信息
- **D-30:** 从 Claude CLI 读取账户订阅信息（剩余额度、上下文窗口大小）。**待研究（planner）：** `claude` 命令是否暴露此信息（`claude config` / `claude status` 等），以及 Codex / Copilot 对应的接口。
- **D-31:** 订阅信息在 UI 的设置/账号 tab 展示，不影响聊天主流程。

### UI 结构（飞书三栏布局）
- **D-06:** 在现有 `apps/web` 中新增路由和页面，不新建独立 app。新旧路由并存，不删旧页面。
- **D-06b:** 新界面命名为 **Chats**。路由：`/chats`（默认打开第一个或空态）、`/chats/:sessionId`（指定会话）。组件：`ChatsLayout`、`ChatSessionList`、`ChatPanel`。
- **D-06c:** 登录后默认跳转改为 `/chats`（现在是 `/sessions`）。旧 `/sessions` 路由保留，不删除。

**三栏布局（参考飞书截图）：**
- **D-07a 最左栏（窄导航，固定宽约 56px）：**
  - 顶部：用户头像
  - 中部：图标 + 文字 tab（① 会话列表 / Chats）
  - 顶部右上角：`+` 新建会话按钮
  - 底部：设置/账号入口
- **D-07b 中栏（会话列表，约 280px）：**
  - 顶部搜索框（⌘+K）
  - 会话列表每行：AI model 彩色头像圆形 + 名称、最后一条消息预览（截断 40 字）、时间戳、运行中绿点动画
  - 空态：大号"新建会话"引导按钮
- **D-07c 右栏（聊天区，剩余宽度）：**
  - 顶部 header：会话名称（model + 创建时间）、当前模型标签、换模型入口
  - 消息流区域：参考 HTML mockup（agent 气泡、user 气泡、tool 折叠卡片、花费卡片）
  - 底部输入框：固定底部，支持多行，发送按钮

**移动端适配：**
- **D-08:** 手机模式（< 768px）：隐藏左侧窄导航和中栏，默认只显示右侧聊天区。
  - 左上角汉堡菜单 → 侧边抽屉滑出会话列表
  - 在会话列表里点击 → 关闭抽屉，显示聊天区
- **D-09:** 渲染风格参考 `docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html`：tool call 折叠卡片、agent 气泡、user 气泡、结果花费卡片（耗时/token/cost）。

### Session ID 追踪
- **D-11:** Session 创建时，Relay 同步写 Server DB（通过 `syncToServer`），Server 将 session 关联到当前登录用户（accountId/workspaceId/userId）。
- **D-12:** Web 端通过 `/api/server/sessions` 读取当前用户的会话列表（已有接口），不依赖 localStorage。

### Relay → Server 同步
- **D-13:** Relay 同步**全量事件**到 Server DB（包括 `terminal.output`、`agent.delta`、`agent.result`、`agent.tool`、`session.exited` 等），扩展现有 `syncToServer` 机制，不限于白名单事件。注：`agent.turn` / `agent.typing` 已随 JournalWatcher 链路删除，不再存在。
- **D-14:** 新增：session 创建时 Relay 调 `POST /api/relay/sessions` 写 Server，记录 sessionId/gatewayId/provider/accountId。

### 认证
- **D-15:** 新界面直接复用 `apps/web` 已有的登录/auth 体系：auth context、token 存储、路由守卫全部原地复用，无需搬迁或重建（因为就在同一个 app 内）。
- **D-16:** Server 侧登录接口（`POST /api/auth/login`、`POST /api/auth/register` 等）直接复用，不新增也不修改。
- **D-17:** WS 连接用现有 `ws-ticket` 机制（`GET /api/relay/ws-ticket` + `client.auth: { ticket }`）。
- **D-18:** 认证相关文件直接在 `apps/web` 内引用：`src/contexts/auth-context.tsx`、`src/pages/login-page.tsx`、`src/pages/register-page.tsx`、`src/components/console/web-auth-shell.tsx`——新的 `/chats` 路由复用同一套 `RequireUserAuth` 守卫，不新建独立 app。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Protocol 定义
- `packages/protocol/src/index.ts` — 所有 Relay WS 帧类型定义，新增帧必须在此添加
- `apps/relay/src/relay.ts` — Relay 服务端逻辑，`client.chat` 和 `client.list-providers` 在此处理（无 `client.create-session` 帧）
- `apps/gateway/src/relay-client.ts` — Gateway 侧 Relay 客户端，处理来自 Relay 的新帧

### 现有 Chat 基础设施
- `apps/gateway/src/agent-select-detect.ts` — provider 选项检测逻辑，provider 白名单参考
- `apps/gateway/src/session-runner-spawn.ts` — PTY spawn 逻辑参考（新 ChatSessionRunner 独立实现，不复用）
- **注：** `apps/gateway/src/chat-handler.ts` 已随 JournalWatcher 一起删除，不可引用

### DB Schema
- `apps/server/sql/002_gateway_runtime_sync.sql` — `gateway_sessions` / `gateway_runtime_events` / `gateway_sync_cursors` 现有表，chat 链路可直接复用
- `apps/server/sql/004_chat_messages.sql` — **需新建**，`gateway_chat_messages` 新表（schema 见 D-41）
- `apps/gateway/src/store.ts` — Gateway SQLite `sessions` + `session_chats_events` 表（D-40）

### Server 接口
- `apps/server/app/controller/session.ts` — session list/events 接口
- `apps/server/app/router.ts` — 所有 API 路由，新增路由按 `/api/server/` 前缀（读）或 `/api/relay/` 前缀（写）
- 新增：`GET /api/server/chat-sessions/:sessionId/messages` — 历史消息加载（D-42）

### UI 参考
- `docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html` — **必读**，聊天区渲染样式的完整参考实现（tool card、gas bubble、result card、dark mode 变量全在此）
- **注：** `apps/web/src/components/session/chat-bubble.tsx` 已随旧 chat 链路删除，本 phase 从 HTML mockup 重建

### 认证流程（同一 app 内直接复用）
- `apps/web/src/contexts/auth-context.tsx` — auth 状态管理，新路由直接 import
- `apps/web/src/pages/login-page.tsx` — 登录 UI，保持不变
- `apps/web/src/pages/register-page.tsx` — 注册 UI，保持不变
- `apps/web/src/components/console/web-auth-shell.tsx` — auth 守卫 shell
- `apps/web/src/routes.tsx` — 新增 `/chats` 和 `/chats/:sessionId` 路由，复用 `RequireUserAuth` 守卫

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/protocol/src/index.ts`：扩展 `RelayClientToServerFrame` 和 `RelayServerToClientFrame`，加新帧类型
- `apps/relay/src/relay.ts`：`syncToServer` 函数已有，扩展调用点即可；gateway/client 连接管理逻辑已有
- `apps/gateway/src/session-runner-spawn.ts`：PTY spawn 逻辑参考，新 `ChatSessionRunner` 独立实现不复用此处
- `apps/server/app/controller/session.ts`：`list`/`events` 接口已有，`/chats` 界面直接复用

### Established Patterns
- Relay WS 帧格式：discriminated union，`type` 字段作区分，现有帧遵守此格式，新帧同理
- Gateway 白名单校验：`SAFE-01` 要求 provider 必须在白名单内，首条 `client.chat` 中的 provider 校验遵守同一规则
- Server 路由前缀：读接口走 `/api/server/`，Relay 写接口走 `/api/relay/`（参见 CLAUDE.md 规范）
- Auth token 流：login → JWT → ws-ticket → WS auth，新 `/chats` 路由走同一流程

### Integration Points
- `apps/relay/src/relay.ts` → 新增对 `client.chat`（含隐式创建逻辑）和 `client.list-providers` 的处理，转发给目标 gateway
- `apps/gateway/src/relay-client.ts` → 新增对 `client.chat` 帧的响应（含 `gateway.session-created` 回包）和 `client.list-providers` 响应
- `apps/server/app/router.ts` + `apps/server/app/controller/` → 新增 `GET /api/server/chat-sessions/:id/messages`（D-42）和 Relay 写入接口
- `apps/web/src/pages/chats-*.tsx` + `apps/web/src/components/chats/` → 新增聊天界面页面和组件，连接 Relay WS，调 Server REST API

</code_context>

<specifics>
## Specific Ideas

- UI 参考：微信聊天列表截图（用户提供）——左侧窄导航图标栏，中间会话列表（头像、名称、消息预览、时间），右侧聊天区
- 聊天区渲染参考：`docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html`，该 mockup 已完整实现所需的所有组件（tool card 展开/折叠、用户气泡绿色、agent 气泡白色/暗色、流式光标、thinking 动画、result 花费卡片）
- Model 头像颜色：Claude = 紫色系 (#c084fc / #6366f1)，Codex = 蓝色系，opencode = 橙色系
- 移动端优先：viewport meta 已在 mockup 中，max-width 760px，手机上全屏单列

</specifics>

<deferred>
## Deferred Ideas

- **PWA push 通知** — session 完成后推送到手机，属于通知基础设施，独立 phase
- **Flutter 客户端** — Phase 9 已规划
- **多 workspace 切换** — Phase 10 已规划
- **会话内权限审批** — permission prompt 渲染做到 UI 里，但批准/拒绝的实际执行逻辑（写 PTY）属于 Experience Hardening (Phase 2)

</deferred>

---

*Phase: 13-mobile-web-chat*
*Context gathered: 2026-05-10*
