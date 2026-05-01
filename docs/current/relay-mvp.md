# Personal Relay MVP 部署说明

本文记录 Phase 1 Personal Relay MVP 的当前部署方式。目标拓扑是：

```text
本机 Tether Gateway -> 自托管 apps/relay Node 服务 -> nginx serve 的 apps/web
```

## 组件职责

- `apps/web` 是浏览器客户端。生产环境先运行 `pnpm web:build` 生成静态产物，再由 nginx serve。
- `apps/relay` 只运行 Node relay 服务，负责认证后的 WebSocket frame 转发。它不 serve `apps/web` 静态文件，不启动 agent，不执行命令，也不持久化终端明文。
- Gateway 是本机 session owner，负责已有 session、PTY 输入输出、事件 replay 和 resize。

## Relay 服务

Relay 服务读取共享 secret：

```bash
TETHER_RELAY_SECRET=<personal-secret> pnpm relay
```

默认端口由 `apps/relay` 控制，当前本地默认是 `4889`。生产部署时建议只把 relay 的
WebSocket/API 路径交给 Node 服务，例如：

- `/gateway`：Gateway outbound WebSocket 入口。
- `/client`：浏览器 relay mode WebSocket 入口。

## Web 静态部署

`apps/web` 不由 relay 进程托管。构建并交给 nginx serve：

```bash
pnpm web:build
```

nginx 应把浏览器页面、静态资源和 SPA fallback 指向 `apps/web` 的构建产物；relay 的
`/gateway` 和 `/client` 路径应反向代理到 `apps/relay` Node 服务。这样 Web 静态托管和
relay frame 转发职责保持分离。

## Gateway 连接 Relay

Gateway 使用 relay URL 和 secret 主动连到 relay：

```bash
pnpm tether run codex --no-attach --relay-url wss://relay.example.com/gateway --relay-secret <personal-secret>
```

也可以通过环境变量提供：

```bash
TETHER_RELAY_URL=wss://relay.example.com/gateway \
TETHER_RELAY_SECRET=<personal-secret> \
pnpm tether run codex --no-attach
```

## 浏览器使用

1. 在浏览器打开 nginx serve 的 `apps/web`。
2. 在页头的 Connection 设置里选择 `Relay`。
3. 输入 relay URL，例如 `wss://relay.example.com`。Web 客户端会连接该地址下的 `/client`。
4. 在 password input 中输入 relay secret。secret 只保存在浏览器 localStorage，并通过
   `client.auth` frame 发送，不进入 URL query/template。
5. 列表页通过 `client.list` 获取 session；进入 session 后通过 `client.subscribe`
   attach，通过 `client.input` 发送输入，通过 `client.resize` 同步终端尺寸。

## 安全边界

Phase 1 的 `TETHER_RELAY_SECRET` 是个人 MVP 共享 secret，只适合自托管、个人使用和可信
部署环境。完整 device-token pairing、设备授权、撤销和更细粒度的写权限校验属于 Phase 4。

在 Phase 1 中：

- relay 只转发认证后的协议 frame；
- relay 不接受 provider command/args/env；
- relay 不执行 shell 命令；
- relay 不持久化终端明文；
- remote Web 的 secret 不能放进 URL。
