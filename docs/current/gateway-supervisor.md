# Gateway Supervisor 使用说明

本文记录当前本机 Gateway 日常使用方式。常规路径是先让常驻 Gateway 在 Mac 上运行，
再用 `tether run codex` / `tether run codex` 请求这个 Gateway 创建 session。Gateway 会为
每个 session 启动 detached session runner；runner 持有 PTY 和 provider child，Gateway
负责控制面、状态对账和 UI/Relay 转发。CLI 只负责发起请求和 attach，关闭 CLI 不应杀掉
session。

当前 `tether run codex` 不再内置启动 Gateway，也不再提供 `--host`、`--port`、`--inline`、
`--transport`、`--relay-url`、`--relay-secret`。找不到常驻 Gateway 时会直接提示先运行
`tether gateway start`。

## 大白话怎么用

如果你只是自己在这台 Mac 上用，记住这条主线：

```text
先让 Gateway 在后台跑着，然后平时直接 tether run codex。
```

第一次配置本机后台 Gateway：

```bash
pnpm tether gateway init
pnpm tether gateway start
pnpm tether gateway status
```

以后每天正常用：

```bash
pnpm tether run codex
```

这时 `codex` session 是由后台 Gateway 创建的，真正持有 PTY 的是单独的 session runner。
你关掉当前终端，session 不应该跟着死；Gateway 重启后也会重新 ping runner，能连上就继续
显示为 `running`，连不上才标记为 `lost`。

如果你只是想临时前台跑 Gateway 看日志，不想装后台：

```bash
pnpm tether gateway
```

然后另开一个终端：

```bash
pnpm tether run codex
```

`gateway start/restart` 写入 launchd plist 时会记录当前 `HOME` 和 `PATH`，让后台
Gateway 继承常见用户命令目录。

常用检查和清理：

```bash
pnpm tether gateway status    # 看后台 Gateway 有没有跑、PID、端口、Relay 状态
pnpm tether gateway providers # 看 codex/claude/opencode 实际用哪个命令启动
pnpm tether debug      # 看后台 Gateway 的 launchd 日志
pnpm tether debug    # 一次性诊断后台 Gateway、Relay、provider 命令
pnpm tether gateway verify --provider codex # 创建并停止一个验证 session
pnpm tether ls                # 看当前 sessions
pnpm tether stop <id>         # 关闭单个 session
pnpm tether stop --all        # 关闭所有 running session
pnpm tether gateway stop      # 停掉后台 Gateway
pnpm tether gateway uninstall # 删除登录启动
```

一句话区分：

- `pnpm tether gateway start`：让后台 Gateway 跑起来。
- `pnpm tether run codex`：开一个由后台 Gateway 管理、runner 持有 PTY 的 Codex session。
- `pnpm tether gateway status`：看现在到底跑没跑。

## 你现在该敲哪个命令

按场景选，不需要每次都全跑：

```bash
# 第一次在这台 Mac 上长期使用
pnpm tether gateway init
pnpm tether gateway start
pnpm tether debug

# 平时开一个远程可见的 Codex
pnpm tether run codex

# 只创建 session，不占住当前终端
pnpm tether run codex --no-attach

# 看当前有哪些 session
pnpm tether ls

# 关闭一个 session
pnpm tether stop <session-id>

# 全部关闭 running session
pnpm tether stop --all

# 看后台 Gateway 是否健康
pnpm tether gateway status
pnpm tether debug

# 看后台日志
pnpm tether debug

# 代码更新后让后台 Gateway 重新加载
pnpm tether gateway restart
```

`gateway doctor` 是最推荐的总检查命令。它会把常见问题分成 `OK`、`WARN`、`FAIL`：

- `OK`：这一项正常。
- `WARN`：提醒项，不一定阻塞。例如你没装 `opencode`，但也没打算用它。
- `FAIL`：需要处理。例如 Relay 没连上、API session creation 没开、配置过的 codex
  绝对路径找不到。

## 日常命令

```bash
tether gateway
tether gateway install
tether gateway start
tether gateway stop
tether gateway restart
tether gateway status
tether gateway providers
tether debug
tether debug
tether gateway verify --provider codex
tether gateway uninstall
tether run codex
tether run codex --project /path/to/project
tether run codex --no-attach
tether run codex -- --resume 99acd804-8250-43db-9503-884c1e7ca450
tether ls
tether stop <id>
tether stop --all
```

- `tether gateway`：前台运行 Gateway，适合开发、观察日志和手动验证。
- `tether gateway install`：注册 macOS LaunchAgent 登录启动，不立即启动。
- `tether gateway start`：通过 launchd 启动后台 Gateway；如果 plist 不存在会先写入。
- `tether gateway stop`：通过 launchd 停止后台 Gateway。
- `tether gateway restart`：通过 launchd 重启后台 Gateway。
- `tether gateway status`：输出中文状态，包含运行状态、PID、URL、配置路径、Host、
  Port、Relay 配置、Relay 连接、后台 PATH、Provider 命令和 LaunchAgent 状态。
- `tether gateway providers`：列出 `codex`、`claude`、`opencode` 的命令来源和实际命令；
  来源是 `配置` 表示来自 `~/.tether/config.json`，来源是 `PATH` 表示启动时再查 PATH。
- `tether debug`：查看后台 Gateway 的 launchd stdout/stderr 日志。可加
  `--stderr`、`--stdout` 或 `-f` 持续跟随。
- `tether debug`：诊断配置文件、LaunchAgent、Gateway API、Relay、provider
  命令和后台 PATH。未配置且未安装的可选 provider 会显示 `WARN`，不会让诊断失败；
  已显式配置但找不到的 provider 会显示 `FAIL`。
- `tether gateway verify --provider codex`：通过常驻 Gateway 创建一个短 session，再立即
  停止，用来验证 API session creation、provider 命令和 stop 链路。
- `tether gateway uninstall`：停止后台 Gateway 并移除 LaunchAgent。
- `tether run codex`：请求常驻 Gateway 创建 Codex session；实际 PTY 由 detached runner 持有，找不到 Gateway 会提示先运行 `tether gateway start`。
- `tether run codex --project /path/to/project`：让 Gateway 在指定项目目录创建 session。
- `tether run codex --no-attach`：只创建 session，不接入当前终端。
- `tether run codex -- <codex 参数...>`：`--` 后面的内容不再由 Tether 解析，会作为
  Codex 原生命令参数透传。例如 `tether run codex -- --resume <session-id>`。
- `tether ls`：列出已知 session。常见状态包括 `running`、`stopped`、`completed`、
  `failed`、`lost`。优先通过 Gateway 获取 runner-aware 状态；Gateway 不可用时才退回
  本地历史记录，并提示这些状态可能未对账。
- `tether stop <id>`：关闭指定 session。
- `tether stop --all`：关闭所有 `running` session，不删除历史记录。

仓库内开发时等价命令使用 `pnpm tether ...`，例如：

```bash
pnpm tether gateway status
pnpm tether run codex --no-attach
```

## 配置文件

Gateway 配置文件是 JSON：

```text
~/.tether/config.json
```

推荐先用 `tether gateway init` 初始化，再按需要手工调整 JSON。

配置解析优先级是：CLI flags > 环境变量 > `~/.tether/config.json` > 默认值。

`allowApiSessionCreate` 默认是 `false`。它关闭时，`POST /api/sessions` 会拒绝远程/API
创建 session；它开启后也仍然只允许 provider 白名单里的 `codex`、`claude` 和
`opencode`，不能接受任意 command/env/shell，也不是完整远程执行接口。Provider
原生命令参数只能通过受限的 `providerArgs` 字符串数组传入，Gateway 会用
`spawn(command, providerArgs)` 启动，不做 shell 拼接。

Provider 命令可选配置在：

```json
{
  "providers": {
    "codex": {
      "command": "/opt/homebrew/bin/codex"
    }
  }
}
```

推荐用 CLI 写入，不手改 JSON：

```bash
pnpm tether gateway config --codex-command "$(command -v codex)"
pnpm tether gateway config --claude-command "$(command -v claude)"
pnpm tether gateway config --opencode-command "$(command -v opencode)"
```

清除某个 provider 的绝对路径配置，让它重新回到 PATH 查找：

```bash
pnpm tether gateway config --clear-codex-command
pnpm tether gateway restart
```

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
当前工作目录里的 `pnpm tether`。plist 也会写入 `EnvironmentVariables`，包含 `HOME`
和安装/启动时的 `PATH`，避免 launchd 的极简环境找不到用户安装的 provider CLI。

## Session 创建安全边界

常驻 Gateway 的 session 创建 API 是受控本机能力，不是任意命令执行 API：

- 默认关闭，必须显式设置 `allowApiSessionCreate: true`。
- provider 必须在白名单内，目前是 `codex`、`claude`、`opencode`。
- request body 只接受 `provider`、`projectPath`、`cols`、`rows`。
- 不能接受任意 command/args/env、`shell`、`argv` 或 `providerCommand`。
- Gateway 默认绑定 `127.0.0.1`；暴露到局域网必须显式设置 `--host 0.0.0.0`。
- Phase 4/5 的多账户模型、Gateway startup auth、Relay WS auth、role authorization
  仍未在本阶段实现。
- Phase 6 的 retention、WAL checkpoint 和 event storage cleanup 仍未在本阶段实现。

## 本地验证

前台 Gateway + CLI 转发：

```bash
pnpm tether gateway config --host 127.0.0.1 --port 4789 --allow-api-session-create
pnpm tether gateway
pnpm tether run codex --no-attach
pnpm tether gateway status
pnpm tether ls
pnpm tether run codex --inline --no-attach
```

Gateway 重启恢复验证：

```bash
# 先允许 Gateway API 创建 session，并确保后台 Gateway 跑的是最新代码
pnpm tether gateway config --allow-api-session-create
pnpm tether gateway restart

# 创建一个不占住当前终端的 Codex session
pnpm tether run codex --no-attach
pnpm tether ls

# 从上一条输出里复制 session id
SESSION_ID=<session-id>

# 查看这个 session 对应的 runner pid 和 Unix socket
SESSION_ID=$SESSION_ID node -e "const Database=require('better-sqlite3'); const db=new Database(process.env.HOME+'/.tether/tether.db'); console.log(db.prepare('select id,status,runner_pid,runner_socket_path from sessions where id=?').get(process.env.SESSION_ID));"

# 重启 Gateway。预期：runner 不重启，session 仍是 running
pnpm tether gateway restart
pnpm tether ls

# 继续控制同一个 session
pnpm tether debug
pnpm tether attach "$SESSION_ID" --control
```

如果要验证 Gateway 被强杀后 runner 仍存活：

```bash
# 如果下面命令取不到 PID，就从 pnpm tether gateway status 输出里手动复制 PID
GATEWAY_PID=$(pnpm tether gateway status | awk '/PID/ {print $NF; exit}')
RUNNER_PID=$(SESSION_ID=$SESSION_ID node -e "const Database=require('better-sqlite3'); const db=new Database(process.env.HOME+'/.tether/tether.db'); const row=db.prepare('select runner_pid from sessions where id=?').get(process.env.SESSION_ID); console.log(row.runner_pid)")

ps -p "$RUNNER_PID" -o pid,command
kill -9 "$GATEWAY_PID"

# 预期：runner 进程还在
ps -p "$RUNNER_PID" -o pid,command

# 重新启动 Gateway 后，预期：同一个 session 仍可 attach / send / stop
pnpm tether gateway start
pnpm tether ls
pnpm tether attach "$SESSION_ID" --control
```

验证结束后清理：

```bash
pnpm tether stop "$SESSION_ID"
pnpm tether gateway status
```

远程 Relay 验证：

```bash
pnpm tether gateway config \
  --relay-url wss://relay.example.com \
  --relay-secret <personal-secret> \
  --allow-api-session-create

# 终端 1
pnpm tether gateway

# 终端 2
pnpm tether run codex --no-attach
pnpm tether gateway status
pnpm tether ls
```

`gateway status` 里看到 `Relay 连接: connected`，`tether ls` 里看到最新 session 是
`running`，说明本机 Gateway 已经连上 Relay。打开 Web 时填：

```text
Connection: Relay
Relay URL: wss://relay.example.com
Secret: <personal-secret>
```

如果页面是 HTTPS，Relay URL 必须是 `wss://`。填 `ws://` 会被浏览器直接拦截，不会
发出 `/client` 请求。

## 代码更新后怎么重启

仓库内开发或服务器代码更新后，本机后台 Gateway 不会自动加载新代码。更新依赖或代码后
执行：

```bash
pnpm install
pnpm tether gateway restart
pnpm tether debug
```

如果只是改了 Web 前端，还要重新 build 并让 nginx serve 新的 `apps/web/dist`。

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

- `tether run codex` 提示未检测到常驻 Gateway：先运行 `tether gateway status`，必要时用
  `tether gateway start` 启动后台 Gateway，或用 `tether gateway` 前台观察日志。
- 提示 API session creation 未启用：运行
  `tether gateway config --allow-api-session-create` 后重启 Gateway。
- 端口被非 Tether 服务占用：停止占用端口的进程，或用 `tether gateway config --port`
  改到明确的本机端口。
- Relay 已配置但未连接：先确认 Relay 服务和 secret，再看 `tether gateway status`
  里的 Relay 连接状态；Relay 断开不应阻止本地 session 创建。
- launchd 状态异常：运行 `tether gateway stop` 后再 `tether gateway start`；如果需要
  重建 plist，运行 `tether gateway uninstall` 再 `tether gateway install`。
- 后台 Gateway 能启动，但 `tether run codex --no-attach` 创建后马上失败：先运行
  `tether gateway status` 看 `后台 PATH` 和 `Provider 命令`。如果 PATH 不包含
  `/opt/homebrew/bin` 或 `/usr/local/bin`，运行 `tether gateway restart` 让 plist 重写
  当前 PATH；更稳妥的方式是运行
  `tether gateway config --codex-command "$(command -v codex)"` 后重启 Gateway。
- `tether run codex --no-attach` 打印 session 后立刻回到 shell：这是正常行为。它只创建
  session，不 attach 当前终端。用 `tether ls` 看状态，用 `tether attach <id> --control`
  接回本地控制，用 Web 远程控制。
- Web 页面看不到 session，但本机 `gateway status` 是 `Relay 连接: connected`：优先检查
  Web 页面是否填了 `wss://...`，Secret 是否一致，Connection 是否选 `Relay`。
- Web 页面报 `An insecure WebSocket connection may not be initiated from a page loaded over HTTPS`：
  把 Relay URL 从 `ws://...` 改成 `wss://...`。
- WebSocket curl 普通访问 `/gateway` 或 `/client` 返回 `404`：普通 HTTP 访问是正常 404，
  这两个路径必须带 WebSocket upgrade 头。真正验证要看是否返回
  `101 Switching Protocols`。
- 页面能打开但 `/gateway` 或 `/client` 公网返回 404：检查 nginx location 和 CDN/全球
  加速 WebSocket 支持。代理层必须把 `/gateway` 和 `/client` 转发到 Relay Node 服务。

## Verification

本节记录本文件对应计划的手工和自动验证结果。

### 2026-05-04 Gateway session runner recovery

自动验证：通过。

```bash
pnpm --filter @tether/gateway typecheck
pnpm --filter @tether/gateway test
pnpm --filter @tether/cli typecheck
pnpm --filter @tether/cli test
pnpm typecheck
pnpm test
git diff --check
```

结果：

- Gateway typecheck 通过。
- Gateway test 通过，43 个测试全部通过。
- CLI typecheck 通过。
- CLI test 通过。
- 全仓 `pnpm typecheck` 通过。
- 全仓 `pnpm test` 通过。
- `git diff --check` 通过。

本轮自动测试已经覆盖：

- detached session runner 脱离父进程后仍可 ping、write、subscribe events 和 stop。
- Gateway server 重启后，runner-backed session 仍为 `running`，HTTP input、CLI attach
  input、resize、stop 仍能控制同一 session。
- Store schema 迁移、runner metadata、多个 Store 实例写同一个 SQLite DB。
- Relay input / resize / stop 经 Gateway 转发到 runner。

尚待人工验证：

- macOS launchd `gateway restart` 后 runner 和 provider child 仍存活。
- 手工 `kill -9` Gateway 后 runner 和 provider child 仍存活。
- WebSocket UI 重连后能看到旧输出并继续收到新输出。
- `doctor` 或后续 runner 诊断命令展示 stale socket / pid。

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
  pnpm tether run codex --inline --port 4916 --project /tmp/tether-0605-smoke.jIuAGE/project --no-attach
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
- `pnpm tether run codex --inline --no-attach` 输出“已启用 inline 模式”，并在 4916 端口启动
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
