# Phase 11: Agent 实时对话视图 - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning
**Source:** PRD Express Path (docs/working/2026-05-05-agent-jsonl-history-view.md)

<domain>
## Phase Boundary

实现基于 JSONL 文件的 Agent 实时对话视图。PTY 继续运行不变，并行启动 JournalWatcher 读取 Claude / Codex 写入的结构化 JSONL 文件，将解析出的对话 turn 写入 DB，同时通过现有事件通道实时推送给手机客户端。手机端展示双侧气泡对话界面，支持发送消息、选项 chip 点击、断连重连历史恢复、降级提示。

**不做的事：**
- 不替换 PTY 实时流（terminal.output 继续写，回放不受影响）
- 不展开工具调用结果
- 不支持 Copilot

</domain>

<decisions>
## Implementation Decisions

### 协议层
- `RelayClientToServerFrame` 追加 `{ type: 'client.chat'; sessionId: string; message: string }`
- `RelayServerToGatewayFrame` 追加 `{ type: 'client.chat'; clientId: string; sessionId: string; message: string }`

### 数据层 — conversation_turns 表
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
- user turn 和 assistant turn 共用同一序列（保证顺序完整）
- Store 新增方法：`insertConversationTurn` / `listConversationTurns`

### 新事件类型（追加到 SessionEventType）
- `'agent.typing'` — 用户发消息后立即推
- `'agent.turn'`  — assistant turn 完成后推
- `'agent.select'` — agent 呈现交互式选项时推

### agent.turn payload 结构
```json
{
  "role": "assistant",
  "content": "markdown 文本（仅文本部分，纯工具调用 turn 为空字符串）",
  "tools": [{ "name": "Write", "inputSummary": "path: src/foo.ts, content: ..." }],
  "turnIndex": 3
}
```
- `content` 只存 text 部分，`tools` 数组只含 `name` + `inputSummary`（input 序列化后截断 100 字符）
- 纯工具调用 turn：content 为空字符串，前端只显示 chip

### agent.select payload 结构
```json
{
  "options": [
    { "index": 1, "label": "不用现有工厂函数" },
    { "index": 2, "label": "新增 simpleComputeMetric 工厂" },
    { "index": 3, "label": "Type something." }
  ],
  "raw": "最后几行终端原文（ANSI stripped）"
}
```
- agent.select 不写 DB，只实时推送
- 防重复：维护 `selectEmitted` 状态锁，emit 后设 true，收到新 terminal.output 时解锁

### Gateway 处理 client.chat
- 收到后：`store.insertConversationTurn(role: 'user', ...)` → `pty.write(message + "\n")` → `emit agent.typing`
- Relay 模式：relay-client.ts 处理 → 调 gateway 内部函数
- Direct 模式：daemon.ts WebSocket handler 新增 case

### JournalWatcher
- 在 `pollAgentSessionId` resolve 后由 SessionRunner 启动，session 退出时调 `stop()`
- 文件不存在时：每 1s 检查，出现后再启动 fs.watch
- 主路径 `fs.watch`（内核事件）+ 保底 2s setInterval
- 增量读取：维护 `lastOffset`，每次只读新增字节，残行拼接后按 `\n` 切行 JSON.parse

### Turn 完成判定
- **Claude**：JSONL 新增 `type: "assistant"` 行，内容含 `text` 或 `tool_use`
- **Codex**：`task_started` 到 `task_completed` 之间 `response_item`（role=assistant, output_text）按序拼接（`\n\n`），`task_completed` 时写一条 turn

### agentSessionId 获取失败降级
- JournalWatcher 不启动
- `agent.turn` 不推送
- 前端：超过 30s 无 `agent.turn` 显示"无法获取结构化回复，请切换终端视图查看"

### 推送路径
复用现有通道：JournalWatcher → store.appendEvent → publishEvent → Runner socket → Daemon WebSocket → Relay → Mobile

### API
```
GET /api/sessions/:id/conversation
→ { turns: ConversationTurn[] }
```
读 conversation_turns 表，不读 JSONL 文件，权限复用现有 session 鉴权。

### 前端路由
- 删除 `/remote/session/:sessionId/simple`
- 新建 `/remote/session/:sessionId/chat`（mode=`'chat'`）替代
- `session-simple-page.tsx` → 重命名为 `session-chat-page.tsx`
- `ChatSessionSurface` 组件整体重写（不再用 LineBuffer + PTY 解析）
- `routes.tsx` mode 类型：`'control' | 'replay' | 'chat'`

### 前端聊天页行为
1. 进入时调 `GET /api/sessions/:id/conversation` → 渲染历史气泡
2. 订阅 WebSocket，收 `agent.turn` → 追加 AI 气泡
3. 收 `agent.typing` → 显示 typing indicator
4. 输入框发消息 → `client.chat { sessionId, message }`
5. 收 `agent.select` → 输入框上方显示 raw，渲染选项 chip，点击发数字
6. 超过 30s 无 `agent.turn` → 降级提示

### 气泡 UI
- 用户：右侧绿底
- AI：左侧，markdown 渲染（表格、代码块、加粗）
- 工具调用：折叠 chip，不展开结果
- Box-drawing 表格（`│ ├ ┌`）→ 解析为 HTML `<table>`

### Claude's Discretion
- JournalWatcher 内部防抖实现细节（连续事件去重）
- 前端 markdown 渲染库选型（复用现有或新增轻量库）
- agent.turn 气泡的具体 CSS 样式（遵循 apps/web/CLAUDE.md token 规范）
- box-drawing 表格解析的具体正则实现

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### PRD / 设计文档
- `docs/working/2026-05-05-agent-jsonl-history-view.md` — 完整设计文档，含数据流、验证方法和实现顺序

### 协议层
- `packages/protocol/src/index.ts` — RelayClientToServerFrame / RelayServerToGatewayFrame 类型定义，新增 client.chat 在此

### Gateway 后端
- `apps/gateway/src/store.ts` — DB schema、SessionEventType、appendEvent、现有 Store 方法
- `apps/gateway/src/session-runner.ts` — pollAgentSessionId、SessionRunner 生命周期（JournalWatcher 从此启动）
- `apps/gateway/src/daemon.ts` — Direct 模式 WebSocket handler，新增 client.chat case 在此
- `apps/gateway/src/relay-client.ts` — Relay 模式 client.chat 处理入口

### Relay Server
- `apps/relay/src/` — client.chat 转发逻辑（参考 client.input 的转发实现）

### 前端
- `apps/web/src/routes.tsx` — 路由事实源，删 /simple 加 /chat
- `apps/web/src/pages/session-simple-page.tsx` — 待重命名为 session-chat-page.tsx 并重写
- `apps/web/src/components/session/chat-session-surface.tsx` — 整体重写为 JSONL-based 实现
- `apps/web/CLAUDE.md` — 前端路由规范、i18n 规范、token 规范（MUST 遵守）

</canonical_refs>

<specifics>
## Specific Ideas

- Claude JSONL 路径：`~/.claude/projects/<encoded-path>/<agentSessionId>.jsonl`
- Codex JSONL 路径：`~/.codex/sessions/YYYY/MM/DD/rollout-*-<agentSessionId>.jsonl`
- 验证 session：Claude `f0e7761c-980c-40f3-ae05-1aeb12ebf259`（2135 行），Codex `019df652-697d-7e31-be30-32415be72d29`（203 行）
- agent.select 选项匹配规则：连续 ≥2 行格式 `^\s*(\d+)\.\s+(.+)$`，300ms 无新输出触发
- 仅 Claude / claude-proxy 触发 agent.select，Codex 不触发

</specifics>

<deferred>
## Deferred Ideas

- Copilot 支持（存储结构待调研）
- 工具调用结果展开
- PTY 实时流替换

</deferred>

---

*Phase: 11-agent*
*Context gathered: 2026-05-05 via PRD Express Path*
