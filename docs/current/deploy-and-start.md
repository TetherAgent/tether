# Tether 部署和启动说明

这份文档只讲怎么部署、怎么启动。当前推荐拓扑是：

```text
你的 Mac：Gateway + Codex/Claude session
你的云服务器：Relay Node 服务 + nginx + Web 静态页面
浏览器/手机：打开 Web，通过 Relay 连回 Mac Gateway
```

## 你要部署哪些东西

云服务器上部署两个东西：

- `apps/relay`：Node relay 服务，只负责转发 WebSocket frame。
- `apps/web`：Web 前端，先 build 成静态文件，再用 nginx serve。

你的 Mac 上部署一个东西：

- `tether gateway`：常驻 Gateway，负责真正启动和持有 Codex/Claude/opencode session。

不要把 Gateway 部署到云服务器。Gateway 要跑在你自己的电脑上，因为它要控制你本机的
终端和 agent 进程。

## 本地开发启动

在仓库根目录安装依赖：

```bash
pnpm install
```

本地模拟三端：

```bash
# 终端 1：Relay
TETHER_RELAY_SECRET=dev-secret pnpm relay

# 终端 2：本机 Gateway + Codex
pnpm tether gateway config --host 127.0.0.1 --port 4789 \
  --relay-url ws://127.0.0.1:4889 \
  --relay-secret dev-secret \
  --allow-api-session-create
pnpm tether gateway start
pnpm tether codex

# 终端 3：Web
pnpm web:dev
```

浏览器打开：

```text
http://localhost:5173
```

页面里填：

```text
Connection: Relay
Relay URL: ws://127.0.0.1:4889
Secret: dev-secret
```

## 云服务器部署

以下以阿里云一台 Node 服务器为例。服务器只跑 Relay 和 Web，不跑 Gateway。

### 1. 准备代码和依赖

```bash
git clone <your-repo-url> tether
cd tether
pnpm install
pnpm web:build
```

### 2. 启动 Relay

先用前台方式验证：

```bash
TETHER_RELAY_SECRET=<your-secret> pnpm relay
```

看到类似输出即可：

```text
Tether Relay: http://127.0.0.1:4889
```

生产环境推荐用 PM2 常驻。先确认服务器已经有 PM2：

```bash
npm install -g pm2
```

在仓库目录启动 Relay：

```bash
cd /opt/tether
TETHER_RELAY_SECRET=<your-secret> pm2 start pnpm --name tether-relay -- relay
pm2 save
pm2 startup
```

`pm2 startup` 会打印一条需要 sudo 执行的命令，复制执行一次即可。之后服务器重启后，
PM2 会自动恢复 `tether-relay`。

常用 PM2 命令：

```bash
pm2 status
pm2 logs tether-relay
pm2 restart tether-relay
pm2 stop tether-relay
pm2 delete tether-relay
```

更新代码后重启：

```bash
cd /opt/tether
git pull
pnpm install
pnpm web:build
pm2 restart tether-relay --update-env
```

如果要修改 relay secret：

```bash
pm2 delete tether-relay
TETHER_RELAY_SECRET=<new-secret> pm2 start pnpm --name tether-relay -- relay
pm2 save
```

### 3. nginx 配置

nginx 负责两件事：

- serve Web 静态文件。
- 把 `/gateway` 和 `/client` 反向代理到 Relay Node 服务。

示例：

```nginx
server {
  listen 80;
  server_name relay.example.com;

  root /opt/tether/apps/web/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /gateway {
    proxy_pass http://127.0.0.1:4889/gateway;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location /client {
    proxy_pass http://127.0.0.1:4889/client;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

配好 HTTPS 后，外部地址就是：

```text
wss://relay.example.com
```

注意：页面和 Gateway 都填 base URL，不要手动加 `/gateway` 或 `/client`。

## Mac 上启动 Gateway

第一次配置：

```bash
pnpm tether gateway config \
  --host 127.0.0.1 \
  --port 4789 \
  --relay-url wss://relay.example.com \
  --relay-secret <your-secret> \
  --allow-api-session-create
```

安装登录启动，并立即启动后台 Gateway：

```bash
pnpm tether gateway install
pnpm tether gateway start
pnpm tether gateway status
```

以后每天开 agent：

```bash
pnpm tether codex
```

或者：

```bash
pnpm tether run claude
pnpm tether run opencode
```

如果只是调试旧模式：

```bash
pnpm tether codex --inline
```

## 浏览器怎么连

打开你的 Web 地址：

```text
https://relay.example.com
```

页面里填：

```text
Connection: Relay
Relay URL: wss://relay.example.com
Secret: <your-secret>
```

如果 Mac 上 Gateway 已经连上 Relay，并且已经有 session，页面应该能看到 session 列表。

## 常用检查命令

Mac 上：

```bash
pnpm tether gateway status
pnpm tether ls
pnpm tether gateway stop
pnpm tether gateway restart
pnpm tether gateway uninstall
```

云服务器上：

```bash
curl http://127.0.0.1:4889/healthz
pm2 status
pm2 logs tether-relay
nginx -t
```

## 安全边界

- Relay 只转发，不执行命令。
- Gateway 跑在你自己的 Mac 上，不要部署到云服务器。
- `allowApiSessionCreate` 默认关闭；打开后也只能创建白名单 provider：`codex`、`claude`、`opencode`。
- 当前 Phase 4 的 device token / pairing 还没做完，不要把 Gateway 直接暴露到公网。
- 公网入口只暴露 nginx + Relay，不暴露 Mac Gateway 的 `4789` 端口。

## 最短路径

如果你只想先跑通外网：

```text
1. 云服务器：pnpm install && pnpm web:build
2. 云服务器：TETHER_RELAY_SECRET=<secret> pm2 start pnpm --name tether-relay -- relay
3. 云服务器：pm2 save && pm2 startup
4. 云服务器：nginx serve apps/web/dist，并代理 /gateway /client 到 127.0.0.1:4889
5. Mac：pnpm tether gateway config --relay-url wss://你的域名 --relay-secret <secret> --allow-api-session-create
6. Mac：pnpm tether gateway start
7. Mac：pnpm tether codex
8. 浏览器：https://你的域名，Relay URL 填 wss://你的域名，Secret 填同一个 secret
```
