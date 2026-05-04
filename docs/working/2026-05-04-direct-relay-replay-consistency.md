# Direct / Relay 回放一致性记录

本文记录 Web session 页面里 `回放: 最近 / 全部` 在 Direct 和 Relay 两条链路下的实现差异、
本次问题根因、当前修复规则和后续处理原则。

## 背景

Web session 页面虽然共用同一个终端视图，但 Direct 和 Relay 的历史回放入口不是同一段代码。

Direct 链路：

```text
Web -> Gateway HTTP /api/sessions/:id/events -> SQLite session_events
Web -> Gateway WebSocket stream -> live events
```

Relay 链路：

```text
Web -> Relay client.subscribe -> Gateway relay-client -> SQLite session_events
Gateway relay-client -> Relay gateway.replay -> Web event / replay.done
```

因此 UI 上同一个 `全部` 选项，背后对应两套 transport 实现。

## 这次问题

Direct 的 `全部` 回放由 Web 前端自己循环分页：

- 每次最多拉 5000 条。
- 用最后一个 event id 继续请求下一页。
- 直到返回不足 5000 条才停止。

所以 Direct 能拿到完整历史。

Relay 下浏览器不能直接分页查 Gateway，只能发一次 `client.subscribe`。完整性取决于
Gateway relay-client。旧实现只执行一次：

```text
listEvents(sessionId, after, 5000)
```

随后 live 订阅又从：

```text
latestEventId(sessionId)
```

开始，导致超过 5000 条时：

- 1 到 5000 被 replay。
- 5001 到最新事件之间被跳过。
- 最新事件之后的新 live output 才继续推送。

## 当前修复规则

- Gateway relay-client 对全量 replay 必须按 cursor 分页，页大小仍是 5000。
- 分页 replay 过程中，前面页发送 `gateway.replay` 时标记 `done: false`。
- Relay 收到 `done: false` 只转发事件，不给 Web 发 `replay.done`。
- 最后一页发送 `done: true`，Relay 才发 `replay.done`。
- runner live 订阅 cursor 使用 replay 到的最后 event id，不能直接跳到
  `latestEventId(sessionId)`。

## 后续处理原则

- 改回放语义时，必须同时核对 Direct HTTP replay、Direct WS stream、Relay subscribe replay。
- 不能只修 `session-surface.tsx` 就认为 Relay 同步生效；Relay 还有 Gateway relay-client 和
  Relay server 两层。
- 所有 replay limit、cursor、`replay.done`、live subscribe cursor 的改动，都必须同时补
  Direct 和 Relay 测试。
- 如果以后引入 snapshot / transcript 优化，也要明确 Direct 和 Relay 的降级语义一致。

## 推荐体验方案

### 短期方案：完整历史快速恢复 + live

控制台进入页的目标是尽快接管当前 session，不应该按真实时间等待历史回放。短期推荐：

```text
完整历史按 event.id 顺序快速写入 xterm
-> 从最后 event id 接 live stream
-> replay 完成后开启输入
```

关键规则：

- 不跳过历史，不只取最近 100 条。
- 不按原始 `event.ts` 时间间隔等待。
- 保留 event 顺序，按 `event.id` 升序写入。
- replay 前先同步 terminal size，减少布局错位。
- replay 期间禁止输入，避免新输入插到历史事件中间。
- replay 完成后，从最后 event id 继续接 live，避免重复或漏事件。
- 对超长历史做分批写入，例如每批 200 条或每帧最多写入 8ms，避免浏览器假死。
- UI 可显示恢复进度，例如“正在恢复 12000 条事件”，但不应阻塞到像真实时间回放一样慢。

控制台默认应使用“即时顺序恢复 + live”。回放页可以提供速度选择：

- `即时`
- `5x`
- `2x`
- `1x`

其中 `1x` 才按原始节奏播放；默认推荐 `5x` 或 `即时`，不要默认真实时间。

### 中期方案：terminal checkpoint + live

如果历史事件很长，每次从第 1 条事件快速重放仍可能慢。中期再做真正的 terminal checkpoint：

```text
加载最近 checkpoint
-> 从 checkpoint.eventId 后继续 replay
-> 接 live stream
```

terminal checkpoint 是终端模拟器状态的“可恢复存档点”。它不是最近 100 条事件，也不是
普通文本日志，而是把某个 event id 时刻的终端状态保存下来。普通事件 replay 是从第 1 条
输出重新播放到当前；checkpoint replay 是先恢复最近 checkpoint，再只播放 checkpoint
之后的新事件。

示例：

```text
event 1      输出欢迎信息
event 2      清屏
event 3      打开 TUI
...
event 7500   checkpoint
event 8000   当前 prompt
```

下次打开页面时，不需要从 `event 1` 重放到 `event 8000`，而是：

```text
加载 checkpoint 7500 的终端状态
-> replay event 7501 到 event 8000
-> 接 live stream
```

checkpoint 不能只是纯文本，至少需要记录：

- `sessionId`
- `eventId`
- `cols` / `rows`
- 当前屏幕 buffer。
- scrollback buffer。
- 光标位置。
- ANSI 颜色、bold、underline 等样式。
- 是否在 alternate screen。
- 当前 active line 状态。
- `createdAt`

只有这样才能既快又尽量保持 ANSI 样式、光标位置、alternate screen 和 TUI 布局状态。

### 不推荐方案：纯文本 snapshot 当终端真相

纯文本 snapshot 只能解决“看见内容”，不能可靠恢复终端状态。它会丢：

- ANSI 颜色和样式。
- 光标位置。
- alternate screen。
- TUI 布局状态。
- resize 对画面的影响。

所以当前阶段不要把纯文本 snapshot 作为控制台恢复真相。它最多只能作为 transcript /
只读 fallback，不能替代 xterm event replay。
