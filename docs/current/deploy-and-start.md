# 部署与启动

本文只记录当前有效的 Tether CLI 启动方式。旧的 Gateway 命名空间入口、provider
快捷入口和零散 debug 命令已不再作为正式入口暴露。

## 云服务器自动部署

仓库通过 GitHub Actions 调用服务器上的 `deploy/deploy.sh` 完成部署。

自动触发：

```text
push 到 main 分支后，自动在服务器执行：
bash deploy/deploy.sh main all
```

手动触发：

```text
GitHub Actions -> Deploy -> Run workflow
```

手动触发时可以选择：

```text
all       部署 server + relay + web + admin
backend   部署 server + relay
web       部署 web + admin
server    只部署 server
relay     只部署 relay
web-only  只部署 web
admin     只部署 admin-web
```

GitHub 仓库需要配置这些 Actions secrets：

```text
SERVER_HOST         服务器 IP 或域名
SERVER_USER         SSH 用户
SERVER_SSH_KEY      SSH 私钥
SERVER_PORT         SSH 端口
SERVER_DEPLOY_PATH  服务器上的仓库目录，默认 /data/tether
```

服务器侧前置条件：

```bash
cd /data/tether
git remote -v
pnpm install
bash deploy/deploy.sh main all
```

确认手动命令可用后，再启用 GitHub Actions 自动部署。

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
tether status
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

这些旧 debug 命令已经收进 `tether debug`，不要再写进新文档：

```bash
tether doctor
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
