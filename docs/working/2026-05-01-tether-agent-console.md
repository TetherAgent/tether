# Tether：Agent 控制台（草稿）

> **状态**：Working / 立项前调研。
> **代号**：tether（"拴绳"——多端拴在同一个 agent 会话上）
> **代码仓库**：`/Users/dream/code/tether`（已初始化 Phase 1 demo 与 pnpm workspace 雏形）
> **设计基座参考**：`/Users/dream/code/github/codex_manager`（仅作设计参考）
> **高级能力对标**：`/Users/dream/code/github/paseo`
>
> 本文记录目标、调研结论、阶段规划与每阶段边界。待评审后转成 GSD 阶段计划。

## 0. 命名

`tether`：拴绳。一根绳两头拴——一头是电脑命令行，一头是手机；中间是同一个 agent 会话。也可以拴更多设备（多机、Web）到同一会话上。

CLI 二进制名 `tether`：

```
tether codex
tether ls
tether attach <id>
tether send <id> "继续"
```

## 1. 产品定位

**Tether 是 Agent 控制台，不是 IDE。**

- IDE 的核心是"在哪里编辑代码"
- Tether 的核心是"在哪里和我的 agent 通话"
- 代码编辑由 agent 执行；用户负责审阅、引导、批准、调度

类比：
- 不是 Photoshop（你亲自操作工具）
- 更像**手机的通知中心 + 后台任务管理器**——agent 是后台任务，用户随时查看 / 接管 / 调度

明确**不**做的事：
- 不替代 VS Code / Cursor
- 不做完整代码编辑器
- 不和 IDE 竞争

明确**做**的事：
- 让用户在任何设备上和正在跑的 agent 同步对齐
- 让用户能从任何设备审阅 agent 做了什么、批准它要做什么
- 长期目标：**像管 app 一样管 agent**

## 2. 总体目标

把"用户直接运行 `codex`"包装成"由 daemon 托管的 agent 会话"，让任意设备同步看同一会话。

链路：

```
电脑 CLI          手机 PWA          Web 客户端
   ↓                ↓                  ↓
        Tether Daemon
              ↓
     agent 进程（codex / claude / ...）
```

核心要求：

1. 多设备连同一会话
2. 任意设备输入回写到 agent
3. 任意设备输出同步到所有客户端
4. 客户端断开后 agent 不退出
5. 客户端可重新接入
6. 长期：跨机器、多 agent、可调度

## 3. 仓库现状调研

### 3.1 codex_manager（设计参考）

- **不是 wrapper，是观察器**：通过 `subprocess.Popen` 跑 `codex exec resume`，**不使用 tmux**。
- 数据来源是 `~/.codex/conversations/*.jsonl` 这种事后日志文件。
- 已有资产：raw `http.server` + `/remote` 移动页 + auth/CSRF + SQLite alias DB + 守护线程 + SSH 远端自举。
- 没有：tmux、WebSocket、PTY、event stream、provider 抽象。
- **复用边界**：仅作为 README 风格、`/remote` 交互思路、auth 模型的文档级参考。代码语言不同（Python vs Node），不复用代码。

### 3.2 paseo（对标）

- TS monorepo（`packages/cli`、`packages/server`、`packages/desktop`、`packages/app`、`packages/relay`）。
- 用 Node `child_process` spawn agent CLI，**不用 tmux**。
- **核心抽象**：timeline event stream。所有输出序列化为 `AgentStreamEvent`，落盘 `$PASEO_HOME/agents/{project}/{agentId}.json`。
- WebSocket 二进制多路复用：channel 0 = 控制，channel 1+ = 终端 IO（`BinaryMuxFrame`）。
- Provider 抽象：ACP（JSON-RPC over stdio）或自定义 `AgentClient` + `AgentSession`。
- 配对：QR + ECDH + AES-256-GCM 加密 relay。
- 关键参考文件：
  - `docs/architecture.md`、`docs/data-model.md`、`docs/providers.md`、`docs/custom-providers.md`
  - `packages/server/src/server/agent/agent-manager.ts`
  - `packages/server/src/server/websocket-server.ts`
  - `packages/server/src/server/messages.ts`

### 3.3 paseo 的弱点 / Tether 的机会

| paseo 弱点 | Tether 机会 |
|---|---|
| 单机绑定，daemon 单机模型 | **多机 federation**：work mac 跑重 agent，笔记本/手机当瘦客户端 |
| 单 agent 一次 | **多 agent 编排**："codex 实现 → claude 评审 → 用户裁决" |
| 手机 UI 偏观察+小输入 | 手机优先的 diff / 权限 / 语音输入（Phase 4） |
| 没有跨会话长期记忆 | **个人记忆层**：跨会话/机器/agent 共享用户偏好与上下文 |
| 没有"任务式"调度 | **后台任务化 + 推送**：手机派单"晚上清掉 build warning"，agent 在 work mac 跑完推送 |

差异化主张（按 ROI 排）：
1. **多机 federation**——paseo 架构里最难加的，Tether 从 Phase 1 就把"daemon = session 主"画清楚
2. **后台任务 + 推送**——把 agent 真正当后台任务对待，"agent OS" 叙事的核心

## 4. 关键技术分叉与决策

### 4.1 Phase 1 用 tmux，但只作为一次性脚手架

**Phase 1 用 tmux** 的理由：实现快、稳定、电脑端 `tmux attach` 即真 PTY 体验、demo 1–2 周能跑。

**Phase 2 切到事件流**：tmux 路线天花板低，"比 paseo 更强"必须切到事件流抽象。

报废的范围（精确划线）：

- **会报废**：`apps/gateway/src/tmux.ts`、capture-pane 轮询、send-keys 注入、`/snapshot` 这种快照式接口
- **会保留**：Hono server、TypeScript 数据模型、SQLite store、CLI 骨架、`/remote` 路由约定

> Phase 1 的"一次性"指 tmux 适配层一次性，不是整个项目从零重写。骨架本来就为 Phase 2 埋点（§4.4）。

### 4.2 选 B 路线（事件流原生）

| 方向 | 选项 | 取舍 |
|---|---|---|
| A. tmux/PTY 原生 | 真终端体验 | 手机 UI 天花板低 |
| **B. 事件流原生** ✅ | paseo 路线 | Phase 1 tmux 报废，但产品天花板高 |
| C. 混合 | 双管线 | 复杂度爆炸，单人维护吃不消 |

选 B。

### 4.2.1 tmux 到事件流的终端体验过渡（待讨论记录）

2026-05-01 讨论结论：**不要从 tmux 直接跳到纯结构化 UI**。更稳的过渡路线是
先做 **PTY-backed event stream**。

当前 Phase 1：

```text
terminal
  -> tmux attach
  -> codex / claude 原始 TUI

mobile
  -> capture-pane snapshot
  -> send-keys
```

未来 Phase 2 推荐过渡：

```text
Gateway
  -> node-pty 启动 codex / claude / opencode
  -> PTY output 转成 terminal events
  -> 本地 terminal client 渲染
  -> web / app 用 xterm.js 渲染
  -> 输入通过 Gateway 写回 PTY
```

这样用户体感可以尽量接近 tmux：Codex / Claude 的 ANSI、光标移动、全屏 TUI、
快捷键和交互式输入仍由 PTY 承载；区别是 session owner 从 tmux 变成 Tether
Gateway，输出不再靠 capture-pane 快照，而是进入可订阅、可落盘、可 relay 的
事件流。

后续更结构化的 UI（timeline、diff、approval、permission review、agent handoff）
不应替代 Phase 2 的终端视图，而应在 PTY event stream 旁边逐步叠加：

```text
Phase 1:
tmux + capture-pane
终端体验最好，结构化能力最弱

Phase 2:
PTY-backed event stream
终端体验接近 tmux，同时 Gateway 能记录事件、广播多端、做 relay

Phase 4:
structured review UI
在事件流之上增加 diff、approval、file tree、permission UI
```

命令形态应尽量稳定，变化的是底层 transport：

```text
Phase 1:
tether codex
  -> 创建 tmux session
  -> tmux attach

Future:
tether codex
  -> 创建 Gateway-owned event-stream session
  -> attach 当前终端客户端
```

长期建议同时支持：

```bash
tether codex              # 快捷方式：run + attach
tether run codex          # 只创建/启动 session
tether attach <id>        # 从终端接入既有 session
tether ls                 # 查看 session
tether send <id> "继续"   # 从 CLI 发一句
```

关键取舍：

| 方向 | 终端体验 | 结构化能力 | 风险 |
|---|---|---|---|
| tmux snapshot | 最接近原生 | 弱 | 手机/app/relay 天花板低 |
| **PTY-backed event stream** | 接近 tmux | 中，可扩展 | 要实现 terminal client、输入路由、event cursor |
| 纯 provider protocol / JSON-RPC | dashboard 体验强 | 强 | 依赖 agent 协议成熟度，原始 TUI 体验变少 |

后续如果 agent CLI 提供稳定结构化协议（ACP / JSON-RPC / provider API），可在
PTY event stream 旁边接入 provider events，而不是一开始放弃终端原味。

### 4.3 IDE 化能力推迟到 Phase 4

Phase 2/3 都**不做** diff 渲染、文件树、富权限审阅 UI。原因：
- IDE 化是控制台之上的延伸，不是控制台的本体
- 把 Phase 2 工作量从 1.5–2 月 压到 1–1.5 月（全力）
- Phase 4 IDE 化也只服务"审阅 agent 做了什么、批准它要做什么"，不替代 VS Code

### 4.4 技术栈：Node + TypeScript

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | Node.js 20+ LTS | 标准 |
| 语言 | TypeScript（`tsx` 直跑，不打包） | 数据模型有类型；接 paseo 的事件结构方便 |
| HTTP | **Hono** | 轻、原生支持后续 WebSocket |
| CLI 参数 | `commander` | Phase 1 命令少，但起步省事 |
| SQLite | `better-sqlite3` | 同步 API，Phase 1 不需要异步 DB |
| 子进程 | 原生 `node:child_process` | tmux 调用走 `spawn('tmux', [...])`；**绝不**用 `shell:true` |
| 前端 | `apps/web` React/Vite + `setInterval(1500ms)` | 已从单 HTML 独立为 Web app；仍是 Phase 1 轮询 demo |
| 包管理 | pnpm | |
| daemon 发现 | `~/.tether/daemon.pid` + lockfile | 极简 |

为后期埋的点：
- Phase 2 上 WebSocket → Hono 直接支持
- Phase 2 上 xterm.js → 仅前端组件替换
- Phase 4 换 PTY → 用 `node-pty`（paseo 同款）

## 5. 阶段规划

### Phase 1 — Demo：手机/电脑同窗口（1–2 周）

**目标**：跑起来，让两端能看到同一会话。Phase 1 的代码是一次性脚手架。

必做：
- `tether codex`：起 daemon → 创建 tmux session 跑 codex → 当前终端 `tmux attach`
- HTTP daemon：监听 `127.0.0.1:4789`，单进程
- `GET /api/sessions`、`GET /api/sessions/:id/snapshot`、`POST /api/sessions/:id/send`
- 手机页 `/remote/session/:id`：`<pre>` 显示 capture-pane，1.5 秒轮询；底部输入框
- SQLite `sessions` 表（id / tmux_session_name / project_path / status / created_at）

不做：
- 配对 / device token / auth（demo 期 daemon 只绑 127.0.0.1，手机靠局域网 IP）
- WebSocket、xterm.js、API key mask、ANSI 颜色（带颜色或纯文本由后续决定）
- `attach` / `stop` / `ls` / `pair` 等 CLI 子命令（除 `codex`）
- 多 session 列表、事件来源标识、event 表、devices 表
- 危险按键二次确认、推送通知

验收标准：
1. 电脑跑 `tether codex` → 进入 codex 交互
2. 终端打印一行手机访问 URL（`http://<电脑局域网IP>:4789/remote/session/<id>`）
3. 手机打开 URL → 看到 codex 输出，最多 2 秒滞后
4. 手机输入"继续" → 电脑 codex 收到并响应
5. 电脑用户输入也出现在手机页面（capture-pane 自然包含）

**两端输入策略（Phase 1 显式约定）**：电脑 attach + 手机 send-keys 同时发生时，按键以**到达 PTY 的先后**为准（即 tmux 默认行为），不做仲裁。Demo 期不解决输入冲突，文档与手机页提示"两端同时输入会交错"。真仲裁推迟到 Phase 2 §5。

### Phase 1.5 — 认证与访问层（LAN / Tunnel / Relay）

**目标**：在不进入 Phase 2 事件流换血前，先给 demo 补上安全访问底座。支持局域网访问、第三方穿透访问，以及未来自建中转服务的协议雏形。

#### Local Gateway 抽象

Phase 1 demo 里的 daemon 后续升级为 **Tether Gateway**：本机常驻、单例、拥有本机 agent session 和 UI surface 的注册表。`tether codex` 不应长期同时承担"启动服务 / 创建 session / 打开电脑界面"三件事；后续命令要拆成 Gateway 与 session/UI 操作。

```text
Tether Gateway（常驻，本机唯一）
  ├─ auth / pairing / devices
  ├─ LAN / tunnel / relay 连接入口
  ├─ session registry
  ├─ UI surface registry
  ├─ agent process manager
  └─ local API / WebSocket

Agent Session
  ├─ codex
  ├─ claude
  └─ opencode

UI Surface
  ├─ terminal attach
  ├─ mobile web
  ├─ desktop web
  ├─ floating console
  └─ future native app / browser tab
```

建议命令方向：

```bash
tether gateway start
tether run codex
tether run claude
tether open <session-id>
tether pair
```

#### 多 UI Surface 与远程打开电脑界面

同一个 agent session 可以同时被多个 UI surface 观察/控制：电脑 terminal、桌面 Web、手机 Web、未来浮窗或原生 app。手机不能直接操作电脑桌面，必须向本机 Gateway 发起受控请求，由 Gateway 执行白名单动作。

```http
POST /api/sessions/:id/open
{
  "surface": "desktop-web" | "terminal" | "floating"
}
```

Gateway 允许的本机动作必须白名单化，例如：
- `open <local-url>` 打开桌面浏览器 UI
- `tmux attach -t <existing-session>` attach 既有 session
- focus/restore 已存在的 Tether UI

禁止把该能力扩展为"手机让电脑执行任意命令"。

核心数据对象：

```ts
type Gateway = {
  id: string
  name: string
  devices: Device[]
  sessions: AgentSession[]
  surfaces: UISurface[]
}

type AgentSession = {
  id: string
  provider: 'codex' | 'claude' | 'opencode'
  projectPath: string
  status: 'running' | 'stopped'
  ownerGatewayId: string
}

type UISurface = {
  id: string
  kind: 'terminal' | 'mobile-web' | 'desktop-web' | 'floating'
  deviceId: string
  sessionId?: string
  status: 'open' | 'closed'
}
```

核心原则：
- Gateway 永远是 session owner，agent 会话、项目路径、终端输出和控制权留在本机。
- 外网服务只做连接控制与转发，不执行命令，不直接拥有 agent 控制权。
- 所有写操作必须经过 device token；公网/中转场景不能沿用 Phase 1 裸访问。

#### 访问模式

| 模式 | 链路 | 用途 | 安全要求 |
|---|---|---|---|
| LAN | 手机 → `http://192.168.x.x:4789` → Gateway | 同 Wi-Fi / 内网 | device token；`--host 0.0.0.0` 必须显式开启 |
| Tunnel | 手机 → Cloudflare Tunnel / Tailscale → Gateway | 个人外网访问、临时演示 | device token；Gateway 可继续绑 `127.0.0.1`；支持 `--public-url` |
| Relay | 手机/Web → Tether Relay → Gateway outbound WSS | 长期外网、多设备、多机 | 云账户 + device token；relay 不落会话明文 |

#### 本地配对与设备

先做本机配对，不直接上邮箱/密码/OAuth。

```ts
type Device = {
  id: string
  name: string
  role: 'owner' | 'trusted' | 'view_only'
  tokenHash: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
}
```

流程：
1. 电脑运行 `tether pair`。
2. daemon 生成一次性 pairing code / QR，5 分钟过期，使用后失效。
3. 手机打开 `/pair`，输入 code 或扫码。
4. 配对成功后，手机获得 device token。
5. 后续 `/api/*/send` 等写操作必须带 `Authorization: Bearer <device-token>`。
6. 本地 SQLite 只存 token hash，不存明文 token。
7. 管理命令：`tether devices`、`tether revoke <device-id>`。

#### Tunnel 支持

Tether 不直接实现第三方穿透，但要让 Cloudflare Tunnel / Tailscale 顺滑可用：

```bash
tether codex --host 0.0.0.0
tether codex --host 127.0.0.1 --public-url https://xxx.trycloudflare.com
```

`--public-url` 只影响生成给手机的 URL，不改变 Gateway 实际监听地址。Cloudflare Tunnel 形态：

```bash
cloudflared tunnel --url http://127.0.0.1:4789
```

手机访问：

```text
https://xxx.trycloudflare.com/remote/session/<id>
```

#### Relay MVP

自建 relay 采用 Gateway 主动出站连接，避免公网 IP 和端口转发：

```text
手机/Web
   |
   | HTTPS/WSS
   v
Tether Relay
   |
   | outbound WSS
   v
电脑 Gateway
   |
   v
tmux / agent process
```

最小协议先转发 Phase 1 的 snapshot/send，Phase 2 再替换 payload 为事件流：

```ts
type RelayFrame =
  | { type: 'hello'; daemonId: string; token: string }
  | { type: 'subscribe'; sessionId: string; cursor?: number }
  | { type: 'input'; sessionId: string; text: string }
  | { type: 'snapshot'; sessionId: string; text: string }
  | { type: 'event'; sessionId: string; event: AgentEvent }
  | { type: 'error'; message: string }
```

云账户只做控制平面：
- 登录与设备列表
- Gateway 在线状态
- relay 路由
- push token 管理
- 设备远程 revoke

云端默认不存终端输出、不存 prompt、不存项目路径明文；relay 只做转发。

#### 未来仓库目录线框

Phase 1 demo 已迁移为 pnpm monorepo 雏形，按 Gateway、客户端、Relay 和共享包分层：

```text
tether/
├── apps/
│   ├── gateway/                 # 本机常驻 Gateway，session owner
│   │   └── src/
│   │       ├── main.ts
│   │       ├── server.ts        # Hono / WebSocket
│   │       ├── auth/            # pairing / device token / roles
│   │       ├── sessions/        # agent session registry
│   │       ├── surfaces/        # UI surface registry / remote open
│   │       ├── providers/       # codex / claude / opencode
│   │       ├── access/          # LAN / public-url / relay client
│   │       ├── store/           # SQLite schema + repositories
│   │       └── tmux/            # Phase 1 adapter，后续替换
│   ├── cli/                     # tether 命令行，只调用 Gateway API
│   ├── web/                     # React/Vite Web 客户端，先承载 mobile + desktop Web
│   └── relay/                   # 自建中转服务，后续独立部署
├── packages/
│   ├── core/                    # Gateway/Workspace/Session/Surface/Device 模型
│   ├── protocol/                # HTTP/WebSocket/Relay frame 契约
│   ├── config/                  # 路径、默认端口、env/config 解析
│   ├── ui/                      # Web 共享 UI 组件
│   └── tsconfig/
├── docs/
└── .planning/
```

边界：
- `apps/gateway` 可以访问文件系统、SQLite、tmux、agent 进程和 relay outbound。
- `apps/cli` 不直接管 session，尽量只调用本机 Gateway API。
- `apps/web` 是浏览器 UI，不执行本机命令。
- `apps/relay` 只转发 frame，不知道本机路径，不执行命令。
- `packages/core` 放纯模型和业务规则。
- `packages/protocol` 放客户端 / Gateway / Relay 共享协议。

#### 原生客户端策略（HarmonyOS / Flutter）

鸿蒙 app、Flutter app、未来 iOS/Android 原生 app 都应视为 **client surface**，不复制 Gateway 业务逻辑。

推荐顺序：
1. 先演进 `apps/web` PWA，把协议、配对、session 列表、terminal/timeline 交互跑稳。
2. 抽稳定的 `packages/protocol`：REST schema、WebSocket frame、Relay frame、错误码、认证头。
3. 再做原生客户端，只消费协议，不重新实现 session 管理、权限判断、relay 路由。

客户端选择：
- HarmonyOS：适合面向鸿蒙生态和系统级能力，如通知、分享、后台保活、桌面卡片。需要维护 ArkTS/原生 UI 代码。
- Flutter：适合一套代码覆盖 Android/iOS/桌面，适合更快做跨平台原生壳。需要通过生成的协议类型或手写 client SDK 对接 Gateway/Relay。
- PWA：仍是默认第一客户端，最快验证交互和协议；原生 app 不应早于协议稳定。

建议在 `packages/protocol` 生成多端 SDK：

```text
packages/protocol/
  src/                  # TS 源协议
  openapi/              # REST schema
  schemas/              # JSON Schema / Zod schema
  generated/
    dart/               # Flutter client types
    harmony/            # HarmonyOS ArkTS client types
```

原生客户端目录未来可以独立，也可以先放在 `apps/`：

```text
apps/
  harmony/              # HarmonyOS app，后续再建
  flutter/              # Flutter app，后续再建
```

短期不要同时开发 PWA、HarmonyOS、Flutter 三套 UI。先把 Gateway/Protocol 稳住，再选一个原生方向做壳。

### Phase 2 — 单机无缝切换（1–1.5 月全力 / 2.5–4 月业余）

**目标**：单机内"在电脑用了切手机继续，在手机用了切回电脑继续"完全无缝。
**架构换血**——丢掉 tmux 主路径，切到 **PTY-backed event stream**。

详细设计、任务和验收见
[2026-05-01-phase-2-pty-event-stream.md](2026-05-01-phase-2-pty-event-stream.md)。

Phase 2 的核心不是马上做完整 dashboard，而是替换 Tether 当前依赖 tmux 的
session transport。2026-05-01 当前实现进度：`tether codex` / `tether claude`
默认已切到 PTY-backed event stream；tmux 作为 `--transport tmux` 迁移期 fallback。

```text
tmux new-session / attach / capture-pane / send-keys
  -> Gateway-owned node-pty session
  -> PTY output append-only events
  -> terminal / web / mobile / app clients subscribe
  -> client input routed back to PTY stdin
```

本地体验目标：

```text
在 Tether 覆盖的 agent session 场景里，本地使用体验要尽量完全对齐 tmux，
并在历史回放、多端接管、审计、手机/Web/App 接入这些 agent console 能力上超越 tmux。
```

必做：
- `node-pty` 替代 tmux session owner；Gateway 持有 agent process / PTY。
- append-only event store：`terminal.output`、`user.input`、`session.started`、
  `session.exited`、client attach/detach、resize、control changed、error。
- WebSocket stream：cursor replay + live broadcast；浏览器端认证用 HTTP 换一次性
  WS ticket，不能依赖 WS 自定义 Authorization header。
- Gateway 在 WS `hello` frame 分配 `clientId`，客户端不能自报身份。
- `tether run <provider>`、`tether attach <id>`；`tether codex` /
  `tether claude` 保持为 run + attach 快捷方式。
- `tether attach <id> --control` / `--observe`，以及 `tether clients <id>`。
- active controller owns size：一个 session 只有一个 controller 控制 PTY size，
  observer 只接收同一条事件流，不改变尺寸。
- `tether codex` 创建 session 时传当前 terminal `cols/rows`，避免先用 `120x40`
  启动再 resize 导致 TUI flash。
- Web/PWA 用 xterm.js 渲染 terminal events，并用 transcript 兜底显示 Codex TUI
  输出；Web latestEventId 用 localStorage 按 `sessionId + deviceId` 持久化。
- event replay 默认 1000、最大 5000 events；retention 初版 7 天或每 session
  100MB。
- PTY output 与 user.input 落库前都做 secret mask；写入 PTY 的 input 仍使用
  原始 bytes。
- provider binary 由 Gateway 根据白名单解析；客户端只能传 provider id，不能传
  command path / args / env。

不做（推迟）：
- 多机 federation（Phase 3）
- 多 agent 编排（Phase 3）
- 推送通知（Phase 3）
- 加密 relay（Phase 3，过渡期靠 tailscale）
- 原生 app 完整实现（Phase 2 只保证协议和 xterm 视图适合 app 接入）
- provider 抽象完全体（先以 codex/claude/opencode 白名单 provider 起步）
- diff 渲染、文件树（Phase 4）
- 完整 approval UI / permission review（Phase 4；Phase 2D 仅预留 structured event）
- tmux pane/window/layout、prefix keybinding、copy mode、plugin 生态

工程难点：
1. 本地 terminal attach 手感：Enter / Backspace / Ctrl-C / Ctrl-D / paste、
   ANSI、光标移动、清屏、alternate screen、大输出 backpressure。
2. 多本地窗口 attach：controller / observer、resize ownership、control handoff。
3. WebSocket browser-compatible auth：一次性 ticket、日志 masking、clientId 分配。
4. WebSocket 重连 + event cursor + Web localStorage cursor。
5. Gateway crash / restart 后 session 状态不能静默伪装为 running；需要 `lost` /
   `failed` 判定，后续再评估 recovery。
6. event retention / transcript fallback，避免一次 replay 拉爆。
7. provider binary whitelist 与 secret mask 的安全边界。

**输入和尺寸所有权机制（Phase 2 起步方案）**：

| 概念 | 行为 |
|---|---|
| active controller | 拥有 PTY size 和主输入焦点 |
| observer | 订阅同一事件流，但不改变 PTY size |
| input routing | 第一版不强锁；Gateway 按收到顺序写 PTY，并记录 clientId |
| claim control | observer 可显式抢占，或按客户端策略在输入时申请 |
| controller disconnect | 最近活跃 terminal client 自动接管，或进入无 controller 状态 |

后续可加 focus mode / soft lock，作为“专注模式”开关。

**事件流格式选型（Phase 2 起步方案）**：

Phase 2 先用 Tether 自有最小 terminal event union，而不是直接绑定 paseo schema：

```text
terminal.output
user.input
session.started / session.exited / session.error
client.attached / client.detached
terminal.resize
client.control_changed
```

后续如果 agent CLI 提供 ACP / JSON-RPC / provider API，再在 PTY event stream 旁边
接入 provider events。Phase 4 的 diff / approval / handoff 作为 structured events
逐步叠加，不替代 Phase 2 的终端视图。

### Phase 3 — 多机 + 多 agent + 后台任务（路线图，非单迭代）

**目标**：把 Tether 从"单机控制台"升级为"agent OS"。

> 本阶段含 5 个独立大件，业余时间不可能在 2–4 月内全做完。拆为 3a/3b/3c 子阶段，每个子阶段独立可发布；顺序按 ROI 排（3a 提供多 agent 价值最快，3b 是差异化主张，3c 让"出门也能用"成立）。

**Phase 3a — Provider 抽象 + 多 agent（1.5–2 月业余）**
- Provider 抽象：codex / claude / opencode 同一交互，参考 paseo 的 ACP
- 多 agent 并发：一个项目下同时跑多个 session，UI 切 tab

**Phase 3b — Federation（2–3 月业余）**
- Daemon 间 federation：work mac 跑 daemon A，笔记本跑 daemon B；任一客户端看到所有 daemon 的会话
- 多机发现 + 权限信任模型

**Phase 3c — 后台任务 + 推送 + 加密 relay（2–3 月业余）**
- 后台任务模式：手机派单"今晚跑 X"，agent 在指定 daemon 上跑，完成推送
- Push 通知：APNs / FCM 凭证 + 中转服务
- 加密 relay（出门 wifi）：参考 paseo `packages/relay`，ECDH + AES-256-GCM

不做（推迟）：
- IDE 化（Phase 4）
- agent 之间的编排（"codex 写 → claude 评"）：Phase 4 或之后

工程难点：
1. Federation 的发现与权限模型（用户的多台机器如何信任彼此）
2. 推送 + 中转服务上线 + 凭证管理
3. 加密 relay 的 ECDH + AES-256-GCM 实现

### Phase 4 — IDE 化（控制台之上）（3–6 月）

**目标**：手机/任何设备上能审阅 agent 做了什么、批准它要做什么。**仍不是 IDE，不替代 VS Code/Cursor。**

边界（**严格**，Phase 4 只做 review/批准，不做编辑）：
- diff 视图（**只读**）
- 文件树（看 agent 改了哪些文件）
- 富权限审阅（带上下文的批/拒）
- prompt 重写（用户在手机上改自己发给 agent 的指令——这是控制台输入，不是代码编辑）

**越界即停**：
- 不做代码补丁编辑器（即使"轻量"也不做——这是 IDE 滑坡口子）
- 不做完整代码编辑器
- 不做语法高亮之外的 LSP 集成
- 不做 git 完整工作流（push/PR 创建可以做接入，但不取代 git CLI）

可选附加：
- 跨会话长期记忆层（个人偏好 / 项目上下文）
- agent 之间的编排（"codex 实现 → claude 评审"流水线）
- 语音输入

## 6. 数据模型（Phase 1）

```ts
type Session = {
  id: string                 // tth_YYYYMMDD_xxxxxx
  provider: 'codex'
  title: string
  projectPath: string
  status: 'running' | 'detached' | 'stopped' | 'completed' | 'failed'
  tmuxSessionName: string    // tether_<id>
  command: string
  createdAt: number
  updatedAt: number
  lastActiveAt: number
}
```

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  title TEXT,
  project_path TEXT,
  status TEXT NOT NULL,
  tmux_session_name TEXT NOT NULL,
  command TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
);
```

存储路径：`~/.tether/tether.db`。

Phase 2 起新增 `events` 表（事件流）和 `devices` 表（配对设备）。

## 7. tmux 操作约定（仅 Phase 1）

| 行为 | 命令 |
|---|---|
| 创建 | `tmux new-session -d -s tether_<id> -c "$PROJECT_PATH" "codex"` |
| 注入初始 prompt | `tmux send-keys -t tether_<id> "$PROMPT" Enter` |
| 电脑 attach | `tmux attach -t tether_<id>` |
| 手机读取 | `tmux capture-pane -t tether_<id> -p -S -200` |
| 手机发送 | `subprocess.run(["tmux", "send-keys", "-t", name, content, "Enter"])` |
| 停止 | `tmux kill-session -t tether_<id>` |

铁律：
- **绝不**用 `shell:true` 拼字符串
- 所有 tmux 调用走列表参数

## 8. 仓库结构（当前 Phase 1 迁移后）

```
/Users/dream/code/tether/
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── pnpm-lock.yaml
├── README.md                     # 中文，参考 codex_manager 风格
├── bin/tether                    # CLI bin，导入 apps/cli/src/main.ts
├── apps/
│   ├── cli/                      # commander 命令入口
│   │   └── src/main.ts
│   ├── web/                      # React/Vite Web 客户端
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   └── gateway/                  # 当前 demo daemon / 未来 Gateway
│       └── src/
│           ├── daemon.ts         # Hono server + API
│           ├── tmux.ts           # Phase 1 tmux adapter
│           ├── store.ts          # better-sqlite3
│           ├── ids.ts
│           └── mask.ts
├── packages/
│   ├── core/                     # Provider/Gateway/Surface 等核心类型
│   ├── protocol/                 # Relay/API frame 契约
│   ├── config/                   # 默认 host/port 等配置常量
│   └── ui/                       # 共享 UI 预留
├── native/                       # 原生客户端预留，不进当前 pnpm pipeline
│   ├── README.md
│   ├── flutter/.gitkeep
│   └── harmony/.gitkeep
├── docs/
└── .planning/
```

Phase 1 仍然只实现 demo 能力；monorepo 目录是为 Gateway / Relay / 多 UI / 原生客户端预留边界。

## 9. 安全（Phase 1）

- daemon 默认只绑 `127.0.0.1`
- 手机访问需经局域网 IP；demo 期不强制 token
- Phase 2 起接入配对 + device token + Bearer auth

## 10. 待评审决策

立项前需要明确：

**架构级（影响 Phase 2+ 是否要重构）**：

1. **事件流 schema**：复用 paseo `AgentStreamEvent` / 自研 —— 影响 Phase 3a provider 抽象是否需要适配层
2. **daemon 实例模型**：用户级单例（一个用户一个 daemon，承载所有 session）/ 项目级多实例（一个项目一个 daemon）—— 影响 Phase 3b federation 的发现模型
3. **session 状态机定义**：`running / detached / stopped / completed / failed` 五态的转换条件，尤其 codex 进程退出后是 `stopped` 还是 `completed`，谁来判定（exit code? agent 自报?）
4. **Phase 1 多 session 暴露**：sessions 表是复数 schema，但不暴露列表 UI——要么 Phase 1 顺手做 `GET /api/sessions` 列表页（成本低），要么 Phase 1 单 session + PID 文件，DB 推迟到 Phase 2

**细节级（不影响架构）**：

5. **ANSI 颜色**：要（+ ansi_up.js）/ 不要（纯文本）
6. **手机首页 `/remote`**：要最简列表页 / 不要（直接靠 URL）
7. **Phase 1 `--no-attach`**：让 `tether codex` 不自动 attach（默认 attach）
8. **输入仲裁默认方案**：B (last-writer-wins + 视觉提示) / A (全局软锁) —— 见 §5 Phase 2

## 11. 后续动作

1. 评审本草稿，确认 §4 三项架构决策（tmux 仅 Phase 1 / B 路线 / IDE 推迟）+ §10 第 1–4 项架构级决策
2. 通过后用 GSD 生成 `.planning/` 中的阶段计划
3. 在 `/Users/dream/code/tether` 初始化空仓库，铺骨架但不写实现
4. 本文件处置：进入 GSD 执行后，本文件可移到 `docs/working/archive/`，根目录指针由
   `PROJECT.md` 维护，避免与当前事实信息漂移。本草稿不再迭代细节
