# Gateway Supervisor 使用说明

本文记录当前本机 Gateway 的日常使用方式。常规路径是先登录并启动本机 Gateway，
再用 `tether run <provider>` 创建由 Gateway 托管的 agent session。

Gateway 负责控制面、状态对账和 UI / Relay 转发；每个 session 由 detached runner
持有 PTY 和 provider child。CLI 只负责发起请求和接入当前终端。

## 最短路径

首次使用：

```bash
tether login
tether start
tether status
```

日常启动 Codex：

```bash
tether run codex
```

启动其他 provider：

```bash
tether run claude
tether run opencode
tether run copilot
tether run shell
```

直接透传 provider 参数：

```bash
tether run codex --resume <codex-session-id>
```

查看和停止 session：

```bash
tether ls
tether stop <id>
tether stop --all
```

## Gateway 管理

```bash
tether start
tether status
tether restart
tether stop
```

- `tether start`：启动后台 Gateway。
- `tether status`：查看 Gateway 状态。
- `tether restart`：重启后台 Gateway。
- `tether stop`：停止后台 Gateway。

`tether stop <id>` 和 `tether stop --all` 用于停止 session；不带参数的 `tether stop`
只停止后台 Gateway。

## 登录

```bash
tether login
tether logout
```

- `tether login`：在浏览器中授权，将本机 Gateway 绑定到远程 Server，并写入本机 auth。
- `tether logout`：删除本机 Gateway 登录凭据，不解绑服务端 Gateway。

本地开发登录：

```bash
tether login --env local
```

指定 Server：

```bash
tether login --server-url https://your-server.example.com
```

## Debug 菜单

旧的零散排查命令已收进交互菜单：

```bash
tether debug
```

菜单项：

```text
1. 全面诊断环境
2. 查看 Gateway 日志
3. 查看 session 客户端
4. 打印 session URL
5. 向 session 发文本
```

以下入口不再作为正式命令暴露，统一收进 `tether debug` 或顶层 Gateway 命令：

```bash
tether doctor
tether clients <id>
tether url <id>
tether send <id> <text>
```

## 当前正式命令表

```bash
tether login
tether logout

tether start
tether status
tether restart
tether run codex [codexArgs...]
tether run claude [claudeArgs...]
tether run opencode [opencodeArgs...]
tether run copilot [copilotArgs...]
tether run shell
tether ls
tether stop <id>
tether stop --all

tether debug
```

## 删除的旧短入口

以下 provider 快捷命令已经删除，统一改用 `tether run <provider>`：

```bash
tether codex
tether claude
tether opencode
tether copilot
```

旧的 Gateway 命名空间入口已经删除；登录、启动、状态、重启、停止都使用顶层命令。

## 仓库内开发

仓库内开发时在命令前加 `pnpm`：

```bash
pnpm tether login
pnpm tether start
pnpm tether run codex --resume <codex-session-id>
pnpm tether run shell --title "Terminal"
pnpm tether debug
```
