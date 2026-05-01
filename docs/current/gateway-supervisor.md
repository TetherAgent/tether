# Gateway Supervisor 使用说明

本文记录 Phase 6 之后的本机 Gateway 日常使用方式。常规路径是先让常驻 Gateway 在
Mac 上运行，再用 `tether codex` / `tether run codex` 请求这个 Gateway 创建并托管
PTY session；CLI 只负责发起请求和 attach，关闭 CLI 不应杀掉 session。

`tether codex --inline` 是调试 fallback：它强制使用旧的单次 CLI 内联 Gateway，不走
常驻 Gateway 转发路径。

## 日常命令

```bash
tether gateway
tether gateway config
tether gateway install
tether gateway start
tether gateway stop
tether gateway restart
tether gateway status
tether gateway uninstall
tether codex
tether codex --inline
```

- `tether gateway`：前台运行 Gateway，适合开发、观察日志和手动验证。
- `tether gateway config`：写入本机 Gateway/Relay 配置。
- `tether gateway install`：注册 macOS LaunchAgent 登录启动，不立即启动。
- `tether gateway start`：通过 launchd 启动后台 Gateway；如果 plist 不存在会先写入。
- `tether gateway stop`：通过 launchd 停止后台 Gateway。
- `tether gateway restart`：通过 launchd 重启后台 Gateway。
- `tether gateway status`：输出中文状态，包含运行状态、PID、URL、配置路径、Host、
  Port、Relay 配置、Relay 连接和 LaunchAgent 状态。
- `tether gateway uninstall`：停止后台 Gateway 并移除 LaunchAgent。
- `tether codex`：优先探测常驻 Gateway；可用时由常驻 Gateway 创建并持有 session。
- `tether codex --inline`：强制使用 inline 模式，适合排查 Gateway 转发问题。

仓库内开发时等价命令使用 `pnpm tether ...`，例如：

```bash
pnpm tether gateway status
pnpm tether codex --inline
```

## 配置文件

Gateway 配置文件是 JSON：

```text
~/.tether/config.json
```

推荐用 CLI 写入：

```bash
tether gateway config --host 127.0.0.1 --port 4789 --allow-api-session-create
tether gateway config --relay-url wss://relay.example.com --relay-secret <personal-secret>
```

配置解析优先级是：CLI flags > 环境变量 > `~/.tether/config.json` > 默认值。

`allowApiSessionCreate` 默认是 `false`。它关闭时，`POST /api/sessions` 会拒绝远程/API
创建 session；它开启后也仍然只允许 provider 白名单里的 `codex`、`claude` 和
`opencode`，不能接受任意 command/args/env，也不是完整远程执行接口。

## 后台运行

macOS 后台运行由 launchd 管理。LaunchAgent 路径是：

```text
~/Library/LaunchAgents/sh.tether.gateway.plist
```

安装和启动：

```bash
tether gateway install
tether gateway start
tether gateway status
```

停止和卸载：

```bash
tether gateway stop
tether gateway uninstall
```

`install` 只注册登录启动；如果要马上运行，继续执行 `start`。plist 的
`ProgramArguments` 使用安装时解析出的绝对 Node、tsx loader 和 CLI 入口路径，不依赖
当前工作目录里的 `pnpm tether`。

## Session 创建安全边界

常驻 Gateway 的 session 创建 API 是受控本机能力，不是任意命令执行 API：

- 默认关闭，必须显式设置 `allowApiSessionCreate: true`。
- provider 必须在白名单内，目前是 `codex`、`claude`、`opencode`。
- request body 只接受 `provider`、`projectPath`、`cols`、`rows`。
- 不能接受任意 command/args/env、`shell`、`argv` 或 `providerCommand`。
- Gateway 默认绑定 `127.0.0.1`；暴露到局域网必须显式设置 `--host 0.0.0.0`。
- Phase 4 的完整 owner device-token pairing/auth 仍未在本阶段实现。
- Phase 5 的 retention、WAL checkpoint 和 event storage cleanup 仍未在本阶段实现。

## 本地验证

前台 Gateway + CLI 转发：

```bash
pnpm tether gateway config --host 127.0.0.1 --port 4789 --allow-api-session-create
pnpm tether gateway
pnpm tether run codex --no-attach
pnpm tether gateway status
pnpm tether ls
pnpm tether codex --inline --no-attach
```

后台 launchd 生命周期：

```bash
pnpm tether gateway install
pnpm tether gateway start
pnpm tether gateway status
pnpm tether gateway stop
pnpm tether gateway uninstall
```

卸载后确认 `~/Library/LaunchAgents/sh.tether.gateway.plist` 已删除，且
`launchctl print gui/$(id -u)/sh.tether.gateway` 不再显示已加载服务。

## 故障排查

- `tether codex` 提示未检测到常驻 Gateway：先运行 `tether gateway status`，必要时用
  `tether gateway start` 启动后台 Gateway，或用 `tether gateway` 前台观察日志。
- 提示 API session creation 未启用：运行
  `tether gateway config --allow-api-session-create` 后重启 Gateway。
- 端口被非 Tether 服务占用：停止占用端口的进程，或用 `tether gateway config --port`
  改到明确的本机端口。
- Relay 已配置但未连接：先确认 Relay 服务和 secret，再看 `tether gateway status`
  里的 Relay 连接状态；Relay 断开不应阻止本地 session 创建。
- launchd 状态异常：运行 `tether gateway stop` 后再 `tether gateway start`；如果需要
  重建 plist，运行 `tether gateway uninstall` 再 `tether gateway install`。

## Verification

本节记录本文件对应计划的手工和自动验证结果。

### 2026-05-02 Phase 6 Plan 05

前台 Gateway + CLI forwarding smoke：通过。

使用临时 HOME `/tmp/tether-0605-smoke.jIuAGE`、临时 fake `codex`、临时 project 和非默认
端口，避免污染真实 `~/.tether`：

```bash
HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether gateway config --host 127.0.0.1 --port 4915 --allow-api-session-create

HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether gateway

HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether run codex --project /tmp/tether-0605-smoke.jIuAGE/project --no-attach

HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether gateway status

HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether ls

HOME=/tmp/tether-0605-smoke.jIuAGE PATH=/tmp/tether-0605-smoke.jIuAGE/bin:$PATH \
  pnpm tether codex --inline --port 4916 --project /tmp/tether-0605-smoke.jIuAGE/project --no-attach
```

结果：

- `pnpm tether gateway config --host 127.0.0.1 --port 4915 --allow-api-session-create`
  写入临时 `config.json`，包含 host、port 和 `allowApiSessionCreate`。
- `pnpm tether gateway` 从临时配置启动到 `http://127.0.0.1:4915`。
- `pnpm tether run codex --no-attach` 通过常驻 Gateway 创建
  `tth_20260502_4d58d13b`，输出 `Remote URL: http://127.0.0.1:4915/remote/session/tth_20260502_4d58d13b`。
- `pnpm tether gateway status` 输出中文状态，显示运行中、PID、URL、配置文件、Host、
  Port、Relay 配置、Relay 连接和 LaunchAgent。
- `pnpm tether ls` 显示 session 为 `running pty-event-stream`。
- `pnpm tether codex --inline --no-attach` 输出“已启用 inline 模式”，并在 4916 端口启动
  debug fallback session。
- 本次没有配置 Relay 服务，因此 Web/Relay session list 未重复人工验证；风险限于 Relay
  UI 列表路径未在本 smoke 中点击确认，Relay frame 路径已有既有自动测试覆盖。

launchd lifecycle smoke：通过。

真实 LaunchAgent 状态预检查显示未安装、未加载，默认 4789 端口无监听。随后运行：

```bash
pnpm tether gateway install
pnpm tether gateway start
pnpm tether gateway status
pnpm tether gateway stop
pnpm tether gateway uninstall
```

结果：

- `pnpm tether gateway install` 创建
  `~/Library/LaunchAgents/sh.tether.gateway.plist`，且未立即启动 Gateway。
- `pnpm tether gateway start` 通过 launchd 启动 Gateway。
- `pnpm tether gateway status` 输出中文状态，显示 `运行状态: 运行中`、
  `URL: http://127.0.0.1:4789`、`LaunchAgent: 已安装，已加载`。
- `pnpm tether gateway stop` 停止后台 Gateway。
- `pnpm tether gateway uninstall` 删除 `~/Library/LaunchAgents/sh.tether.gateway.plist`。
- 结束后 `launchctl print gui/$(id -u)/sh.tether.gateway` 显示找不到 service，4789 端口无
  监听残留。

自动验证：通过。

```bash
pnpm typecheck
pnpm test
```

结果：

- `pnpm typecheck`：通过，8 个 workspace project 的 typecheck 全部完成。
- `pnpm test`：通过，relay 7/7、gateway 23/23、cli 4/4。

清理结果：

- 4915、4916、4789 端口无监听残留。
- `~/Library/LaunchAgents/sh.tether.gateway.plist` 不存在。
- 临时目录 `/tmp/tether-0605-smoke.jIuAGE` 已删除。
