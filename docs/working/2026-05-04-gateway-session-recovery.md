# Gateway 重启后的 session 恢复缺口

本文记录 Gateway 重启后，历史 `running` session 状态和真实 PTY ownership 不一致的问题。
这是后端待设计/待实现事项，不是当前已完成能力。

## 问题背景

当前 Gateway 重启后，前端可以自动重连 Gateway，但后端还没有完整的 session 恢复语义。

关键风险是：SQLite store 里仍可能记录某个 session 为 `running`，但新的 Gateway 进程
内存里已经没有对应的 PTY manager / child process 句柄。此时 Web 如果继续把它当成可控
running session 展示，会误导用户。

## 后端需要补齐的能力

1. Gateway 启动时读取 store 里的 `running` sessions。
2. 对每条 `running` session 做健康检查：
   - 如果 PTY process 仍由当前 Gateway manager 持有，继续保持 `running`。
   - 如果当前 Gateway manager 不持有，但能确认 CLI attach / provider 进程仍活着，标记为
     `lost` 或后续新增的 `detached`，表示有历史记录但当前不可控。
   - 如果进程不存在，标记为 `stopped` 或 `lost`，不得继续暴露为 `running`。
3. `/api/sessions` 不应把不可控旧 session 继续返回为 `running`。Active 列表只能代表当前
   Gateway 能控制或能确认仍被托管的 session。
4. `/api/sessions/:id/stream` 对不可恢复 session 必须返回明确错误，而不是让 Web 一直卡在
   旧终端画面。建议错误码：
   - `session_lost`
   - `gateway_restarted`
   - `session_not_attached`
5. 如果要真正做到 Gateway 重启后恢复控制，session 不能只存在于旧 Gateway 进程内存里。
   需要一个可重附着的 PTY/session supervisor：由长期子进程、独立 supervisor 或其他可
   重新发现的 process ownership 模型托管 PTY，使新 Gateway 能重新接管。

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

## 推荐架构：Gateway + Session Supervisor

把 PTY ownership 从 Gateway 主进程里拆出来：

```text
launchd
  └─ tether gateway               # HTTP / WS / Relay / auth / API 进程，可重启
       └─ 连接本机 supervisor API

tether-session-supervisor         # 长期运行的本机 session owner
  ├─ session tth_xxx -> PTY child -> codex
  ├─ session tth_yyy -> PTY child -> claude
  └─ append-only event writer -> ~/.tether/tether.db
```

职责边界：

| 模块 | 职责 |
| --- | --- |
| Gateway | HTTP API、WebSocket、Relay client、auth、scope 校验、前端静态资源 |
| Supervisor | 创建 PTY、持有 PTY handle、写入 stdin、resize、stop、监听 exit、写事件 |
| Store | sessions / session_events 的持久事实 |
| CLI | 调 Gateway API；安装/启动/诊断 Gateway 和 Supervisor |

Gateway 重启时不再需要“找回旧 PTY handle”。它只需要重新连接 supervisor，读取 supervisor
当前持有的 live session 列表，再和 store 对账。

## 后端改造范围

### 1. 新增 Supervisor 进程

新增一个长期运行的本机进程，建议先放在 `apps/gateway` 内部实现，不急着拆新 package：

```text
apps/gateway/src/supervisor.ts
apps/gateway/src/supervisor-client.ts
```

Supervisor 负责：

- 持有 `PtySessionManager`。
- 创建 PTY session。
- 保存 live session map。
- 接收 `write / resize / stop / listLiveSessions` 请求。
- 监听 PTY exit 并写 `session.exited`。
- 继续使用 `Store` 写 `sessions` 和 `session_events`。

Supervisor 通信建议先走本机 Unix domain socket，避免占用公网端口：

```text
~/.tether/supervisor.sock
```

如果跨平台后续要兼容 Windows，再抽象为 named pipe / TCP loopback。

### 2. Gateway 改为 supervisor client

Gateway 当前直接持有 `PtySessionManager`。要改成：

- `POST /api/sessions` 调 supervisor 创建 session。
- `/api/sessions/:id/input` 调 supervisor write。
- `/api/sessions/:id/stream` 从 store 补历史事件，再订阅 supervisor 的 live event feed。
- `/api/sessions/:id/stop` 调 supervisor stop。
- `/api/status` 显示 supervisor 连接状态和 live session ids。
- Gateway 启动时用 supervisor `listLiveSessions()` 对账 store。

Gateway 不再自己 spawn provider，不再直接持有 PTY child handle。

### 3. Store 对账规则

Gateway 启动或 supervisor 重连后：

1. 读取 store 中 `status = running` 且 `transport = pty-event-stream` 的 sessions。
2. 从 supervisor 获取 live session ids。
3. live 中存在：保持 `running`。
4. store running 但 supervisor 不存在：标记 `lost`，写 `session.error`。
5. supervisor live 但 store 缺失：这是异常状态，优先写入告警日志；短期不自动补 session。

### 4. CLI / launchd 范围

CLI 需要新增或扩展：

- `tether supervisor start`
- `tether supervisor stop`
- `tether supervisor status`
- `tether gateway start` 确保 supervisor 已启动。
- `tether gateway stop` 只停 Gateway，不停 supervisor。
- `tether stop <id>` 仍走 Gateway API；Gateway 再转 supervisor。
- `tether doctor` 检查 Gateway 和 Supervisor 两个进程。

launchd 建议拆成两个 plist：

```text
~/Library/LaunchAgents/sh.tether.supervisor.plist
~/Library/LaunchAgents/sh.tether.gateway.plist
```

启动顺序：

1. supervisor 先启动。
2. Gateway 后启动并连接 supervisor。
3. Gateway 可重启，supervisor 不受影响。

### 5. Relay 范围

Relay 本身不需要知道 supervisor。Gateway relay-client 仍按原协议向 Relay 汇报 sessions 和
转发事件。

需要调整的是 Gateway relay-client 的数据来源：

- sessions 来自 store + supervisor live 状态。
- input / resize / stop 从 Relay 进 Gateway 后转 supervisor。

Relay 协议不需要为 supervisor 单独加字段。

### 6. 测试范围

必须补以下测试：

- Supervisor 创建 PTY，Gateway 通过 supervisor 输入并收到事件。
- Gateway 重启后，supervisor 未重启，原 session 仍为 `running`。
- Gateway 重启后 WebSocket 重新连接，能继续收到旧 session 新输出。
- Gateway 重启后 `input / resize / stop` 仍能控制原 session。
- supervisor 重启后，Gateway 把旧 running session 标记为 `lost`。
- `tether gateway stop` 不杀 supervisor，不中断 agent。
- `tether supervisor stop` 会让 Gateway 后续将 session 标为 lost 或 unavailable。

## 不在本阶段做

- 不改前端路由和页面结构。
- 不把恢复逻辑放到浏览器 local state。
- 不做跨机器 PTY 迁移。
- 不做 Windows Service / Linux systemd。
- 不做 Relay 持久化终端明文。
- 不做“Gateway 死了但 supervisor 也死了还能恢复控制”。supervisor 如果也死了，PTY handle
  仍然丢失，只能标记 lost。

## 分阶段落地建议

### Wave 1：Supervisor 最小闭环

- 新增 supervisor 进程和 Unix socket API。
- 支持 create / write / resize / stop / list。
- CLI 能启动 supervisor。
- 本地测试通过，不接 Relay。

### Wave 2：Gateway 接入 Supervisor

- Gateway 创建和控制 session 改走 supervisor。
- Gateway 重启后能继续控制旧 session。
- `/api/status`、`/api/sessions` 对账 live 状态。

### Wave 3：launchd 和诊断

- 拆 Gateway / Supervisor plist。
- `gateway start` 自动确保 supervisor。
- `doctor/status` 展示两个进程状态。

### Wave 4：Relay 回归

- 确认 Relay 模式下 input / resize / stop 仍走 supervisor。
- 补 Gateway 重启后 Relay client 重新上线并汇报 live sessions 的测试。

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

如果只重启 Gateway，session 不应 lost。只有 supervisor 或 PTY child 消失时才进入 lost。
