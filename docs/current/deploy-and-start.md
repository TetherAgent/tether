# 部署与启动

本文只记录当前有效的 Tether CLI 启动方式。历史命令如 `tether gateway login`、
`tether codex`、`tether doctor`、`tether gateway logs` 已不再作为正式入口暴露。

## 本机最短路径

安装 CLI：

```bash
npm install -g @tether-labs/cli@latest
```

登录并绑定本机 Gateway：

```bash
tether login
```

启动后台 Gateway：

```bash
tether start
```

查看 Gateway 状态：

```bash
tether gateway status
```

启动 agent session：

```bash
tether run codex
tether run claude
tether run opencode
tether run copilot
tether run shell
```

provider 参数直接跟在 provider 后面：

```bash
tether run codex --resume <codex-session-id>
```

## Session 管理

```bash
tether ls
tether stop <id>
tether stop --all
```

## Gateway 管理

```bash
tether gateway
tether gateway start
tether gateway status
tether gateway restart
tether gateway stop
```

- `tether gateway`：打开 Gateway 管理交互菜单。
- `tether gateway start`：启动后台 Gateway。
- `tether gateway status`：查看 Gateway 状态。
- `tether gateway restart`：重启后台 Gateway。
- `tether gateway stop`：停止后台 Gateway。

## 登录与环境

默认登录生产环境：

```bash
tether login
```

本地开发登录：

```bash
tether login --env local
```

指定 Server：

```bash
tether login --server-url https://your-server.example.com
```

退出本机登录：

```bash
tether logout
```

## Debug

排查入口统一走交互菜单：

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

这些旧命令已经收进 `tether debug`，不要再写进新文档：

```bash
tether doctor
tether gateway logs
tether clients <id>
tether url <id>
tether send <id> <text>
```

## 仓库开发模式

在仓库里用 `pnpm tether ...`：

```bash
pnpm install
pnpm tether --help
pnpm tether login
pnpm tether start
pnpm tether run codex --resume <codex-session-id>
pnpm tether debug
```

## 正式命令表

```bash
tether login
tether logout

tether start
tether run codex [codexArgs...]
tether run claude [claudeArgs...]
tether run opencode [opencodeArgs...]
tether run copilot [copilotArgs...]
tether run shell
tether ls
tether stop <id>
tether stop --all

tether gateway
tether gateway start
tether gateway status
tether gateway restart
tether gateway stop

tether debug
```
