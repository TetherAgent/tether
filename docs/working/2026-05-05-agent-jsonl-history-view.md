# Agent Session 实时对话方案

**日期**：2026-05-05  
**状态**：方案确认，待实现

---

## 背景

Tether 当前通过 PTY 捕获 agent（Claude/Codex）的终端输出，手机访问时看到的是原始文字流，存在以下问题：

- Markdown 表格渲染成 ASCII，横向溢出看不完
- ANSI 转义码残留
- 工具调用结果混在正文里，难以区分
- 没有消息气泡结构，不适合手机阅读

## 核心发现

Claude 和 Codex 在 PTY 模式下**均会写结构化 JSONL 文件**：

| Provider | 文件路径 | 写入时机 |
|---|---|---|
| Claude | `~/.claude/projects/<encoded-path>/<agentSessionId>.jsonl` | PTY session 启动后实时追加 |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*-<agentSessionId>.jsonl` | 同上 |

验证：Claude JSONL `f0e7761c-980c-40f3-ae05-1aeb12ebf259`（2135 行），Codex JSONL `019df652-697d-7e31-be30-32415be72d29`（203 行），均在 Tether PTY 模式下真实写入。

## JSONL 数据结构

**Claude** (`type` 字段区分)：
```
user      → 用户输入（content 为文本）
assistant → AI 回复（content 包含 text / tool_use）
system    → 系统消息（忽略）
last-prompt / attachment / permission-mode → 元数据（忽略）
```

**Codex** (`type` 字段区分)：
```
session_meta   → 会话元数据
response_item  → 对话内容（role: user/assistant/developer）
event_msg      → 事件（task_started / task_completed）
turn_context   → 环境快照（忽略）
```

特殊内容处理：
- `output_text` → 正文 markdown（直接渲染）
- `tool_use` → 工具调用（name + input，折叠展示）
- `input_text` 开头为 `#`、`<`、`AGENTS` → 系统注入，过滤掉

---

## 最终方案：实时对话 + DB 持久化

PTY 继续运行（不变），并行启动 `JournalWatcher` 读取 JSONL，将结构化 turn 写入 DB，同时实时推送给已连接的手机。

### 数据流

```
[Mobile] 用户点发送
  ├─► 乐观展示：本地立即渲染用户气泡（不等服务器确认）
  └─► 发送 client.chat { sessionId, message }
          │
          ▼
      [Relay] 转发 client.chat → Gateway（新增一个转发 case）
      [Direct 模式] Gateway WebSocket 直接处理 client.chat
          │
          ▼
      [Gateway]
          ├─► store.insertConversationTurn(role: 'user', content: message) ← 立即落库
          ├─► pty.write(message + "\n")
          └─► emit agent.typing { sessionId } → Mobile 显示 typing indicator

Agent 处理中（PTY terminal.output 继续写 DB，不变）

Agent 完成一个 turn（JSONL 更新）
  → JournalWatcher 检测到新 assistant turn
  → store.insertConversationTurn(role: 'assistant', ...)  ← 写 DB
  → store.appendEvent('agent.turn', ...)                  ← 推送给已连接的手机
  → Mobile 隐藏 typing indicator，追加 AI 气泡

手机断连重连：
  GET /api/sessions/:id/conversation → 读 DB → 恢复完整历史（含用户消息）
  重新订阅 WebSocket → 收 agent.turn 事件继续增量更新
```

### Turn 完成判定

- **Claude**：JSONL 新增 `type: "assistant"` 行，且内容包含 `text` 或 `tool_use`
- **Codex**：JSONL 新增 `type: "event_msg"` 且 payload.type = `"task_complete"`（注意无末尾 d）

**Codex turn content 汇总规则**：以 `task_started` 为起点，收集到 `task_completed` 之间所有 `type: "response_item"`、`role: "assistant"`、内容类型为 `output_text` 的条目，按顺序拼接（`\n\n` 分隔）作为该 turn 的 `content`。`role: "developer"` 的 response_item（系统消息）忽略。每个 `task_completed` 对应写入一条 `role: 'assistant'` 的 conversation turn。

---

## 数据层

### 新表 `conversation_turns`

```sql
CREATE TABLE conversation_turns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  turn_index  INTEGER NOT NULL,        -- 防重复，写入顺序序号
  role        TEXT    NOT NULL,        -- 'user' | 'assistant'
  content     TEXT    NOT NULL,        -- markdown 文本
  tools       TEXT,                    -- JSON string，工具调用数组（仅 assistant）
  created_at  INTEGER NOT NULL,
  UNIQUE(session_id, turn_index)
);
```

- `role: 'user'` — gateway 收到 `client.chat` 时立即写，内容为发送原文，不依赖 JSONL
- `role: 'assistant'` — JournalWatcher 从 JSONL 解析后写，INSERT OR IGNORE 幂等

**`turn_index` 赋值规则**：user turn 和 assistant turn 共用同一序列（便于前端按顺序渲染）。写入时查 DB 当前 session 最大 turn_index + 1：

```sql
SELECT COALESCE(MAX(turn_index), -1) + 1 FROM conversation_turns WHERE session_id = ?
```

读写在同一事务内，配合 `UNIQUE(session_id, turn_index)` 保证幂等。

Store 新增方法：`insertConversationTurn` / `listConversationTurns`

### 新事件类型

`SessionEventType` 追加：
```
'agent.typing'   // 用户发消息后立即推，表示 agent 在思考
'agent.turn'     // assistant turn 完成后推，payload 含结构化内容
'agent.select'   // agent 呈现交互式选项列表，等待用户选择
```

`agent.turn` payload 结构：
```json
{
  "role": "assistant",
  "content": "markdown 文本（仅文本部分，空字符串表示纯工具调用 turn）",
  "tools": [{ "name": "Write", "inputSummary": "path: src/foo.ts, content: ..." }],
  "turnIndex": 3
}
```

**`content` 与 `tools` 分离规则**：当 assistant turn 同时含 text 和 tool_use 时，`content` 只存 text 部分，工具调用统一进 `tools` 数组。前端渲染顺序：文字气泡在上，工具 chip 在下。纯工具调用 turn 时 `content` 为空字符串，前端只显示 chip。

**`tools` 字段说明**：只保留 `name`（工具名）和 `inputSummary`（`input` 对象序列化后截断至 100 字符），不包含工具执行结果。

`agent.select` payload 结构：
```json
{
  "options": [
    { "index": 1, "label": "不用现有工厂函数" },
    { "index": 2, "label": "新增 simpleComputeMetric 工厂" },
    { "index": 3, "label": "Type something." },
    { "index": 4, "label": "Chat about this" }
  ],
  "raw": "最后几行终端原文（ANSI stripped）"
}
```

---

## 协议改动

### `packages/protocol/src/index.ts`

新增 `client.chat` frame：

```typescript
// RelayClientToServerFrame 追加：
| { type: 'client.chat'; sessionId: string; message: string }

// RelayServerToGatewayFrame 追加：
| { type: 'client.chat'; clientId: string; sessionId: string; message: string }
```

### Relay Server（约 5 行）

在处理 `client.input` 转发的地方，复制同样逻辑处理 `client.chat`：收到客户端 `client.chat` → 转发给对应 gateway 的 WebSocket。

### Gateway（两处）

**Relay 模式**：`relay-client.ts` 收到 `client.chat` frame → 调 gateway 内部处理函数

**Direct 模式**：`daemon.ts` WebSocket handler 里新增 `client.chat` case，与 relay 模式走同一处理函数

---

## 后端实现

### JournalWatcher（新文件）

- 在 `pollAgentSessionId` resolve 后，由 `SessionRunner` 启动
- session 退出时调用 `stop()` 清理资源

```typescript
class JournalWatcher {
  constructor(sessionId, provider, agentSessionId, store, publishEvent)
  start(): void   // 启动监听
  stop(): void    // 清理 watcher + fallback timer
}
```

#### 文件不存在时的处理

`pollAgentSessionId` resolve 后 JSONL 文件不一定立即存在（Claude 第一条消息前可能未写入）。处理方式：

```
start():
  if 文件存在 → 直接 fs.watch + 开始读
  else → 每 1s 检查文件是否出现，出现后再启动 fs.watch
```

`fs.watch` 对不存在的路径会抛错，必须先确认文件存在再 watch。

#### 文件监控机制

主路径用 **`fs.watch`**（内核事件驱动），保底用 **2s 定时 poll**：

```typescript
// 主路径：内核通知（inotify / FSEvents），写入后 < 50ms 触发
const watcher = fs.watch(filePath, { persistent: false }, () => {
  this.tryRead(); // 防抖：连续事件只触发一次读取
});

// 保底：防止 fs.watch 极端情况丢事件（不影响主路径）
const fallback = setInterval(() => this.tryRead(), 2000);
fallback.unref();
```

| 指标 | 纯 500ms poll | fs.watch + 保底 poll |
|------|--------------|----------------------|
| 响应延迟 | 最多 500ms | 通常 < 50ms |
| CPU 占用 | 每 500ms stat | 只在写入时触发 |
| 可靠性 | 稳定 | 局部文件完全够用 |

#### 增量读取（字节偏移）

每次触发只读新增字节，不重读全文件：

```
lastOffset = 0

tryRead():
  newSize = stat(filePath).size
  if newSize <= lastOffset → return

  读取 [lastOffset, newSize) 字节
  拼接上次残行（JSONL 行可能被截断写了一半）
  按 \n 切行，每行 JSON.parse
  过滤出 assistant turn（Claude/Codex 各自规则）
  store.insertConversationTurn(role: 'assistant', ...)  // INSERT OR IGNORE，幂等
  publishEvent('agent.turn', ...)
  lastOffset = newSize
```

`turn_index` + `UNIQUE(session_id, turn_index)` 保证重启或重复触发不会重复写入。

### 交互式选项检测（agent.select）

Claude Code 有时不走完整 turn，而是在中途呈现编号选项等待用户选择（如"1. 不用现有工厂函数 / 2. 新增工厂 / 3. Type something."）。这类内容在 PTY `terminal.output` 里，不在 JSONL 里，手机聊天界面无法从 `agent.turn` 感知。

**仅适用于 Claude / claude-proxy**。Codex 的 `approval_policy` 默认为 `never`，完全自主执行，不会呈现编号选项，`agent.select` 对 Codex 不触发。

**检测时机**：daemon 在处理每一条 `terminal.output` 事件时，对最新的 PTY 输出缓冲（最后 50 行，ANSI stripped）尝试匹配选项模式。

**选项匹配规则**：
```
连续出现 ≥ 2 行，每行格式为：
  ^\s*(\d+)\.\s+(.+)$
且最后一行之后有光标停留（无新输出超过 300ms）
```

**触发后**：
```
解析出 options 数组
emit agent.select { options, raw }
  → 推送给已连接的手机
```

**防重复触发**：维护状态锁 `selectEmitted`，一次选项展示只 emit 一次：

```
selectEmitted = false

每条 terminal.output 进来：
  清除旧 debounce timer
  若 selectEmitted → 解锁（selectEmitted = false）
  设新 timer(300ms):
    若匹配选项模式 && !selectEmitted:
      emit agent.select
      selectEmitted = true
```

用户回复后 agent 输出新内容，新的 terminal.output 到来时自动解锁，避免同一轮选项被多次推送。

**手机收到 `agent.select`**：
- 在输入框上方显示终端原文（`raw`）作为上下文
- 渲染可点击的选项 chip（1 / 2 / 3 / 4）
- 用户点击 chip → 发送 `client.chat { message: "1" }` → gateway `pty.write("1\n")`
- 用户也可以直接在输入框输入任意文字（对应"Type something."选项）

**注意**：`agent.select` 不写 DB，只是实时推送给当前连接的手机，历史记录里不保存选项界面。

---

### agentSessionId 获取失败的降级

`pollAgentSessionId` 超时返回 undefined 时（极短 session、Agent 异常），JournalWatcher 不启动：

- 手机聊天界面：发送消息仍正常（pty.write 不依赖 agentSessionId）
- `agent.typing` 正常推送
- `agent.turn` 不会推送（没有 Watcher）
- 前端降级：超过 30s 没有收到 `agent.turn`，显示"无法获取结构化回复，请切换终端视图查看"

### 推送路径

复用现有通道：

```
JournalWatcher
  └─► store.appendEvent('agent.turn', payload)
          └─► publishEvent(event)
                  └─► Runner socket → Daemon WebSocket → Relay → Mobile
```

### 新 API

```
GET /api/sessions/:id/conversation
→ { turns: ConversationTurn[] }
```

读 `conversation_turns` 表，不读 JSONL 文件。权限复用现有 session 鉴权。

---

## 前端

**路由决策**：删除 `/remote/session/:sessionId/simple`，新建 `/remote/session/:sessionId/chat` 替代。`session-simple-page.tsx` → 重命名为 `session-chat-page.tsx`，`ChatSessionSurface` 组件整体重写为 JSONL-based 实现（不再用 `LineBuffer` + PTY 解析）。`routes.tsx` 中 mode 类型扩展为 `'control' | 'replay' | 'chat'`。

新路由 `/remote/session/:id/chat`：

1. 进入时调 `GET /api/sessions/:id/conversation` → 渲染历史气泡（含双侧消息）
2. 订阅 WebSocket，收 `agent.turn` → 追加 AI 气泡
3. 收 `agent.typing` → 显示 typing indicator
4. 输入框发消息 → 发送 `client.chat { sessionId, message }` → gateway 写 PTY
5. 收到 `agent.select` → 输入框上方显示终端原文，渲染选项 chip，点击发送对应数字
6. 超过 30s 无 `agent.turn` → 显示降级提示，引导切换终端视图

气泡 UI：
- 用户：右侧绿底
- AI：左侧，markdown 渲染（表格、代码块、加粗等）
- 工具调用：折叠 chip，不展开结果
- Box-drawing 表格（`│ ├ ┌`）→ 解析为 HTML `<table>`

---

## 实现顺序

| 步骤 | 内容 | 验证 |
|------|------|------|
| 1 | `packages/protocol` 新增 `client.chat` frame 类型 | TS 编译通过 |
| 2 | `conversation_turns` 表 + Store 方法 | 单测：① turn_index 连续计算正确；② INSERT OR IGNORE 幂等（同 turn_index 插两次，第二次静默忽略，行数不变）；③ listConversationTurns 按 turn_index 升序返回 |
| 3 | Relay server 转发 `client.chat` | 单测：mock gateway ws，验证 relay 收到 `client.chat` 后向 gateway 转发 frame 结构完整（含 clientId、sessionId、message） |
| 4 | Gateway 处理 `client.chat`（relay + direct 两路）：写用户 turn + pty.write + emit agent.typing | 手动验证三点：① 查 DB 确认 user turn 写入；② 终端看到消息回显（PTY 收到）；③ ws 捕获到 `agent.typing` 事件 |
| 5 | `JournalWatcher` 类（文件等待 + fs.watch + 增量读 + 落库 + emit） | 跑一个 session 验证：① DB 有 assistant turn，content / tools 字段值正确；② 连续触发两次 tryRead，DB 行数不变（幂等）；③ turn_index 与 user turn 连续无断层 |
| 6 | `SessionRunner` 里 agentSessionId 已知后启动 Watcher，session 退出时 stop | 端到端验证：① 启动 session 后日志出现 JournalWatcher 启动记录；② agent 回复后 `agent.turn` 事件被推送到客户端；③ session 退出后 watcher.stop() 调用无报错、无资源泄漏 |
| 7 | `GET /api/sessions/:id/conversation` | curl 验证：发消息后 user turn 出现，agent 回复后 assistant turn 出现，返回列表按 turn_index 升序，双侧条目均在 |
| 8 | `terminal.output` 选项检测 + emit `agent.select` | 验证两点：① 手动触发 Claude 交互式选项场景，agent.select 被推送，options 数组解析正确；② 用户回复后再次触发相同场景，确认 selectEmitted 锁生效，不重复 emit |
| 9 | 前端聊天页面（含选项 chip + 降级提示） | 手机实测五点：① 历史气泡正确加载；② 实时 agent.turn 追加气泡；③ 选项 chip 点击后发送对应数字；④ 断连重连后历史恢复完整；⑤ 30s 无 agent.turn 出现降级提示 |

---

## 手机发消息与桌面 PTY 的关系

`client.chat` 最终调 `pty.write(message + "\n")`，等价于桌面键盘输入，PTY 和 Agent 完全不感知来源差异。

- **桌面端有人看终端**：手机发的消息会在终端窗口里显示（PTY echo），就像有人在桌面敲了那行字，属于正常行为
- **并发输入**：桌面和手机同时打字会导致 PTY 输入交错，与今天多客户端并发 `client.input` 是同一问题，操作层面约定不同时操作即可
- **JournalWatcher 对 PTY 无影响**：只读 JSONL 文件，不写 PTY

---

## 不做的事

- ❌ 替换 PTY 实时流（PTY terminal.output 继续写，回放不受影响）
- ❌ 工具调用结果展开（内容太长）
- ❌ Copilot 支持（存储结构待调研）

## 技术边界

- JSONL 文件只存在于 gateway 本机
- 仅支持 Claude / claude-proxy 和 Codex / codex-proxy
- Claude JSONL 写入依赖 Claude Code 正常运行且 session 足够长，极短 session 可能无文件
- Direct 模式和 Relay 模式均支持（各自处理 `client.chat`，后续走同一逻辑）

## 参考

- Claude JSONL 验证 session：`f0e7761c-980c-40f3-ae05-1aeb12ebf259`（2135 行）
- Codex JSONL 验证 session：`019df652-697d-7e31-be30-32415be72d29`（203 行）
- 预览效果：`/tmp/session_preview.html`（2026-05-05 生成）
