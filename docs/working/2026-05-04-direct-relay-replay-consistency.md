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

## 行动项和验证状态

### 已完成

- [x] Relay `全部` 回放超过 5000 条时改为 Gateway relay-client 分页 replay。
- [x] Relay `gateway.replay` 支持 `done:false` / `done:true`，Relay 只在最后一页发
  `replay.done`。
- [x] Relay live 订阅 cursor 使用 replay 到的最后 event id，避免 5001 到 latest 之间被跳过。
- [x] Web Relay subscribe 在 replay 前携带 `cols` / `rows`，Gateway relay-client 先 resize
  再 replay，减少终端布局错位。
- [x] Relay 页面 stop 竞态已修复：`client.subscribe(control)` 后立即 `client.stop` 不再因为
  subscribe 尚未完成而被判定 `not_subscribed`。
- [x] 缺失 runner socket 时，Relay subscribe 不再打崩 Gateway；session 会标记 `lost` 并返回
  `session_lost`。
- [x] CLI attach 收尾语义已调整：`Ctrl-C` 停止 session，`Ctrl-A` 只 detach。
- [x] CLI attach 被页面 stop / 其他 stop / provider 自己退出触发 `session.exited` 时，会恢复
  本机终端并打印明确收尾状态。

### 已验证

- [x] `pnpm --filter @tether/gateway test`
- [x] `pnpm --filter @tether/gateway typecheck`
- [x] `pnpm --filter @tether/relay exec tsx --test src/relay.test.ts`
- [x] `pnpm --filter @tether/relay typecheck`
- [x] `pnpm --filter @tether/protocol typecheck`
- [x] `pnpm --filter @tether/web typecheck`
- [x] `pnpm --filter @tether/cli test`
- [x] `pnpm --filter @tether/cli typecheck`
- [x] `pnpm typecheck`

### 本期范围

- [ ] 控制页面进入后必须马上初始化并显示 terminal surface，不等待完整历史拉取完成。
- [ ] 控制页面历史恢复采用“即时顺序恢复 + live”：历史按 `event.id` 顺序快速写入，不按真实
  时间间隔播放。
- [ ] Web 端对历史 replay 做分批 flush，避免长历史导致浏览器假死。
- [ ] 收到 `replay.done` 后，必须等本地 replay 队列 flush 完，再开启输入和直接写入 live。
- [ ] Direct 和 Relay 都走 Gateway-owned subscribe / replay / live 语义，控制页面体验保持一致。

### 待做

- [ ] 抽 Gateway `replaySessionEvents()` 共享 helper，统一 `recent/all`、分页、`done` 和最后
  cursor 计算。
- [ ] Gateway relay-client 改为调用共享 helper，删除本地重复 replay 循环。
- [ ] Direct WS `/api/sessions/:id/stream` 改为调用共享 helper，从单页 replay 升级为分页 replay。
- [ ] 明确 Direct WS replay frame 语义：多页 replay 期间继续发送 `event`，只在最后发送
  `replay.done`，并保证 `latestEventId` 是最后 replay cursor。
- [ ] Web Direct 主路径移除 HTTP `/events` 全量 replay，改为只打开 WS 并消费 `event` /
  `replay.done`。
- [ ] HTTP `/events` 降级为调试、fallback 或 transcript 类读取接口，不再承载 Direct 主回放规则。
- [ ] 补 Direct / Relay 行为一致性测试：`all` 超过 5000 条、`recent`、live cursor、
  `session_lost`、resize before replay。
- [ ] 补 replay 过程中断测试：Web 切换 session / 切换 replay mode / WS 断开重连时，旧 replay
  不应继续写入新 terminal。
- [ ] 补输入边界测试：replay 完成前控制端输入不发送；`replay.done` 后才允许 input / resize
  正常进入 live 控制路径。
- [ ] 实现控制台“完整历史快速恢复 + live”的分批写入，避免超长历史 replay 卡住浏览器。
- [ ] 为长历史 replay 增加最小进度状态，例如已恢复事件数或“正在恢复历史”，避免页面看起来卡住。
- [ ] 回放页补速度选项：`即时`、`5x`、`2x`、`1x`，默认不要真实时间。
- [ ] 中期评估 terminal checkpoint，不使用纯文本 snapshot 作为终端真相。
- [ ] 浏览器人工验收 Direct / Relay 两条链路：进入控制台、进入回放页、切换 `最近/全部`、页面停止、
  CLI attach 被页面 stop 后明确收尾。
- [ ] 实现完成后同步 `docs/current/deploy-and-start.md`，删除“当前 Direct 仍由 Web HTTP
  `/events` 主回放”的临时口径。

### 待验证

- [ ] Gateway helper 单元验证：`all` 模式超过 5000 条时发多页，最后一页才 `done:true`，
  返回最后 replay cursor。
- [ ] Gateway helper 单元验证：`recent` 模式只 replay tail 事件，但 live cursor 从当前
  latest event id 开始，不重复旧事件。
- [ ] Direct WS 验证：`/api/sessions/:id/stream?after=0` 能完整 replay 超过 5000 条历史，
  不再只发第一页。
- [ ] Direct WS 验证：`tail=100` 仍只回放最近事件，并在 `replay.done` 后接 live。
- [ ] Direct WS 验证：runner socket 缺失 / session lost 时返回 `session_lost`，Gateway 不崩。
- [ ] Relay 验证：Relay `client.subscribe` 继续支持多页 `gateway.replay`，且只在最后一页后
  向 Web 发 `replay.done`。
- [ ] Relay 验证：`client.subscribe` 后立即 `client.stop` 仍能停到底层 runner。
- [ ] Web Direct 验证：Direct 模式不再依赖 HTTP `/events` 做主回放，进入控制台和回放页都走
  WS `event` / `replay.done`。
- [ ] Web Relay 验证：Relay 模式进入控制台和回放页行为与 Direct 一致。
- [ ] Web 输入边界验证：`replay.done` 前键盘输入不会发送；`replay.done` 后输入正常发送。
- [ ] Web 中断验证：切换 session、切换 replay mode、页面卸载或 WS 重连时，旧 replay 不会继续
  写入新 terminal。
- [ ] 长历史体验验证：超过 5000 / 10000 条事件时浏览器不假死，并显示恢复中状态。
- [ ] CLI 收尾验证：页面 stop 后，本机 CLI attach 收到 `session.exited` 并打印
  `Session 已停止：<id>`。
- [ ] 回归命令：`pnpm --filter @tether/gateway test`
- [ ] 回归命令：`pnpm --filter @tether/relay exec tsx --test src/relay.test.ts`
- [ ] 回归命令：`pnpm --filter @tether/web typecheck`
- [ ] 回归命令：`pnpm --filter @tether/cli test`
- [ ] 回归命令：`pnpm typecheck`

## 后续处理原则

- 改回放语义时，必须同时核对 Direct HTTP replay、Direct WS stream、Relay subscribe replay。
- 不能只修 `session-surface.tsx` 就认为 Relay 同步生效；Relay 还有 Gateway relay-client 和
  Relay server 两层。
- 所有 replay limit、cursor、`replay.done`、live subscribe cursor 的改动，都必须同时补
  Direct 和 Relay 测试。
- 如果以后引入 snapshot / transcript 优化，也要明确 Direct 和 Relay 的降级语义一致。

## 下一步对齐方向：Gateway-owned subscribe / replay / live

长期不应继续让 Direct 和 Relay 分别维护 replay 规则。推荐对齐到同一个
Gateway-owned subscribe / replay / live 模型：

```text
Web 只表达：我要订阅这个 session
Gateway 负责：resize -> paged replay -> replay.done -> live
Relay 负责：转发 subscribe / event / replay.done
```

Direct 和 Relay 的区别只保留在传输层：

```text
Direct:
Web -> Gateway WS /stream
Gateway -> paged replay
Gateway -> replay.done
Gateway -> live events

Relay:
Web -> Relay client.subscribe
Relay -> Gateway client.subscribe
Gateway -> paged replay
Gateway -> Relay
Relay -> Web event / replay.done
Gateway -> live events
```

这不是“Direct 对齐 Relay”，而是 Direct 和 Relay 都对齐 Gateway-owned session
订阅模型。Relay 当前已经比较接近该模型，所以第一步主要改 Direct。

目标规则：

- replay 规则只在 Gateway 保留一份。
- Direct WS `/stream` 和 Gateway relay-client 共用同一个 replay helper。
- Web 不再把 Direct HTTP `/events` 分页 replay 作为主路径。
- HTTP `/events` 保留为调试、fallback 或 transcript 类读取接口。
- Relay 不拥有 replay 规则，只转发 Gateway 的 `gateway.replay` / `gateway.event`。

建议实现顺序：

1. 在 Gateway 抽共享 helper：

   ```ts
   replaySessionEvents({
     sessionId,
     after,
     tail,
     pageSize,
     sendPage
   }): number
   ```

   helper 负责 `recent/all`、分页、`done:false` / `done:true` 和返回最后 cursor。

2. Gateway relay-client 使用该 helper，保持现有 Relay frame 语义。
3. Direct WS `/stream` 使用同一 helper，从一页 replay 升级为分页 replay。
4. Web Direct 主路径移除 HTTP 全量 replay，改为只打开 WS 并消费 `event` / `replay.done`。
5. 补 Direct / Relay 行为一致性测试：`all` 超过 5000 条、`recent`、live cursor、
   `session_lost`、resize before replay。

不做：

- 不引入本地 Relay 来替代 Direct。
- 不让 Relay 执行 replay 查询或保存 replay 状态。
- 不继续把 Web 侧 Direct replay 分页作为长期主路径。

## 推荐体验方案

### 短期方案：完整历史快速恢复 + live

控制台进入页的目标是尽快接管当前 session，不应该按真实时间等待历史回放。短期推荐：

```text
完整历史按 event.id 顺序快速写入 xterm
-> 从最后 event id 接 live stream
-> replay 完成后开启输入
```

关键规则：

- 进入控制页面时立即创建并显示 terminal surface，不等完整历史恢复完成。
- 不跳过历史，不只取最近 100 条。
- 不按原始 `event.ts` 时间间隔等待。
- 保留 event 顺序，按 `event.id` 升序写入。
- replay 前先同步 terminal size，减少布局错位。
- replay 期间禁止输入，避免新输入插到历史事件中间。
- 收到 `replay.done` 后，必须等本地 replay 队列 flush 完，再开启输入。
- replay 队列 flush 完后，从最后 event id 继续接 live，live event 才直接写入 xterm，避免重复、
  漏事件或乱序。
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
