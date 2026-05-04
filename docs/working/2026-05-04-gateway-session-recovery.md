# Gateway 重启后的 session 恢复缺口

本文记录 Gateway 重启后，历史 `running` session 状态和真实 PTY ownership 不一致的问题。
这是后端待设计/待实现事项，不是当前已完成能力。

## 问题背景

当前 Gateway 重启后，前端可以自动重连 Gateway，但后端还没有完整的 session 恢复语义。

关键风险是：SQLite store 里仍可能记录某个 session 为 `running`，但新的 Gateway 进程
内存里已经没有对应的 PTY manager / child process 句柄。此时 Web 如果继续把它当成可控
running session 展示，会误导用户。

## 当前代码状态

短期 `lost` 兜底已经实现，不应在后续阶段重复当作新能力开发：

- `/api/sessions` 会检查当前 Gateway 是否持有 live PTY handle；如果没有，会把
  `running + pty-event-stream` session 标记为 `lost`，并写入 `session.error`。
- Gateway 启动后会调用 `markRunningPtySessionsLost(liveSessionIds)`，把 store 里仍是
  `running`、但当前进程没有 live PTY handle 的 PTY session 标记为 `lost`。
- `/api/sessions/:id/stream` 对没有 live PTY handle 的 PTY session 会关闭连接并返回
  `session_lost`，不会继续伪装成可控 stream。

这说明当前已经解决的是“不要把不可控旧 session 展示成 running”。尚未解决的是
“Gateway 重启后仍能重新控制原 session”。

## 后端仍需补齐的能力

如果要真正做到 Gateway 重启后恢复控制，session 不能只存在于旧 Gateway 进程内存里。
需要一个可重附着的 PTY/session runner：由长期子进程或其他可重新发现的 process ownership
模型托管 PTY，使新 Gateway 能重新接管。

## 执行状态

- [x] 已确认当前代码有 `lost` 兜底，不需要重复开发“不可控 running session 自动标 lost”。
- [x] 已确认恢复控制的目标不是前端补 state，而是拆出可重附着的 PTY/session owner。
- [x] 已确认首选架构为 per-session runner，中央 Supervisor 只保留为备选。
- [x] 已确认首阶段不接 Relay、不拆新 package、不改前端路由和页面结构。
- [ ] 尚未完成 Wave 0 设计落地。
- [ ] 尚未完成 Session Runner 最小闭环实现。
- [ ] 尚未完成 Gateway 重启后的真恢复控制。

## 短期产品口径

- Gateway 不可用或刚重启时，Web 应显示“正在重连 / Gateway 重启中”。
- Gateway 恢复但 session 不在新 Gateway 托管范围内时，Web 应显示“Gateway 已恢复，但
  这个 session 未被重新托管”。
- Sessions active 区不应展示不可控旧 session；这类记录只能进入历史或失联态。

## 当前结论

这不是前端状态问题，而是 Gateway runtime ownership 模型的后端缺口。前端只能做自动重连
和明确错误展示，不能凭旧 state 恢复控制权。

## 真恢复控制的方案范围

目标：Gateway 进程重启后，用户仍能继续控制原来的 agent session。这里的“恢复控制”不是
把旧记录重新显示成 running，而是新 Gateway 能重新连接到仍然存活的 PTY/session owner，
继续读输出、写输入、resize 和 stop。

这件事原则上不改前端。前端已经通过现有接口消费：

- `/api/sessions`
- `/api/sessions/:id/snapshot`
- `/api/sessions/:id/events`
- `/api/sessions/:id/stream`
- `/api/sessions/:id/input`
- `/api/sessions/:id/stop`

只要后端重新把 session 暴露为可控 `running`，前端继续按现有重连逻辑工作。最多需要补文案
或状态展示，不应把恢复逻辑塞到前端。

## 推荐架构：Gateway + Per-session Runner

把 PTY ownership 从 Gateway 主进程里拆出来，并让每个 session 拥有独立 runner 进程：

```text
launchd
  └─ tether gateway               # HTTP / WS / Relay / auth / API 进程，可重启
       └─ 连接每个 session runner

session runner: tth_xxx           # 长期运行的单 session owner
  ├─ owns PTY handle
  ├─ owns codex / claude child
  ├─ append-only event writer -> ~/.tether/tether.db
  └─ control socket -> ~/.tether/sessions/tth_xxx.sock

session runner: tth_yyy
  └─ control socket -> ~/.tether/sessions/tth_yyy.sock
```

职责边界：

| 模块 | 职责 |
| --- | --- |
| Gateway | HTTP API、WebSocket、Relay client、auth、scope 校验、前端静态资源 |
| Session Runner | 单个 session 的 PTY owner，写入 stdin、resize、stop、监听 exit、写事件 |
| Store | sessions / session_events 的持久事实 |
| CLI | 调 Gateway API；安装/启动/诊断 Gateway 和 session runner |

Gateway 重启时不再需要“找回旧 PTY handle”。它只需要根据 store 中的 session metadata
重新连接对应 runner socket。runner 还活，session 就继续可控；某个 runner 死，只影响这个
session，不会拖垮其他 session。

## 为什么 per-session runner 优先于中央 Supervisor

中央 Supervisor 也能解决 Gateway 重启，但它仍是一个单点：

```text
Gateway 死 -> Supervisor 活 -> 可以恢复
Supervisor 死 -> 所有 session 一起 lost
```

per-session runner 的边界更好：

```text
Gateway 死 -> runners 活 -> 全部可恢复
某个 runner 死 -> 只丢这个 session
其他 runner 不受影响
```

这更符合 Tether 的长期模型：session 是一个可管理、可审计、可独立生命周期控制的资源。

中央 Supervisor 可以作为备选实现，但不建议作为首选路线。

## Wave 0：实现前必须补齐的设计

以下内容必须在 Wave 1 编码前落成明确契约，否则 runner 拆出去后会把问题转移到 IPC、
多进程写库和生命周期竞态里。

### 1. IPC 协议骨架

runner 与 Gateway 之间先使用本机 Unix domain socket。协议建议使用 newline-delimited JSON
作为首版格式，避免自定义二进制 framing 增加调试成本；如果后续发现单帧 payload 过大，再切
length-prefixed。

所有请求必须带 `id`，所有响应必须回同一个 `id`：

```ts
type RunnerRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'write'; data: string; clientId: string }
  | { id: string; type: 'resize'; cols: number; rows: number; clientId: string }
  | { id: string; type: 'stop'; reason?: string }
  | { id: string; type: 'subscribeEvents'; after?: number };

type RunnerResponse =
  | { id: string; ok: true; result?: Record<string, unknown> }
  | { id: string; ok: false; error: string; message?: string };

type RunnerEventFrame = {
  type: 'event';
  eventId: number;
  sessionId: string;
};
```

事件正文仍以 SQLite `session_events` 为事实源。runner live feed 只需要通知 Gateway
`eventId`，Gateway 再从 store 读取事件并转发给 WebSocket / Relay。这样 Gateway 重启、
WebSocket 重连和 Relay 重连都可以复用 cursor replay。

背压策略必须明确：

- runner 写 `session_events` 不等待 WebSocket 慢客户端。
- Gateway 对每个 WebSocket 维护 bounded send queue；队列超过阈值时关闭该客户端，让客户端
  用 `after/latestEventId` 重连补事件。
- runner 到 Gateway 的 `subscribeEvents` 通知也应是 bounded queue；满了就断开订阅，Gateway
  重新按 cursor 订阅。
- 单帧最大长度需要有限制，超限直接返回 `bad_frame` 并断开连接。

### 2. process detach 实证

runner 必须脱离 Gateway 生命周期。实现前要写一个最小实验和测试记录，验证：

- Node `spawn(cmd, args, { detached: true, stdio: 'ignore' })` + `child.unref()` 后，Gateway
  正常退出时 runner 仍存活。
- Gateway 被 `kill -9` 后 runner 仍存活。
- macOS launchd 的 `bootout` / `kickstart -k` 只影响 Gateway plist，不会把 runner 一起带走。
- Linux 下同样验证父进程退出后 runner 是否被 init/systemd 接管。

如果某个平台验证不成立，Wave 1 只能标注为 macOS-only 或改用对应平台的 runner 托管方式。

### 3. SQLite 多写者

当前 Store 已开启 WAL，但 runner 拆成多进程后会出现多个 writer 同时写
`sessions` / `session_events`。Wave 1 前必须补：

- `PRAGMA busy_timeout = <ms>`。
- 并发 append `session_events` 的测试，覆盖多个 Store 实例同时写同一个 DB。
- runner heartbeat 与 terminal output 同时写入时不丢事件、不抛 `SQLITE_BUSY`。

### 4. runner metadata 显式字段

runner 巡检字段直接落到 `sessions` 表，不使用 JSON metadata：

```text
runner_pid
runner_socket_path
runner_started_at
runner_last_heartbeat_at
```

Gateway 启动巡检、`doctor/status` 和后续清理 stale runner/socket 都依赖这些字段做查询和展示。

### 5. runner 生命周期事件

必须区分 provider session 事件和 runner 事件：

- `session.started` / `session.exited`：表示 agent/provider 对应的 PTY session 生命周期。
- `runner.started` / `runner.heartbeat` / `runner.exited`：表示 session runner 进程生命周期。

Gateway 重启时判断顺序：

1. 优先 ping `runner_socket_path`。
2. ping 成功：保持 `running`，必要时补写 `runner.heartbeat`。
3. ping 失败但 `runner_pid` 存活：短暂重试。
4. ping 失败且 runner 事件中已有 `runner.exited`：按 runner 退出结果更新 session。
5. 没有 `session.exited`、也没有 `runner.exited`，且 heartbeat 过期：标 `lost`，写
   `session.error`，不要假装能区分“正常退出但没落库”和“崩溃丢 handle”。

## 后端改造范围

### 1. 新增 Session Runner 进程

新增一个单 session runner 入口，建议先放在 `apps/gateway` 内部实现，不急着拆新 package：

```text
apps/gateway/src/session-runner.ts
apps/gateway/src/session-runner-client.ts
```

Session runner 负责：

- 持有单个 PTY handle。
- 启动 provider child。
- 接收 `write / resize / stop / ping / subscribeEvents` 请求，遵守 Wave 0 IPC 契约。
- 监听 PTY exit 并写 `session.exited`。
- 继续使用 `Store` 写 `sessions` 和 `session_events`。
- 定期 heartbeat，更新 runner metadata，并写入 runner 生命周期事件。
- 退出时清理自己的 socket。

runner 通信建议先走本机 Unix domain socket，避免占用公网端口：

```text
~/.tether/sessions/<session-id>.sock
```

如果跨平台后续要兼容 Windows，再抽象为 named pipe / TCP loopback。

### 2. Gateway 改为 runner client

Gateway 当前直接持有 `PtySessionManager`。要改成：

- `POST /api/sessions` spawn 一个 session runner。
- `/api/sessions/:id/input` 连接 runner socket 并调用 write。
- `/api/sessions/:id/stream` 从 store 补历史事件，再订阅 runner live event feed。
- `/api/sessions/:id/stop` 调 runner stop。
- `/api/status` 显示可连接 runner 数量和不可连接 session 数量。
- Gateway 启动时逐个 ping store 中的 running session runner。

Gateway 不再自己 spawn provider，不再直接持有 PTY child handle。

### 3. Store / metadata 范围

需要在 `sessions` 表中持久化 runner 信息。首版直接加显式字段，不使用 JSON metadata：

```text
runner_pid
runner_socket_path
runner_started_at
runner_last_heartbeat_at
```

Gateway 启动或定期巡检时：

1. 读取 store 中 `status = running` 且 `transport = pty-event-stream` 的 sessions。
2. 用 `runner_socket_path` ping 对应 runner。
3. ping 成功：保持 `running`。
4. ping 失败但 runner pid 还存在：重试几次，仍失败则标 `lost`。
5. socket 不存在或 pid 不存在：标 `lost`，写 `session.error`。
6. runner live 但 store 缺失：这是异常状态，优先写入告警日志；短期不自动补 session。

### 4. CLI / launchd 范围

CLI 需要新增或扩展：

- `tether gateway start` 只启动 Gateway；runner 随 session 创建而启动。
- `tether gateway stop` 只停 Gateway，不停 runner。
- `tether gateway restart` 不影响 runner。
- `tether stop <id>` 仍走 Gateway API；Gateway 再转对应 runner。
- `tether doctor` 检查 Gateway、running sessions 的 runner socket 和 runner pid。
- 可以新增 `tether runners` 或 `tether sessions --debug`，显示 runner 诊断信息。

launchd 不需要为每个 runner 写 plist。runner 是 Gateway 创建 session 时 spawn 的长期子进程，
并且要脱离 Gateway 进程组，使 Gateway 退出后 runner 仍存活。

如果后续希望 runner 在用户登录后自动恢复，可以再设计 runner registry + launchd job，但首版不做。

### 5. Relay 范围

Relay 本身不需要知道 runner。Gateway relay-client 仍按原协议向 Relay 汇报 sessions 和
转发事件。

需要调整的是 Gateway relay-client 的数据来源：

- sessions 来自 store + runner ping 状态。
- input / resize / stop 从 Relay 进 Gateway 后转对应 runner。

Relay 协议不需要为 runner 单独加字段。

### 6. 测试范围

必须补以下测试：

- IPC 请求/响应 id、错误帧、坏帧、订阅 cursor 和背压断开策略。
- SQLite WAL + busy_timeout 下多个 Store 实例并发写 `session_events`。
- process detach 实证：Gateway 正常退出、`kill -9`、launchd restart 后 runner 仍存活。
- Gateway 创建 session 时 spawn runner，并写入 runner metadata。
- Gateway 通过 runner 输入并收到事件。
- Gateway 重启后，runner 未重启，原 session 仍为 `running`。
- Gateway 重启后 WebSocket 重新连接，能继续收到旧 session 新输出。
- Gateway 重启后 `input / resize / stop` 仍能控制原 session。
- 某个 runner 死后，Gateway 只把对应 session 标记为 `lost`。
- `tether gateway stop` 不杀 runner，不中断 agent。
- `tether stop <id>` 能真正 stop 对应 runner 和 provider child。

## 不在本阶段做

- 不改前端路由和页面结构。
- 不把恢复逻辑放到浏览器 local state。
- 不做跨机器 PTY 迁移。
- 不做 Windows Service / Linux systemd。
- 不做 Relay 持久化终端明文。
- 不做“runner 死了还能恢复控制”。runner 如果死了，该 session 的 PTY handle 仍然丢失，只能
  标记 lost。
- 不做中央 Supervisor 作为首选架构。中央 Supervisor 只作为备选方案保留。

## 可行动 TODO

### Wave 0：补设计和实证

- [ ] 定义 runner IPC schema：request / response / event frame、请求 id、错误码、最大帧长度。
- [ ] 定义 IPC 背压策略：runner 不等慢 WebSocket；Gateway bounded queue；超限断开并靠
  cursor replay 恢复。
- [ ] 写 runner detach 最小实验，覆盖 Gateway 正常退出、`kill -9`、macOS launchd restart。
- [ ] 验证 Linux 父进程退出后 runner 是否仍存活；如果不成立，标注平台限制或调整托管方式。
- [ ] Store 增加 `PRAGMA busy_timeout`。
- [ ] 补多个 Store 实例并发写 `session_events` 的测试。
- [ ] `sessions` 表新增 `runner_pid`、`runner_socket_path`、`runner_started_at`、
  `runner_last_heartbeat_at`。
- [ ] `SessionEventType` 增加 `runner.started`、`runner.heartbeat`、`runner.exited`。

### Wave 1：Session Runner 最小闭环

- [ ] 在 `apps/gateway/src/session-runner.ts` 和 `apps/gateway/src/session-runner-client.ts` 内联实现，
  暂不拆 package。
- [ ] 只做本地闭环，不接 Relay。
- [ ] Gateway 创建 session 时 spawn runner，并写入 runner metadata。
- [ ] runner 持有单个 PTY handle，负责 provider child、stdin、resize、stop、exit 监听。
- [ ] runner 写 `session.started`、`session.exited`、`terminal.output`、`user.input`、
  `terminal.resize` 和 runner 生命周期事件。
- [ ] 用 `SessionRunnerClient` 替换 Gateway 对 `PtySessionManager` 的直接控制路径，跑通
  `create / write / resize / stop / subscribeEvents`。
- [ ] 本地测试必须覆盖：Gateway `kill -9` 后 runner 仍存活；Gateway 重启后仍能控制原 session；
  runner `kill -9` 后 Gateway 标 `lost` 且不影响其他 session。

### Wave 2：Gateway 接入 Runner 恢复

- [ ] `/api/status`、`/api/sessions` 通过 runner ping 对账 live 状态。
- [ ] Gateway 启动时扫描 `running + pty-event-stream` session，并按 runner socket / pid /
  heartbeat 判断 `running` 或 `lost`。
- [ ] WebSocket 重新连接后，从 store replay 历史事件，再订阅 runner live event feed。
- [ ] `tether attach <id>`、HTTP input、resize、stop 都通过 runner client 保持可控。
- [ ] runner 不可连接时写 `session.error`，只标记对应 session 为 `lost`。

### Wave 3：launchd 和诊断

- [ ] `gateway stop/restart` 不影响 runner。
- [ ] `doctor/status` 展示 Gateway、runner pid、runner socket、heartbeat、不可连接 session 数量。
- [ ] 增加 stale runner/socket 清理诊断。
- [ ] 可选增加 `tether runners` 或 `tether sessions --debug`。

### Wave 4：Relay 回归

- [ ] Relay 模式下 input / resize / stop 仍走 Gateway -> runner。
- [ ] Relay client 上报 sessions 时使用 store + runner ping 状态。
- [ ] 补 Gateway 重启后 Relay client 重新上线并汇报 live sessions 的测试。

## 成功标准

执行以下流程应成立：

```bash
tether gateway start
tether codex
# session running
tether gateway restart
tether attach <same-session-id>
# 能看到旧输出，并继续输入
tether stop <same-session-id>
# 能真正 stop 原 PTY child
```

如果只重启 Gateway，session 不应 lost。只有对应 runner 或 PTY child 消失时才进入 lost。

## 验收清单

### Wave 0 设计验收

- [ ] 文档中有明确 IPC schema，包含请求/响应 id、错误响应、event frame 和最大帧长度。
- [ ] 文档中有明确背压策略，说明 runner、Gateway、WebSocket 慢消费者分别如何处理。
- [ ] 有可重复执行的 detach 实验命令或测试，能证明 runner 脱离 Gateway 生命周期。
- [ ] SQLite Store 配置包含 WAL 和 `busy_timeout`。
- [ ] 并发写 `session_events` 测试通过，覆盖多个 Store 实例同时写同一 DB。
- [ ] `sessions` 表显式保存 runner 巡检字段，不使用 JSON metadata。
- [ ] runner 生命周期事件进入类型定义和测试样例。

### Wave 1 本地闭环验收

- [ ] `POST /api/sessions` 创建的是 per-session runner，不再由 Gateway 主进程直接持有新 PTY。
- [ ] `write / resize / stop / ping / subscribeEvents` 通过 runner socket 工作。
- [ ] runner 写入 `session_events` 后，Gateway 能通过 cursor replay + live feed 转发给客户端。
- [ ] Gateway 正常退出后，runner 和 provider child 仍存活。
- [ ] Gateway 被 `kill -9` 后，runner 和 provider child 仍存活。
- [ ] Gateway 重启后，原 session 仍为 `running`，并且 `tether attach <id>` 可继续输入。
- [ ] 杀掉单个 runner 后，只有对应 session 进入 `lost`，其他 session 不受影响。
- [ ] `tether stop <id>` 能停止对应 runner 和 provider child，并写入退出事件。

### 最终恢复控制验收

- [ ] `tether gateway start` 后创建 session，`tether gateway restart` 不导致 session lost。
- [ ] Gateway 重启后 WebSocket 重新连接，能看到旧输出并继续收到新输出。
- [ ] Gateway 重启后 HTTP input、CLI attach input、resize、stop 都仍可控制同一 session。
- [ ] `/api/sessions` 只把可 ping 通 runner 的 session 暴露为可控 `running`。
- [ ] `/api/status` / `doctor` 能展示 runner 可连接数量、不可连接数量和 stale socket/pid 诊断。
- [ ] Relay 回归后，远端 input / resize / stop 仍通过 Gateway 转给 runner。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 通过。
