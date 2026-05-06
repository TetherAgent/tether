# Tether 简洁聊天视图设计文档

**最后更新**：2026-05-05
**当前状态**：
- 方案 A 已落地（apps/web 简洁视图）
- 方案 Z（F + 多渲染器）已通过 4 份 spike 验证（含真实 codex stream-json 端到端回放）
- **跨模式 Resume 突破已验证**（Claude/Codex 都支持 session_id 跨模式 resume，token 1x）
- 半桥实测确认 PTY → 结构化派生不可靠（截图证据：状态栏混入识别结果）
- 待决策落地：F + Z + 跨模式 Resume 完整路径（~7 天）vs MVP 砍刀（~3 天）

---

## 1. 背景与问题

`/remote/session/:sessionId/simple` 是 Tether 基于微信聊天风格的 AI 对话视图。
Agent 的消息气泡需要展示**可读的纯文本**，不能出现 ANSI 转义序列或 spinner 帧。

### 1.1 根本原因

Gateway 当前只传输原始 PTY 字节流（`terminal.output` 事件），包含：

- ANSI 颜色 / 光标序列（CSI、OSC、DCS 等）
- Terminal 握手响应（`\x1b[42;1R`、`\x1b[?62;22;52c` 等）
- OSC 窗口标题更新（`\x1b]0;window-title\x07`）
- Spinner 动画帧（用 `\r` 覆写同一行）

要还原成"屏幕上可见的干净文字"，必须经过完整的终端状态机或绕开终端渲染。

### 1.2 消息分割点

`user.input` 事件是天然的消息边界：每次用户发送输入，触发一次"提交"——之前积累的
agent 输出 = 一条 agent 气泡，用户文字 = 一条用户气泡。

Composer 会先发文字再发 `\r`（间隔 ~40ms），处理逻辑：收到 `\r` 时立即提交；
否则等待 1 秒超时兜底。

### 1.3 Codex PTY 提交约束（2026-05-06 补充）

简洁视图如果要直接向 Codex PTY 发送用户输入，必须沿用控制页 terminal composer
已经验证过的两帧提交方式：

1. `client.input` / `input`：`data` 为用户文本。
2. 等待约 `40ms`，保持和控制页 terminal composer 一致的按键间隔。
3. `client.input` / `input`：`data` 为 `"\r"`。

不要合并为单帧 `data: "用户文本\r"`。实测 Codex `v0.128.0` 会把合并帧显示到
输入区，但不稳定触发提交；DB 中会落成一条 `user.input`（例如 `'111^M'`），而成功路径
应是两条 `user.input`（例如 `'111'`、`'^M'`）。
简洁页同步连续发送两帧也实测不稳，必须保留这个短延迟。

简洁页 textarea 可以在发送前把内部换行压成空格，避免误入 Codex 多行编辑；但压平后仍必须
按“两帧提交”发送。后续如果简洁页从 `client.chat` 切回 `client.input`，必须先按这个规则
实现并验证 Relay 和 Direct 两种连接模式。

---

## 2. 方案全景

历经多轮迭代，候选方案如下。**A 已落地、Z 推荐**，其余作为对比基线保留。

### 方案 A：浏览器侧 xterm 无头解析 ✅ 已落地

在 `chat-session-surface.tsx` 中创建不挂载 DOM 的 xterm Terminal 实例作为解析器。
所有 `terminal.output` 事件写入该实例，触发 `user.input` 时读取 `term.buffer.active`
获得干净文本。

**实现**：
- `apps/web/src/lib/terminal-text-extractor.ts` — headless `@xterm/xterm` 解析器
- `apps/web/src/components/session/chat-session-surface.tsx` — 订阅 `terminal.output`，
  用 extractor 抽出干净文本；`onLineFeed` 仅收集 `\n`-终止的行，spinner 自动过滤

**优点**
- Gateway 0 改动
- `@xterm/xterm` 已是项目依赖
- 处理终端序列最准确（xterm 本身就是终端状态机）

**缺点**
- `term.write()` 异步，commit 时需要 Promise 队列等待写入完成
- 纯 TUI agent（用 CSI 定位绘制、不发 `\n`）不会有任何 committed 行
- agent 长句无 `\n` 流式输出时，在 `\n` 之前不显示
- 整段输出渲染为单个 `<pre>`，无 markdown 层级

### 方案 B：Gateway 新增 `terminal.text` 事件（全屏快照）

Gateway 在 `flushOutput` 时通过 TerminalGrid 状态机处理原始字节，发出 `terminal.text`
事件，payload 为当前屏幕干净文本快照。

**优点**：前端逻辑极简；对回放/控制页面无影响（忽略未知类型）；Relay 自动透传
**缺点**：每次 flush 多一个事件，存储量 +30%~50%；旧会话回放需要兜底；TerminalGrid 约 80 行

### 方案 B+：Gateway 只发"已提交行"

B 的精简变体。LineCommitter 只追踪以 `\n` 结尾的行，spinner 用 `\r` 覆写永远不产生 `\n`，
天然过滤。

**优点**：事件极小；spinner 自动消失；只在有新行时发
**缺点**：手写 LineCommitter 在 ANSI 边缘案例（DCS、OSC 跨 chunk、UTF-8 多字节）易踩坑；
agent 30 秒不发 `\n` 前端无更新

### 方案 C：直接对接 AI Agent 结构化输出（早期想法，演化为 F）

Claude Code CLI 支持 `--output-format stream-json`，以 NDJSON 输出结构化事件。
完全绕开终端渲染。**这条路在后续迭代中演化成方案 F**。

### 方案 D：Gateway 内置 `@xterm/headless`

把 A 的 headless xterm 解析能力上提到 Gateway。
- 用同一套 xterm 解析器（避开 B+ 的手写风险）
- 多端共享一份解析结果（B+ 的优势）
- 浏览器零成本

**新增依赖**：`@xterm/headless`（~150 KB，Node 原生）；每会话约几百 KB 内存

### 方案 E：双轨 D + A 兜底

新会话用 D，旧会话浏览器侧用 A 兜底。两套实际是同一个解析器（都是 xterm），
心理负担小。

### 方案 F：stream-json 结构化事件

把 Claude Code CLI 切到 `--output-format stream-json`，Gateway 收到 NDJSON 事件流：
`assistant.message`、`tool_use`、`tool_result`、`result`（含 cost / usage）等。

simple 视图直接渲染对话气泡 + 可折叠工具卡，**根本不需要终端解析**。

**优点**
- 零终端解析；从根上消灭 ANSI / spinner / cursor 一类 bug
- 语义 UI：工具调用结构化，可折叠 / 显示 token 数 / 错误卡片
- 准的指标：`total_cost_usd` / `usage.input_tokens` 直接拿
- 会话状态机清晰：`result` 事件明确告知"完成"
- 支持 token 级流式（`--include-partial-messages`）

**缺点**
- Agent 锁定：仅对 Claude Code（及兼容协议 agent）有效，其他 CLI 必须回退 PTY
- 失去 `/help` `/model` `/permissions` TUI 菜单交互
- Gateway 复杂度上升：要管 PTY 和 stream-json 两条路径
- Agent 会话**无法切到真 PTY 高级视图**（底层无字节流）
- 旧 PTY 会话和新 stream-json 会话事件结构不同，replay 要兼容

### 方案 G：A + 语义识别（不推荐）

A 之上做 markdown 识别 / tool 调用模式识别。靠正则猜，脆弱。

### 方案 Z：单一数据源 + 前端多渲染器 ⭐ 推荐

为回应"agent 会话也能在不同视图间切换"的需求而提出，是 F 之上的渲染层扩展。
**不引入 Gateway 双写**。详见第 4 节。

---

## 3. Gateway 双写 vs 方案 Z

用户先后提出两条"既要 F 的产品体验、又要保留视图切换"的路径：

### Gateway 双写

Gateway 同时发 `agent.*` 事件 + 合成的 `terminal.output` 字节流，两份都入库。
- 切换：✅
- 存储：❌ 翻倍
- 高级视图内容：⚠️ Gateway 合成，不是真 Claude TUI

### 方案 Z（推荐）

Gateway 只发 `agent.*` 事件，前端三个渲染器各自消费。
- 切换：✅
- 存储：✅ 不翻倍
- 高级视图内容：⚠️ 前端合成（同 Gateway 双写，等价限制）

### 全维度对比

| 维度 | Gateway 双写 | **方案 Z** |
|---|---|---|
| 切换支持 | ✅ | ✅ |
| 存储增量 | ❌ +50%~100% | ✅ 0 |
| 数据一致性 | ⚠️ 两份要同步 | ✅ 单一来源 |
| 历史会话回放 | ⚠️ 老会话没双写过，行为不一致 | ✅ 同一份事件，渲染器现场算 |
| 修改终端样式 | ❌ 改 Gateway 重启 | ✅ 改前端，热更新 |
| 视觉迭代速度 | ❌ 后端工 + 测试 + 部署 | ✅ 前端工，秒看效果 |
| 添加第四视图 | ❌ Gateway 再加格式 | ✅ 加一个 React 组件 |
| Gateway 复杂度 | ❌ 维护两套序列化 | ✅ 透明转发 |
| 增量代码量 | +200 行 Gateway | +250 行前端 |
| 视觉真实度 | ⚠️ 合成 | ⚠️ 合成 |

**所有维度，Z 都不输双写；多数维度更优。**

---

## 4. 推荐方案：F + Z

### 4.1 数据层（F）

Gateway 用 `@anthropic-ai/claude-code` SDK（推荐）或 spawn `claude --output-format stream-json`
启动 agent。子进程吐 NDJSON，Gateway 按事件类型映射成 6 种新 `SessionEvent`：

| 新事件类型 | payload | 用途 |
|---|---|---|
| `agent.message` | `{ role, content[] }` | 一条完整 assistant/user 消息 |
| `agent.delta` | `{ text }` | token 流式增量 |
| `agent.tool_use` | `{ name, input, id }` | 工具调用 |
| `agent.tool_result` | `{ tool_use_id, content, is_error }` | 工具结果 |
| `agent.permission_request` | `{ tool, input }` | 权限确认请求 |
| `agent.result` | `{ cost, usage, duration }` | 一轮对话完成 |

会话 `transport` 字段加 `'stream-json'` 值，与现有 `'pty-event-stream'` 并存。

### 4.2 路由层

```tsx
<Route path="/remote/session/:sessionId" element={<SessionRouter />} />
<Route path="/remote/session/:sessionId/simple" element={<SessionRouter view="chat" />} />
<Route path="/remote/session/:sessionId/events" element={<SessionRouter view="raw" />} />

function SessionRouter({ view }) {
  const session = useSession(sessionId);
  const events = useSessionEventStream(sessionId); // 一份事件，所有视图共用

  const resolved = view ?? (session.transport === 'stream-json' ? 'chat' : 'terminal');

  if (resolved === 'chat') return <ChatRenderer events={events} session={session} />;
  if (resolved === 'terminal') {
    return session.transport === 'pty-event-stream'
      ? <PtyTerminalRenderer events={events} />     // 真 PTY xterm
      : <SyntheticTerminalRenderer events={events} />; // agent 合成 TUI
  }
  return <RawEventRenderer events={events} />;
}
```

### 4.3 渲染层（Z 的核心）

| 渲染器 | URL | 内容 | PTY 会话 | Agent 会话 |
|---|---|---|---|---|
| `ChatRenderer` | `/simple` | 草图 F 样式：可折叠工具卡 / markdown / 气泡 | xterm extractor 兜底 | 直接消费 `agent.*` |
| `PtyTerminalRenderer` | `/` | 真实 xterm 渲染 PTY 字节 | ✅ | ❌ |
| `SyntheticTerminalRenderer` | `/` | 真 xterm 实例 + 合成 ANSI | ❌ | ✅ |
| `RawEventRenderer` | `/events` | NDJSON 日志 | ✅ | ✅ |

顶部 tab 切换：`💬 聊天` / `⌨ 终端` / `📋 事件流`，对所有会话统一展示
（不可用的视图 disabled）。

### 4.4 SyntheticTerminalRenderer 渲染规则

按 Claude Code TUI 视觉风格写"虚拟渲染器"：

```ts
// agent.tool_use → 写 ANSI 装饰的 "● Read(file.ts)"
function renderToolUse(term, e) {
  term.write('\x1b[32m●\x1b[0m '); // 绿圆点
  term.write(`\x1b[1m${e.name}\x1b[0m`); // 工具名加粗
  term.write(`(\x1b[2m${formatArgs(e.input)}\x1b[0m)\r\n`);
}

// agent.tool_result → 缩进的 "  ⎿ Read 142 lines"
function renderToolResult(term, e) {
  term.write(`  \x1b[2m⎿\x1b[0m ${summarize(e.content)}\r\n`);
}

// agent.delta → 实时 write
function renderDelta(term, e) { term.write(e.text); }

// agent.result → 灰色 footer
function renderResult(term, e) {
  term.write(`\r\n\x1b[2m─── ${e.duration}s · $${e.cost} · ${e.tokens.output} tok ───\x1b[0m\r\n`);
}

// spinner → setInterval 80ms + \r 覆写
const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
```

完整可运行 spike 见草图 3（已通过浏览器验证视觉效果）。

---

## 4.5 突破：跨模式 Resume（统一架构）

经实测确认：**Claude 和 Codex 都支持 session_id 跨模式 resume**。这意味着同一会话
可以在 PTY 和 stream-json 两种 backend 之间**切换**，token 不翻倍，agent 知识保留。

### 4.5.1 实测命令

**Claude**：
```bash
# 启动 F 模式（显式 session id）
claude --session-id <uuid> -p --output-format stream-json "..."

# 同 session 切到 TUI（交互式）
claude --resume <uuid>

# 同 session 继续 F
claude --resume <uuid> -p --output-format stream-json "..."
```
存储：`~/.claude/projects/<dir>/<uuid>.jsonl`

**Codex**：
```bash
# 启动 F 模式
codex exec --json "..."          # 输出 {"type":"thread.started","thread_id":"xxx"}

# 同 session 切到 TUI
codex resume <thread_id>

# 同 session 继续 F
codex exec resume <thread_id> --json "..."
```
存储：`~/.codex/sessions/`

### 4.5.2 Tether 内部架构

```
Tether session_id (DB 主键)
        ↓ 映射
agent 真实 session_id (UUID)
        ↓
Tether 按需切换 backend：
  - 移动端打开 → spawn F mode
  - 桌面想要真 TUI → kill F + spawn TUI mode (同 session_id)
  - 回手机 → kill TUI + spawn F again
```

**关键**：不并发跑两个 agent 进程，是按时刻切换。**token 1x**。

### 4.5.3 切换触发策略（决策待办）

- (a) **自动**：按设备类型（移动 = F / 桌面 = TUI），用户无感
- (b) **手动**：UI toggle，用户主动选
- (c) **混合**：默认自动，UI 提供 override

推荐 (c)。

---

## 4.6 统一事件协议（多源汇流）

统一架构后，**PTY 和 F 不是两套世界**，而是同一内部协议的两种数据来源：

```
        数据来源（多种）
   ┌────────┬─────────┬──────────┐
   ↓        ↓         ↓          ↓
PTY 字节  Codex      Claude    未来
(legacy) NDJSON    NDJSON    (MCP/...)
   │        │         │          │
   ↓        ↓         ↓          ↓
 PtyAdapter Codex    Claude     ...
            Adapter  Adapter
   │        │         │          │
   └────────┼─────────┴──────────┘
            ↓
   统一内部事件 agent.*
   (入库存储这一份)
            ↓
   统一渲染层
   ChatRenderer / SyntheticRenderer / RawEventRenderer
            ↓
        三 tab 切换
   💬 聊天 / ⌨ 终端 / 📋 事件流
```

### 4.6.1 统一事件 schema

```ts
type AgentEvent =
  | { type: 'session.started'; sessionId: string; agent: 'claude' | 'codex' }
  | { type: 'mode.switched';   to: 'pty' | 'stream-json' }
  | { type: 'agent.message';   role: 'user' | 'assistant'; text: string }
  | { type: 'agent.reasoning'; text: string }                          // codex 特有
  | { type: 'agent.tool_use';  id: string; name: string; input: object }
  | { type: 'agent.tool_result'; toolUseId: string; content: string; isError?: boolean; exitCode?: number }
  | { type: 'agent.turn_completed'; usage: { input: number; output: number; cached: number; reasoning?: number; cost?: number } }
```

### 4.6.2 多 agent 在统一渲染层下表现

| 会话类型 | 💬 聊天 view | ⌨ 终端 view | 📋 事件流 view |
|---|---|---|---|
| **PTY** (legacy + 主动选 PTY) | PtyAdapter 半桥派生 → cards (尽力而为) | xterm 渲染 PTY 字节（**真 Claude/Codex TUI**） | terminal.output 字节 |
| **F** (新建 stream-json) | adapter → cards (**100% 准确**) | events → 合成 ANSI → xterm (草图 Z) | agent.* NDJSON |

每个会话的两个视图都可用，跨模式段标"近似"水印。

---

## 4.7 Replay 策略：单一数据源 + 读时按需合成

跨模式切换后，同一会话事件混存：

```
T1-T5    terminal.output (PTY 段)
T6       mode.switched
T7-T15   agent.message / agent.tool_use (F 段)
T16      mode.switched
T17-T20  terminal.output
```

### 4.7.1 已否决的策略

| 策略 | 否决理由 |
|---|---|
| 粗暴跨视图渲染 | 用户分不清"原版"和"近似"，体验混乱 |
| Mode-aware 占位 | 视图割裂，用户不爽 |
| 切换瞬间转换并落库 | 存储翻倍 + 转换后变事实，原版变冗余 |
| Gateway 持续双写 | 存储翻倍 + 半桥垃圾污染 DB |

### 4.7.2 推荐策略：单一数据源 + 读时按需合成

**只存 native 事件**（不双写、不预转换）。**用户打开视图时实时合成跨模式段**：

```
存储 (single source of truth):
  T1-T5   terminal.output
  T6      mode.switched
  T7-T15  agent.message
  T16     mode.switched
  T17-T20 terminal.output

读取 chat 视图:
  T1-T5   → halfBridge.parse(bytes) → 派生 agent.*  (现场算，不入库)
  T6      → 渲染分隔条 "── 切换到聊天模式 ──"
  T7-T15  → 直接 ChatRenderer (原版完美)
  T16     → 分隔条
  T17-T20 → 半桥派生

读取 terminal 视图:
  T1-T5   → xterm.write(bytes) (原版完美)
  T6      → 分隔条
  T7-T15  → SyntheticRenderer.synthesize(events) → ANSI → xterm  (现场算)
  T16     → 分隔条
  T17-T20 → xterm.write 原版
```

**优点**：
- ✅ 存储 1x（不翻倍）
- ✅ 原版段永远完美
- ✅ 跨模式段是 best-effort 合成（CPU 时间换质量）
- ✅ 半桥垃圾**不污染** DB（只在内存里临时合成）
- ✅ 算法可独立改进——半桥升级 → 老会话立刻受益，不需要数据迁移

### 4.7.3 已知边界

| 边界 | 处理 |
|---|---|
| 用户在工具调用中途切换模式 | 等当前工具完成再切，UI "切换排队中" |
| 多设备同时打开同会话 | Tether 强制单一活跃模式；后到设备看当前模式 |
| Tether 重启 / 崩溃恢复 | 默认恢复为 F 模式（cheaper to spawn） |
| 用户切换太频繁 | rate-limit 切换（每 N 秒最多一次） |
| 跨模式段太长（如 2 小时 PTY） | chat 视图分页/虚拟滚动避免一次性合成全部 |

### 4.7.4 跨模式段的 chat 视图呈现（决策待办）

- (a) 半桥渲染 + "近似"水印（推荐：至少能看到内容）
- (b) 折叠占位 ("这段在终端模式，点击切到终端视图查看")
- (c) 用户配置（默认 a，不喜欢可切 b）

推荐 (a)：用户出门看手机时不能让 ta 为看历史而切回终端。

---

## 4.8 Adapter 实测验证（已完成）

### 4.8.1 真实捕获的事件 schema

**Codex `codex exec --json` 输出**（已实跑）：
```json
{"type":"thread.started","thread_id":"019df3d8-..."}
{"type":"turn.started"}
{"type":"item.started","item":{"type":"command_execution","command":"...","status":"in_progress"}}
{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"...","exit_code":0}}
{"type":"item.completed","item":{"type":"agent_message","text":"..."}}
{"type":"item.completed","item":{"type":"reasoning","text":"..."}}    # 思考链，意外亮点
{"type":"turn.completed","usage":{"input_tokens":...}}
```

**Claude `claude --output-format stream-json`**（schema 已知，未实跑大样本）：
```json
{"type":"system","subtype":"init","session_id":"...","tools":[...]}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"...","name":"...","input":{...}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
{"type":"result","subtype":"success","total_cost_usd":0.012,"usage":{...}}
```

### 4.8.2 双 adapter 已通过 spike 验证

`docs/working/2026-05-04-stream-json-playback.html` 端到端验证：
- 4 个真实/合成样本（codex hello / readme / 多工具 / claude 合成）
- Codex adapter + Claude adapter 各 ~50 行 JS
- 通过同一 ChatRenderer 渲染（草图 F 样式）
- 实跑通过：thread/turn/item/reasoning/result 全部正确翻译

**这就是 Gateway adapter 的核心代码**，约 100 行，剩下都是 plumbing。

---

## 5. 对现有控制台的影响

F + Z 是**纯加法**：

| 现有功能 | F+Z 后 |
|---|---|
| `/remote/session/:sessionId` 高级终端视图 | ✅ PTY 会话不变 |
| `/remote/session/:sessionId/simple` 现有简洁视图 | ✅ PTY 会话不变（继续 A 路径） |
| 现有 PTY 会话 | ✅ 完全不变 |
| `apps/gateway/src/pty.ts` (PtySessionManager) | ✅ 不动一行 |
| `terminal.output` / `user.input` 事件 | ✅ 类型保留 |
| Relay 转发 | ✅ 透传任意类型 |
| 事件 SQLite 存储 | ✅ schema 不变，只多几种 type 字符串 |
| Replay API | ✅ 通用查询，对新类型透明 |
| 历史 PTY 会话 | ✅ 完全保留 |
| Session 列表 | ⚠️ 卡片按 transport 显示不同图标（极低成本） |
| Session 创建入口 | ⚠️ 多一个"模式"选项（终端 / AI 对话） |

**API 向后兼容**：旧客户端不传 `mode` → 默认 `'pty'` → 行为完全和今天一样。

**回滚成本**：分钟级，不需要数据迁移。

---

## 6. 工作量估算

### 6.1 完整 F + Z + 跨模式 Resume + Replay 引擎

| 阶段 | 工时 |
|---|---|
| Gateway: agent-runner（Codex + Claude 双 adapter） | 1.5 天 |
| Gateway: 本机用 CLI 真实跑通两家 stream-json | 0.5 天 |
| Gateway: 维护 Tether session_id ↔ agent session_id 映射 | 0.2 天 |
| Gateway: 模式切换状态机（spawn/kill/优雅退出） | 0.5 天 |
| Gateway: 启动子进程时识别"新建 vs resume" | 0.3 天 |
| Web: ChatRenderer 组件（草图 F） | 1 天 |
| Web: SyntheticTerminalRenderer 组件（草图 Z） | 0.5 天 |
| Web: RawEventRenderer + 路由分流 + i18n | 0.5 天 |
| Web: Replay 引擎（按事件类型分发，跨模式合成） | 0.5 天 |
| Web: 半桥模块（PTY → agent.* 派生器） | 0.3 天 |
| Web: 模式分隔条 UI + "近似"水印样式 | 0.3 天 |
| Web: 模式切换触发 UI（设备自动 + 手动 toggle） | 0.3 天 |
| 联调 + Relay 验证 + 三端切换测试 | 0.5 天 |
| **合计** | **~7 天** |

### 6.2 MVP 砍刀位（压到 3 天）

1. 第一版只支持 `acceptEdits` 模式，砍掉权限确认 UI（-0.3 天）
2. 不做增量 markdown，等 message 完整后一次渲染（-0.3 天）
3. 不做创建会话的模式选择 UI，加 env flag 强制 agent 模式（-0.3 天）
4. 不做 cost/usage 统计条（-0.2 天）
5. 不做 SyntheticTerminalRenderer，agent 会话只有 ChatRenderer（-0.5 天）
6. 不做跨模式 Resume，agent 会话和 PTY 会话各跑各的（-1.8 天）
7. Replay 引擎只做 native，跨模式段不渲染只显示占位（-0.6 天）

砍完剩 **~3 天 MVP**，但失去"无缝切换"卖点。

### 6.3 已知风险点

| 风险 | 应对 |
|---|---|
| stream-json 是一次性调用，多轮对话需要 `--resume` 或用 SDK | 直接用 `@anthropic-ai/claude-code` SDK，由 SDK 管会话连续性 |
| 跨平台：Windows 要走 `claude.cmd` | 第一版只支持 macOS/Linux |
| 流式 markdown 性能：每条 delta 重渲染会卡 | `marked` + 16ms 节流 |
| 长 tool_result 渲染卡 | `max-height: 180px` + 滚动 |
| 进程清理：child 崩溃 / Gateway 退出 | SIGTERM 所有 child + 标记 session exited |
| stdin 写入 EPIPE | 静默忽略（child 已退出） |

---

## 7. 设计决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据层 | stream-json (F)，不用 PTY 解析 | 从根上消除 ANSI 解析 bug；获得结构化语义 |
| Agent 进程接入 | spawn CLI 直接调用（`codex exec --json` / `claude --output-format stream-json`） | CLI 已支持完整结构化输出 + session_id 跨模式 resume |
| 多视图实现 | 前端多渲染器 (Z)，不 Gateway 双写 | 存储不翻倍；视觉迭代快；Gateway 保持透明 |
| Agent 会话的"高级视图" | 前端合成 TUI（草图 Z） | 真 Claude TUI 不可能同时获得（不 Gateway 双写就无法） |
| 跨模式切换 | 同 Tether session_id，按需 spawn/kill 切换 backend | 实测 Claude/Codex 都支持 session_id 跨模式 resume；token 1x；agent 知识保留 |
| Replay 数据存储 | 单一数据源（只存 native），不预转换、不双写 | 半桥垃圾不污染 DB；算法可独立改进 |
| Replay 跨模式段 | 读时按需合成（chat 视图半桥派生 / terminal 视图合成 ANSI） | 用户哪种视图都能看到内容，质量差异通过"近似"水印明示 |
| 视图切换粒度 | URL 路由切换（不重连事件流） | hook 上层共享，切换 = 切组件 |
| 默认视图 | PTY 会话默认 `/`（终端）；Agent 会话默认 `/simple`（聊天） | 各自最自然的呈现 |
| 默认 backend | 移动端 = F / 桌面 = TUI（自动），UI 提供 manual toggle | 各自最佳体验，user override 兜底 |
| 事件流视图（debug） | 三视图统一保留，不做成 Drawer | 心智一致，开发者也是用户 |

---

## 8. 草图参考

同目录下四份独立 HTML 草图（双击浏览器打开，自适应主题）：

| 草图 | 文件 | 内容 |
|---|---|---|
| **A 方案现状** | `2026-05-04-simple-chat-mockup-xterm-parsed.html` | 当前实现的真实呈现：单个 `<pre>` 等宽文本，工具调用为 `● Read(…)` 文本行，无 markdown / cost / 卡片 |
| **F 方案目标** | `2026-05-04-simple-chat-mockup-stream-json.html` | stream-json 升级后的形态：可折叠工具卡 / markdown / 流式光标 / 权限按钮 / cost 统计条 |
| **Z 方案 spike** | `2026-05-04-simple-chat-mockup-synthetic-terminal.html` | 真 xterm.js + 三 tab 可切换：聊天 / 合成终端 / 事件流；同一事件流分发给三个渲染器，可播放回放 |
| **PTY 渲染对比 A/B/C** | `2026-05-04-terminal-renderer-comparison.html` | 高级控制台 RAW vs 美化 vs 语义化 vs 配置差异 四面板对比；支持加载本机真实 PTY 抓取 (.bin) 文件 |
| **半桥实测（含真实 Claude 数据）** | `2026-05-04-half-bridge-real-claude.html` | 三栏调试视图：xterm 抽行 / 正则识别 / 草图 F 渲染。**实测结论：半桥不可行**——TUI 状态栏 / 占位提示混入识别结果 |
| **Stream-JSON 端到端回放** ⭐ | `2026-05-04-stream-json-playback.html` | F 模式真实数据回放（Codex hello / readme / 多工具 + Claude 合成）；左栏原始 NDJSON / 右栏草图 F 渲染；**这就是 F MVP 的渲染端代码**（约 250 行 JS） |

前三份共用同一段对话内容（"列出 apps/web 的路由"），便于横向对照。

## 9. PTY 数据抓取工具

`scripts/dump-pty.py` — 从本机 SQLite (`~/.tether/tether.db`) 直读 PTY 字节流。
**关键**：必须用 Python 而非 sqlite3 CLI，因为 CLI 会把 `0x1b` ESC 渲染成字面 `^[`
两个字符，破坏字节流。

```bash
# 列出最近会话（可按 provider 过滤）
scripts/dump-pty.py list
scripts/dump-pty.py list --provider claude --limit 30

# 抓 PTY 字节到文件
scripts/dump-pty.py dump tth_20260504_xxxxxx -o capture.bin

# 分析 ANSI 模式 + B 模式适用性判定
scripts/dump-pty.py analyze tth_20260504_xxxxxx

# 自定义 DB 路径
TETHER_DB=/path/to/db scripts/dump-pty.py list
```

`analyze` 命令会自动判定 agent 类型适不适用 B 语义化：
- 找到 `●` + `⎿` → "Claude Code 风格，正则识别可行"
- 只找到框线字符 → "Codex / 纯 TUI，需要完整 xterm 渲染"

样本目录 `docs/working/pty-samples/` 已抓取三份代表性样本：
- `claude-recent.bin` (30 KB) — Claude Opus 4.7 会话，含 `●` `⎿` 工具标记
- `codex-recent.bin` (33 KB) — Codex gpt-5.2 短会话
- `codex-large.bin` (976 KB) — Codex 长会话，4451 个 terminal.output 事件

## 10. Agent TUI 模型差异（调研结论）

通过 `analyze` 命令实测三个会话得到关键发现：

| Agent | 渲染方式 | 关键 ANSI | 语义标记 | B 模式可行性 |
|---|---|---|---|---|
| Claude Code | 行级文本 + 颜色 | `\x1b[1B/1C/6A` cursor 微调，`\x1b[2K` 清行 | ✅ `●` `⎿` `❯` `✻` `⏵` 都有 | ✅ 正则识别工具卡 |
| Codex | 完整 TUI 网格重绘 | `\x1b[H` 大量绝对定位，`\x1b[48;2;...m` 真彩背景 | ❌ 几乎无（976KB 样本只有 1 个游离 `└`） | ❌ 需完整 xterm 跑后读 buffer cell |

**对方案 B 的影响**：B 的"识别 ●⎿ 模式"只对 Claude 有效。Codex 必须走"清洁文本"
回退路径（即方案 A 的复用）。Profile 系统的 `parseStrategy` 字段需要支持
`'line-pattern' | 'tui-buffer'` 两种策略。

---

## 11. 落地下一步

按依赖顺序排列：

### 11.1 Gateway 层

1. **新增事件类型**：`store.ts` 加 `agent.message` `agent.reasoning` `agent.tool_use`
   `agent.tool_result` `agent.turn_completed` `mode.switched` 6 种 + `transport: 'stream-json'`
   - 文件：`apps/gateway/src/store.ts`
   - 估时：0.5 小时

2. **Codex agent-runner**：spawn `codex exec --json`（或 `resume`）+ stdout NDJSON 解析
   + adapter 翻译 → agent.* 事件
   - 文件：`apps/gateway/src/agent-runner/codex.ts`（新）
   - 估时：1 天

3. **Claude agent-runner**：同上，spawn `claude --output-format stream-json`
   - 文件：`apps/gateway/src/agent-runner/claude.ts`（新）
   - 估时：0.5 天

4. **跨模式 Resume 控制器**：维护 Tether session_id ↔ agent session_id 映射；
   按需 spawn/kill 切换 backend；处理优雅退出 + 错误恢复
   - 文件：`apps/gateway/src/agent-runner/mode-switcher.ts`（新）
   - 估时：1 天

5. **创建会话路由分流**：`POST /api/sessions` 接受 `mode: 'pty' | 'agent'`，
   按 mode 路由到 PtySessionManager 或 AgentSessionManager
   - 估时：0.3 天

### 11.2 Web 层

6. **统一 SessionRouter**：按 `session.transport` + 当前 view 选渲染器
   - 文件：`apps/web/src/routes.tsx`、`session-detail-page.tsx`
   - 估时：0.5 天

7. **ChatRenderer**：把 stream-json playback 页面的渲染逻辑翻译成 React 组件
   - 文件：`apps/web/src/components/session/agent-chat-surface.tsx`（新）
   - 估时：1 天

8. **SyntheticTerminalRenderer**：把草图 3 的 spike 翻译成 React 组件
   - 文件：`apps/web/src/components/session/synthetic-terminal-renderer.tsx`（新）
   - 估时：0.5 天

9. **RawEventRenderer**：NDJSON drawer
   - 文件：`apps/web/src/components/session/raw-event-renderer.tsx`（新）
   - 估时：0.3 天

10. **Replay 引擎**：扫描混合事件流，按事件类型分发；遇到跨模式段调半桥/合成器
    - 文件：`apps/web/src/lib/session-replay.ts`（新）
    - 估时：0.5 天

11. **半桥模块**（PTY → agent.* 派生器）：从 chat-session-surface.tsx 提取
    - 文件：`apps/web/src/lib/pty-half-bridge.ts`（新）
    - 估时：0.3 天

12. **模式切换 UI**：顶部 toggle + 设备自动判定 + 切换状态机 UI
    - 估时：0.3 天

13. **i18n + 样式**：模式分隔条 / "近似"水印 / 模式标签 等
    - 估时：0.3 天

### 11.3 联调验证

14. **回放 + Relay 联调**：验证 agent 会话历史能正确回放，跨模式段合成正确，
    Relay 能透传新事件类型
    - 估时：0.5 天

15. **三端切换 e2e**：同一会话从浏览器→手机→`tether view` CLI（如果做）
    切换体验顺畅
    - 估时：0.3 天

---

## 12. 决策待办

### 12.1 架构方向（必须先定）

- [ ] **走 F + Z + 跨模式 Resume 完整路径**（推荐，~7 天）
- [ ] **走 MVP 砍刀位**（保留 F + Z 但不做跨模式 Resume，~3 天）
- [ ] **不动**：保留 A 现状 + PTY，手机体验止步现有水平

### 12.2 实施细节

- [ ] **Codex 工具调用 schema 实测验证**（消耗约 30K token，但能锁定 adapter）
- [ ] **跨模式段在 chat 视图的呈现**：(a) 半桥+水印（推荐） / (b) 折叠占位 / (c) 用户配置
- [ ] **默认 backend 触发策略**：(a) 设备自动 / (b) 手动 toggle / (c) 混合（推荐）
- [ ] **`docs/working/pty-samples/*.bin` 是否 git commit**：约 1MB，作为标准回归测试集
- [ ] **Windows 支持时机**（推荐：第二版）
- [ ] **`tether view` CLI 客户端**：本期做 / 下期做 / 不做（推荐：下期）
