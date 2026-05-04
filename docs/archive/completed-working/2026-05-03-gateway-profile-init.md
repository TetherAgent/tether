# Gateway Profile / Init 启动模型方案（归档）

状态：Completed Archive  
归档时间：2026-05-04  
说明：本文原为 `docs/working/` 启动模型方案。当前启动与部署口径以 `docs/current/deploy-and-start.md` 为准。

状态：Working  
创建时间：2026-05-03  
范围：`apps/cli`、`apps/gateway`、`apps/relay`、`apps/web`、`packages/config`

## 背景

当前 Gateway 启动心智仍偏底层：

- `tether gateway config --host ... --relay-url ... --allow-api-session-create`
- `tether gateway install`
- `tether gateway start`

这里混在一起的其实是三类事情：

1. 选择连接模式：本机开发、局域网直连、Relay 远程。
2. 初始化本机配置：端口、provider 命令、账号绑定、Relay 地址。
3. 安装后台服务：写 macOS LaunchAgent plist。

用户目标是不要长期记一堆参数。参数只应该在初始化时出现，日常只使用清晰的模式命令。

## 已确认结论

### 1. 启动模式收敛成 local / direct / relay

日常启动只保留一个入口：

```bash
pnpm tether gateway start
```

执行后在交互里选择 `local` / `direct` / `relay`。

含义固定：

| 模式 | 用途 | Gateway 监听 | Relay |
| --- | --- | --- | --- |
| `local` | 本机开发、本机 Web/Vite 代理 | `127.0.0.1:4789` | 不启用 |
| `direct` | 真实局域网直连，远程 Web 页面由浏览器直接连本机 Gateway | `0.0.0.0:4789`，对外展示 LAN IP | 不启用 |
| `relay` | 公网远程控制，浏览器无法直接访问本机 Gateway | 默认 `127.0.0.1:4789` | 启用 |

直连不是 Relay 转发。直连链路是：

```text
远程 Web 页面
  -> 浏览器直接访问 http://Mac局域网IP:4789/api/...
  -> 浏览器直接访问 ws://Mac局域网IP:4789/api/sessions/:id/stream
```

Relay 链路是：

```text
Gateway -> wss://tether.earntools.me/gateway
Web     -> wss://tether.earntools.me/client
Relay   -> 只转发认证后的协议 frame
```

Gateway 不是靠一个模式字段区分直连/Relay，而是靠连接入口区分：

- 进 `/api/...` HTTP/WS 接口的是 direct。
- 进 Gateway 主动建立的 Relay socket 的是 relay。

### 2. `install` 不做配置初始化，应新增 `init`

现有 `tether gateway install` 的真实职责是：

- 写入 `~/Library/LaunchAgents/sh.tether.gateway.plist`
- 创建 `~/.tether/logs`
- plist 中固定启动 `tether gateway`
- 不启动 Gateway
- 不写 `~/.tether/config.json`
- 不做 `gateway login`
- 不选择 `local/direct/relay`

因此 `install` 应继续只表示“安装系统后台服务”，不应承载连接模式初始化。

新增：

```bash
pnpm tether gateway init
```

`init` 负责一次性配置：

- 选择默认 profile：`local` / `direct` / `relay`
- 写入 `~/.tether/config.json`
- 写入 Server URL：本地开发用本地 Server，真实直连/Relay 用正式 Server
- 必要时引导 `gateway login`
- Relay 模式默认填入 Relay URL
- 配置 provider 命令路径

命令语义边界：

| 命令 | 语义 |
| --- | --- |
| `gateway init` | 初始化 Tether Gateway 配置 |
| `gateway install` | 安装 macOS 后台服务 |
| `gateway` | 交互选择 `local` / `direct` / `relay` 后前台启动 Gateway |
| `gateway start` | 交互选择 `local` / `direct` / `relay` 后启动后台服务；如果 LaunchAgent 尚未安装，先自动安装并提示 |
| `gateway stop` | 停止后台服务 |

`gateway config` 不再保留。配置入口统一收敛到 `gateway init`，避免用户在 `config --host/--relay-url/--allow-api-session-create` 和 profile 模型之间来回切换。Provider 命令路径后续也应由 `gateway init` 或专门的 provider 管理入口处理，而不是继续挂在 `gateway config` 下。

`gateway` 和 `gateway start` 的选择提示必须解释三个模式，帮助用户选对：

```text
local  - 开发人员本机调试：只监听 127.0.0.1，不给局域网访问
direct - 局域网直连：监听 0.0.0.0，浏览器直接连本机 Gateway，不走 Relay
relay  - 公网远程：本机 Gateway 主动连接 Relay，适合不在同一局域网时使用
```

其中 `local` 是开发人员备用模式，不作为真实用户远程使用路径。

### 3. 配置文件改成 profile 结构

目标配置：

```json
{
  "defaultProfile": "direct",
  "server": {
    "url": "https://tether.earntools.me"
  },
  "profiles": {
    "local": {
      "server": {
        "url": "http://127.0.0.1:4800"
      },
      "gateway": {
        "host": "127.0.0.1",
        "port": 4789,
        "allowApiSessionCreate": true
      }
    },
    "direct": {
      "gateway": {
        "host": "0.0.0.0",
        "port": 4789,
        "allowApiSessionCreate": true
      }
    },
    "relay": {
      "gateway": {
        "host": "127.0.0.1",
        "port": 4789,
        "allowApiSessionCreate": true
      },
      "relay": {
        "url": "wss://tether.earntools.me"
      }
    }
  },
  "providers": {
    "codex": {
      "command": "codex"
    }
  }
}
```

`providers` 继续全局保存，因为 provider binary 路径与连接模式无关。

`server.url` 是 `gateway login`、Gateway token introspection 和 Relay token 校验使用的远程控制面地址：

- `local` profile 默认覆盖成 `http://127.0.0.1:4800`，用于本机开发。
- `direct` profile 默认继承全局 `https://tether.earntools.me`。
- `relay` profile 默认继承全局 `https://tether.earntools.me`。

后续 `gateway login` 默认读取当前 profile resolved 出来的 Server URL，不再要求用户每次传 `--server-url`。`--server-url` 可以保留为高级覆盖参数，但不是日常入口。

旧配置字段短期兼容读取：

```json
{
  "gateway": {},
  "relay": {},
  "providers": {}
}
```

写入时优先写新结构。

### 4. Relay URL 默认值

正式默认 Relay URL：

```text
wss://tether.earntools.me
```

`gateway init` 选 `relay` 时默认显示这个值，用户可回车确认。

### 5. 正式 Relay 不再要求用户填 secret

已有账号登录体系后，正式 Relay 不应再暴露 shared secret：

- Web 登录后持有 `normal_client_access`
- Gateway 登录后持有 `gateway_access`
- Relay 接收 Gateway / Web client token 后向 Server 校验
- Relay 按 `accountId` / `workspaceId` / `gatewayId` / `sessionId` 做路由和隔离

`secret` 是 Personal Relay MVP 的 bootstrap 口径，只适合本地开发或私有调试。正式产品不在 `init` 和 Web UI 中暴露。

推荐保留 dev-only fallback：

```bash
TETHER_RELAY_SECRET=xxx pnpm tether gateway start
```

保留原因：

- 本地开发 Relay 时，可以不先启动完整 Server token 鉴权链路，直接验证 Relay WS 通道和 frame 转发。
- 线上 token 鉴权出问题时，可以快速判断问题在 Relay 通道还是 auth 校验。
- 兼容历史 Personal Relay MVP，避免一次性删除旧调试路径导致排障困难。

这个 fallback 只作为隐藏开发参数，不进入正式用户 UI、不写入默认配置、不出现在正式启动文档里。等 token-based Relay 鉴权稳定后，可以彻底删除 shared secret fallback。

### 6. 登录与连接模式的关系

`gateway login` 不是 Relay。

`gateway login` 只负责让本机 Gateway 获取账号绑定凭据，写入 `~/.tether/auth.json`，用于：

- Gateway 校验 Web 带来的 normal token
- Gateway 签发浏览器 WS ticket
- Gateway / Relay 确认 session 属于同一 account/workspace/user/gateway

是否走 Relay 由连接入口决定：

```text
direct：浏览器 -> Mac Gateway
relay：浏览器 -> Relay -> Mac Gateway
```

登录后的 direct 仍不走 Relay，但 Gateway 可能会向 Server 调 `/api/token/validate` 做鉴权。

启动前登录检查规则：

- `local`：开发人员本机调试模式，不强制检查 `auth.json`。
- `direct`：前台 `gateway` 或后台 `gateway start` 选择 direct 时，先检查 `~/.tether/auth.json`；缺失或 access token 过期时直接进入 `gateway login` 提示。
- `relay`：前台 `gateway` 或后台 `gateway start` 选择 relay 时，先检查 `~/.tether/auth.json`；缺失或 access token 过期时直接进入 `gateway login` 提示。

## 目标用户流程

### 本机开发

```bash
pnpm tether gateway init
pnpm tether gateway start
pnpm dev:web
```

Web 打开：

```text
http://127.0.0.1:4790
```

### 真实局域网直连

```bash
pnpm tether gateway init
pnpm tether gateway start
```

CLI 输出：

```text
Gateway 模式: direct
本机地址: http://127.0.0.1:4789
局域网地址: http://192.168.x.x:4789
Web 直连地址: http://192.168.x.x:4789
Relay: 未启用
```

远程 Web 中选择：

```text
连接方式: 直连
Gateway 地址: http://192.168.x.x:4789
```

### 公网 Relay

```bash
pnpm tether gateway init
pnpm tether gateway start
```

CLI 输出：

```text
Gateway 模式: relay
本机地址: http://127.0.0.1:4789
Relay: wss://tether.earntools.me
Relay 状态: connecting / connected
```

Web 中选择：

```text
连接方式: Relay
Relay 地址: wss://tether.earntools.me
```

不再要求用户输入 Relay secret。

## Web 侧配合

直连模式需要新增 Gateway 地址配置，不能继续固定用同源 `/api/...`。

直连模式：

```text
Gateway 地址: http://192.168.x.x:4789
```

请求目标：

```text
http://192.168.x.x:4789/api/...
ws://192.168.x.x:4789/api/sessions/:id/stream
```

Relay 模式：

```text
wss://tether.earntools.me/client
```

Web 应保存上次成功的 direct Gateway 地址到 localStorage，避免每次手填。

## 影响面

### `packages/config/src/index.ts`

- 增加 `defaultProfile` / `profiles` 配置结构。
- 支持按 profile resolve Gateway / Relay 配置。
- 兼容旧 `gateway` / `relay` 字段读取。
- 写入新配置时使用 profile 结构。

### `apps/cli/src/main.ts`

- 新增 `gateway init`。
- `gateway` 无子命令时也交互选择 `local` / `direct` / `relay`，然后前台启动。
- `gateway start` 通过 launchd 启动前让用户选择 `local` / `direct` / `relay`，并解释三个模式；如果 LaunchAgent 未安装，先自动安装并明确提示。
- 删除 `gateway config` 子命令；配置只通过 `gateway init` 写入。
- 底层 `--host` / `--port` / `--relay-url` / `--relay-secret` 不作为日常入口。

### `apps/cli/src/launchd.ts`

- LaunchAgent 仍只负责后台运行。
- plist 启动命令应走默认 profile，例如 `tether gateway` 或显式 `tether gateway run --profile <defaultProfile>`。
- `install` 不写业务配置。

### `apps/gateway/src/daemon.ts`

- 继续接收最终 resolved options。
- `/api/status` 可增加 `profile` / `mode`，便于 Web 和 CLI 展示。

### `apps/relay`

- 正式 Relay 鉴权改成 token-based。
- shared secret 仅保留 dev-only fallback，不作为正式 client auth。

### `apps/web`

- direct 模式增加 `Gateway 地址`。
- direct HTTP / WS 基于 Gateway 地址构造 URL。
- Relay URL 默认 `wss://tether.earntools.me`。
- 正式 UI 不再显示 Relay secret。

### 文档

- `docs/current/deploy-and-start.md`、`docs/current/gateway-supervisor.md`、`docs/current/relay-mvp.md`
  后续实现后需要同步更新，删除正式流程里的 `gateway config --host ...`、`gateway config --codex-command ...` 和 `Relay Secret`。
- `relay-mvp.md` 中 shared secret 继续保留为历史 bootstrap 说明，不作为当前正式路径。

## 待定问题

- `gateway init` 是否必须交互，还是也支持 `--profile direct --yes` 供脚本化安装。
- 远程 HTTPS Web 访问局域网 HTTP Gateway 会遇到 mixed content；真实环境可能需要局域网 HTTPS Gateway 或反代。
- Relay token 校验是否由 Relay 直接请求 Server `/api/token/validate`，还是引入更专用的 Relay introspection endpoint。
- Provider 命令路径未来是纳入 `gateway init`，还是拆成 `gateway provider` 子命令。
