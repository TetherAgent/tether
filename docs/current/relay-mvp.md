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
pnpm tether run codex --no-attach --relay-url wss://relay.example.com --relay-secret <personal-secret>
```

也可以通过环境变量提供：

```bash
TETHER_RELAY_URL=wss://relay.example.com \
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

## 本地启动验证

本地验证使用 3 个终端模拟生产拓扑：

```text
Terminal 1: apps/relay
Terminal 2: Gateway + agent session
Terminal 3: apps/web Vite dev server
```

### 1. 启动 Relay

Terminal 1：

```bash
TETHER_RELAY_SECRET=dev-secret pnpm relay
```

期望看到类似输出：

```text
Tether Relay: http://127.0.0.1:4889
```

可选健康检查：

```bash
curl http://127.0.0.1:4889/healthz
```

期望输出：

```text
ok
```

### 2. 启动 Gateway session 并连接 Relay

Terminal 2：

```bash
TETHER_RELAY_URL=ws://127.0.0.1:4889 \
TETHER_RELAY_SECRET=dev-secret \
pnpm tether run codex --no-attach
```

也可以把 `codex` 换成：

```bash
pnpm tether run claude --no-attach
pnpm tether run opencode --no-attach
```

本地 `TETHER_RELAY_URL` 填 relay base URL 即可，不要加 `/gateway`。Gateway 会自动连接
`/gateway`。

### 3. 启动 Web

Terminal 3：

```bash
pnpm web:dev
```

打开 Vite 输出的本地地址，通常是：

```text
http://localhost:5173
```

Vite 会把 direct mode 的 `/api` 代理到本地 Gateway `http://127.0.0.1:4789`。
Relay mode 不走这个代理，而是直接连你填写的 relay URL。

### 4. 在浏览器里验证 Relay mode

在 Web 页头设置：

- `Connection` 选择 `Relay`
- `Relay URL` 填 `ws://127.0.0.1:4889`
- `Secret` 填 `dev-secret`

然后检查：

1. session 列表能显示 Terminal 2 启动的 session。
2. 点击 session 后能进入 terminal 页面。
3. 页面能看到 agent 输出或 shell/TUI 输出。
4. 在 terminal 里输入内容，输入能到达本机 Gateway 持有的 PTY。
5. 调整浏览器窗口大小，terminal resize 不报错。
6. 切到 `Observe` 后，输入应被拒绝，不应写入 PTY。
7. 切回 `Control` 后，输入恢复。

### 5. 本地自动检查

改动后建议至少跑：

```bash
pnpm --filter @tether/relay test
pnpm --filter @tether/gateway test
pnpm --filter @tether/web typecheck
pnpm typecheck
pnpm test
```

当前 Phase 1 自动覆盖重点：

- relay 拒绝未认证 socket；
- relay 只转发已认证、已订阅、control mode 的 input/resize；
- relay 拒绝 command/args/env/providerCommand 形状的 frame；
- Gateway relay client 能注册 session、replay output、转发 live output/input/resize；
- direct WS 和 relay path 都拒绝 observe/unsubscribed/stale-controller 写入；
- 非法 resize 不会传入 `node-pty.resize()`；
- Gateway relay URL 保留 `wss://`，不会重复追加 `/gateway`。

### 6. 上服务器验证

服务器上运行：

```bash
TETHER_RELAY_HOST=0.0.0.0 \
TETHER_RELAY_PORT=4889 \
TETHER_RELAY_SECRET=<personal-secret> \
pnpm relay
```

本机 Gateway 使用公网 relay base URL：

```bash
TETHER_RELAY_URL=wss://relay.example.com \
TETHER_RELAY_SECRET=<personal-secret> \
pnpm tether run codex --no-attach
```

Web 页面同样填写：

```text
wss://relay.example.com
```

不要填写 `/gateway` 或 `/client`。Gateway 会自动追加 `/gateway`，Web 会自动追加 `/client`。

## 安全边界

Phase 1 的 `TETHER_RELAY_SECRET` 是个人 MVP 共享 secret，只适合自托管、个人使用和可信
部署环境。完整 device-token pairing、设备授权、撤销和更细粒度的写权限校验属于 Phase 4。

在 Phase 1 中：

- relay 只转发认证后的协议 frame；
- relay 不接受 provider command/args/env；
- relay 不执行 shell 命令；
- relay 不持久化终端明文；
- remote Web 的 secret 不能放进 URL。

## Verification

### 2026-05-01

已运行：

- `pnpm --filter @tether/protocol typecheck`：通过。
- `pnpm --filter @tether/relay test`：通过，7 个测试通过。
- `pnpm --filter @tether/gateway test`：通过，19 个测试通过。
- `pnpm --filter @tether/web typecheck`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过。

local E2E：

- 启动 `apps/web` Vite dev server，确认 Vite 输出的本地地址可 serve Web 页面。
- 在本地进程内启动 Relay、Gateway relay client 和 `/bin/cat` PTY session。
- 使用 remote client WebSocket 连接 relay `/client`，验证 `client.auth`、`client.list`、
  `client.subscribe`、terminal output replay/live output、`client.input` 和 `client.resize`
  均通过。
- 未做人工浏览器点击确认；当前仓库没有浏览器自动化依赖。本次 smoke 覆盖了 Web dev
  serve 和 relay frame 路径。

server E2E not run：当前环境没有提供真实 Node server 的 `TETHER_RELAY_URL` 和
`TETHER_RELAY_SECRET`，无法连接用户服务器重复验证。
