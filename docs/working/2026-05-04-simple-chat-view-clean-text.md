# 简洁聊天视图 — 干净文本提取方案

**背景**：`/remote/session/:sessionId/simple` 是基于微信聊天风格的 AI 对话视图。
Agent 的消息气泡需要展示可读的纯文本，不能出现 ANSI 转义序列或 spinner 帧。

---

## 根本原因

Gateway 只传输原始 PTY 字节流（`terminal.output` 事件），包含：

- ANSI 颜色/光标序列（CSI、OSC、DCS 等）
- Terminal 握手响应（`\x1b[42;1R`、`\x1b[?62;22;52c` 等）
- OSC 窗口标题更新（`\x1b]0;window-title\x07`）
- Spinner 动画帧（用 `\r` 覆写同一行）

要还原成"屏幕上可见的干净文字"，必须经过完整的终端状态机。

---

## 消息分割点

`user.input` 事件是天然的消息边界：每次用户发送输入，`user.input` 事件
触发一次"提交"——之前积累的 agent 输出 = 一条 agent 气泡，用户文字 = 一条
用户气泡。

Composer 会先发文字再发 `\r`（间隔 ~40ms），处理逻辑：收到 `\r` 时立即提交；
否则等待 1 秒超时兜底。

---

## 方案对比

### 方案 A：浏览器侧 xterm 无头解析

在 `chat-session-surface.tsx` 中创建不挂载 DOM 的 xterm Terminal 实例，
仅用作解析器。所有 `terminal.output` 事件写入该实例，触发 `user.input` 时
读取 `term.buffer.active` 获得干净文本。

**优点**
- 不需要改动 gateway
- `@xterm/xterm` 已是项目依赖
- 处理所有终端序列最准确（xterm 本身就是终端状态机）

**缺点**
- `term.write()` 是异步的，commit 时需要用 Promise 队列等待写入完成
- chat-session-surface 引入 xterm（虽然不渲染，但语义上有点奇怪）

**改动文件**：`apps/web/src/components/session/chat-session-surface.tsx`

---

### 方案 B：Gateway 新增 `terminal.text` 事件（全屏快照）

Gateway 在 `flushOutput` 时，通过 TerminalGrid 状态机处理原始字节，
随 `terminal.output` 一起发出 `terminal.text` 事件，payload 为当前屏幕
干净文本快照。

**优点**
- 前端逻辑极简：直接用 `terminal.text` 的文本内容
- 对控制/回放页面无影响（忽略未知事件类型）
- 直连和 Relay 均自动透传（无需改 relay）

**缺点**
- 每次 flush 多一个事件，存储量约增加 30–50%
- 旧会话回放没有 `terminal.text` 历史，需要兜底逻辑
- TerminalGrid 需要实现约 80 行代码

**改动文件**
- `apps/gateway/src/store.ts`：`SessionEventType` 加 `'terminal.text'`
- `apps/gateway/src/pty.ts`：新增 `TerminalGrid` 类 + `flushOutput` 发出事件
- `apps/web/src/components/session/chat-session-surface.tsx`：监听 `terminal.text`

---

### 方案 B+（推荐）：Gateway 只发「已提交行」

TerminalGrid 的精简变体。只追踪以 `\n` 结尾的"已提交行"，spinner 用 `\r`
覆写永远不会产生 `\n`，因此天然被过滤掉。

```typescript
class LineCommitter {
  private current = '';
  private committed: string[] = [];
  private lastDrained = 0;

  push(data: string): void {
    // strip ANSI → 遇 \r 清 current → 遇 \n 提交 current → 遇可见字符追加
  }

  drain(): string[] {
    const newLines = this.committed.slice(this.lastDrained);
    this.lastDrained = this.committed.length;
    return newLines;
  }

  reset(): void { this.committed = []; this.current = ''; this.lastDrained = 0; }
}
```

`flushOutput` 调用 `drain()`，有新行才发 `terminal.text { lines: string[] }`，
无新行不发事件。

**优点**
- Spinner 自动不出现（\r 覆写永远不提交）
- 事件极小（只含新行，几十字节）
- 实现简单（100 行以内）
- 无存储浪费（仅在有新内容时才发）

**缺点**
- Agent 工作时如果 30 秒内不产生 `\n`，前端没有内容更新
  → **缓解**：前端检测到 `terminal.output` 活跃时显示通用 "working…" 动画

**改动文件**（同方案 B，共 3 个文件）

---

### 方案 C：直接对接 AI Agent 结构化输出（长期）

Claude Code CLI 支持 `--output-format stream-json`，以 NDJSON 输出结构化事件
（assistant message、tool_use、result 等），完全绕开终端渲染。

**优点**：最干净，无需任何终端解析  
**缺点**：需要改 gateway 启动 agent 的方式，且仅适用于支持结构化输出的 agent

---

## 链路隔离

高级模式（xterm）与简洁模式（clean text）可完全隔离：

| | 高级/回放模式 | 简洁模式 |
|---|---|---|
| 订阅参数 | `surface=terminal` | `surface=chat` |
| 接收事件 | `terminal.output` | `terminal.text` |
| 实时流 | xterm 渲染 | 干净文本气泡 |
| 回放 | 现有逻辑 | chat-replay API / 浏览器侧降级 |
| 存储 | 不变 | 不增加（`terminal.text` 按需产出，不入库） |

直连和 Relay 两种连接模式下行为一致，Relay 自动透传所有事件类型。

---

## 当前状态（2026-05-04）

- 简洁视图路由 `/remote/session/:sessionId/simple` 已上线
- 前端 `chat-session-surface.tsx` 已实现，使用 `LineBuffer` + 改良 ANSI 正则
- 仍有乱码问题：ANSI 正则无法覆盖全部终端序列，spinner 残留
- **待决策**：选择方案 A、B+ 或 C 实施
