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

本机启动后的判断顺序：

```bash
pnpm tether gateway doctor
pnpm tether gateway status
pnpm tether gateway providers
pnpm tether codex --no-attach
pnpm tether ls
```

看到 `Relay 连接: connected`，并且 `pnpm tether ls` 里出现 `running` session，说明 Mac
已经连到云端 Relay，浏览器应该可以通过 `https://relay.example.com` 看见 session。

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

实际使用时注意：

- HTTPS 页面必须填 `wss://...`，不能填 `ws://...`。否则浏览器会拦截，报
  `An insecure WebSocket connection may not be initiated from a page loaded over HTTPS`，
  网络面板里也不会出现 `/client` 请求。
- `Relay URL` 填 Relay 的 base URL，例如 `wss://relay.example.com`。不要手动加
  `/client` 或 `/gateway`，Web 会自动连接 `/client`。
- Gateway 配置里的 `relay.url` 也填 base URL，例如 `wss://relay.example.com`。Gateway
  会自动连接 `/gateway`。
- Secret 必须和服务器上的 `TETHER_RELAY_SECRET` 完全一致。
- 如果页面一直是 `No sessions`，先确认页面右上角状态不是 `Relay error`、
  `Relay disconnected` 或 `authentication failed`，再刷新页面。

用当前个人域名时，示例就是：

```text
Connection: Relay
Relay URL: wss://tether.earntools.me
Secret: <your-secret>
```

## 常用检查命令

Mac 上：

```bash
pnpm tether gateway status
pnpm tether gateway providers
pnpm tether gateway logs
pnpm tether gateway logs --stderr
pnpm tether gateway doctor
pnpm tether gateway verify --provider codex
pnpm tether ls
pnpm tether stop <session-id>
pnpm tether stop --all
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

如果更新了服务器代码或 Web：

```bash
cd /opt/tether
git pull
pnpm install
pnpm web:build
pm2 restart tether-relay --update-env
nginx -t
nginx -s reload
```

如果只改了 Web 文案或前端代码，也要重新 `pnpm web:build`，因为 nginx serve 的是
`apps/web/dist` 里的静态产物。

公网 WebSocket 检查：

```bash
curl -i \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://relay.example.com/gateway

curl -i \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://relay.example.com/client
```

正常情况下会看到：

```text
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
```

如果看到 `404 Not Found`，通常是 nginx/CDN/全球加速没有把 `/gateway` 或 `/client`
转发到 Relay。阿里云 CDN / ESA / Tengine / 全球加速前面有代理时，还要显式开启
WebSocket 支持，或者先让 DNS 直连源站验证。

如果 `curl http://127.0.0.1:4889/gateway` 返回 `404`，这是正常的；`/gateway` 和
`/client` 是 WebSocket upgrade 入口，不是普通 HTTP 页面。

## 日常使用流程

临时前台 Gateway，适合开发和看日志：

```bash
# 终端 1：保持打开
pnpm tether gateway

# 终端 2：创建远程可见 session，但不占住当前终端
pnpm tether codex --no-attach
```

然后打开：

```text
https://relay.example.com
```

后台 Gateway，适合日常长期使用：

```bash
pnpm tether gateway config \
  --host 127.0.0.1 \
  --port 4789 \
  --relay-url wss://relay.example.com \
  --relay-secret <your-secret> \
  --allow-api-session-create

pnpm tether gateway install
pnpm tether gateway start
pnpm tether gateway status
pnpm tether codex --no-attach
```

如果你希望后台 Gateway 不依赖 PATH 查找 `codex`，先写 provider 绝对路径：

```bash
pnpm tether gateway config --codex-command "$(command -v codex)"
pnpm tether gateway restart
```

如果之后想取消这个绝对路径配置：

```bash
pnpm tether gateway config --clear-codex-command
pnpm tether gateway restart
```

如果 `gateway status` 显示 `Relay 连接: connected`，并且 `pnpm tether ls` 里有
`running` session，说明本机已经推到 Relay。远程页面还看不到时，优先查 Web 页面填写
的 Relay URL 和 Secret。

## 已踩坑记录

- `ws://` 和 `wss://` 不一样：HTTPS 页面只能连 `wss://`。
- Relay URL 不带路径：填 `wss://relay.example.com`，不要填
  `wss://relay.example.com/client`。
- `curl http://127.0.0.1:4889/healthz` 返回 `ok` 只能说明 Relay 进程活着；公网还要单独
  验证 `https://域名/gateway` 和 `https://域名/client` 是否能返回
  `101 Switching Protocols`。
- `pnpm tether codex --no-attach` 返回 shell 是正常的；session 仍在 Gateway 后台跑。
- Web 页面上可以点单个 session 的“停止”，也可以点顶部“全部停止”；Relay 模式下会通过
  `/client` WebSocket 发停止请求到本机 Gateway。
- 终端里打印的 `http://127.0.0.1:4789/remote/session/...` 是本机 URL，不是公网 URL。
  公网 Web 统一打开 `https://relay.example.com`。
- `pnpm tether gateway` 前台运行时，关闭这个终端会停掉 Gateway；要长期运行用
  `pnpm tether gateway start`。
- launchd 后台 Gateway 会写入 `HOME` 和当前 `PATH`。如果 `gateway start` 能跑但
  `codex` 创建后马上失败，先 `pnpm tether gateway restart` 重写 plist；仍失败就用
  `pnpm tether gateway config --codex-command "$(command -v codex)"` 写绝对路径。
- 阿里云代理层返回头里如果有 `Via: ens-cache...`、`Server: Tengine`、
  `x-alicdn-da-ups-status`，说明请求经过了 CDN/全球加速。WebSocket 入口要确认代理层
  也开启并转发了 `/gateway` 和 `/client`。
- `pnpm tether gateway doctor` 里没配置、也没安装的可选 provider 会显示 `WARN`。例如你
  只用 `codex`，没有安装 `opencode`，这不是阻塞问题；如果你显式配置过某个 provider
  命令但找不到，才会显示 `FAIL`。
- `pnpm tether ls | head` 这种管道命令提前关闭输出时，CLI 会安静退出，不应该再打印
  `EPIPE` 堆栈。

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

## 最短排查路径

外网页面看不到 session 时，按这个顺序查：

```text
1. 云服务器：curl http://127.0.0.1:4889/healthz 是否 ok
2. 云服务器：pm2 status / pm2 logs tether-relay 是否正常
3. 公网：/gateway 和 /client WebSocket upgrade 是否返回 101
4. Mac：pnpm tether gateway doctor 是否只有 OK/WARN，没有 FAIL
5. Mac：pnpm tether gateway status 是否 Relay connected
6. Mac：pnpm tether codex --no-attach 是否创建 session
7. Mac：pnpm tether ls 是否能看到 running session
8. Web：Connection 选 Relay，Relay URL 填 wss://域名，Secret 和服务器一致
```

如果第 3 步失败，问题通常在 nginx、CDN、全球加速或证书，不在 Mac Gateway。  
如果第 4/5 步失败，问题通常在 Mac 本机配置、provider 命令或 Relay secret。  
如果第 6/7 步成功但 Web 看不到，优先查 Web 页面填写的 Relay URL 和 Secret。
