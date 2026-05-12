# AI 项目上下文

## 产品

**Tether** 是 Agent 控制台。

把"用户直接运行 `codex` / `claude`（或其他 agent CLI）"包装成由 daemon 托管的会话，让
任意设备（电脑命令行、手机 PWA、Web）连到同一个会话上。

定位：

- **不是 IDE**——不替代 VS Code / Cursor，不做完整代码编辑器
- **是 Agent 控制台**——让用户在任何设备上和正在跑的 agent 同步对齐，
  审阅 agent 做了什么、批准它要做什么
- 远期叙事："像管 app 一样管 agent"

历史设计草稿见 `docs/archive/completed-working/2026-05-01-tether-agent-console.md`。

## 关键架构决策

### 1. 阶段路线（共 4 阶段）

| 阶段 | 主题 | 核心抽象 |
|---|---|---|
| Phase 1 | Demo：手机/电脑同窗口 | tmux + capture-pane 轮询（一次性脚手架），支持 codex/claude CLI |
| Phase 2 | 单机无缝切换 | **PTY-backed event stream 默认路径**（替换 tmux 主轴） |
| Phase 2.5 | 认证与访问层 | device token + LAN / tunnel / relay 入口 |
| Phase 3 | 多机 + 多 agent + 后台任务 | 事件流 + federation + 推送 |
| Phase 4 | IDE 化（控制台之上） | 在事件流上加 diff / 文件树 / 权限 UI |

**Phase 1 → Phase 2 是架构换血**：tmux 包装层、capture-pane 轮询、send-keys
注入正在被 PTY-backed event stream 替换。当前默认 `tether run codex` / `tether run claude`
已走 PTY event stream；tmux 仅作为 `--transport tmux` 迁移期 fallback。

当前 v0.3 里程碑已从 **Personal Relay Access** 调整为 **Multi-account Relay
Access**。已完成的 Personal Relay MVP（自托管 Relay + Gateway outbound WSS + 单
owner link secret）保留为开发/迁移 bootstrap，不再作为目标认证模型。后续路线要把
多账户登录、Gateway 启动认证、Relay Gateway/Client WS 认证、account/workspace/
Gateway/session ownership、角色权限、撤销和审计纳入 v0.3 正式目标。

Hosted SaaS billing、完整组织管理、端到端加密 relay envelope、federation 和推送仍在
v0.3 之外；但多账户访问边界本身不再后置。

### 2. 选择 B 路线（事件流原生）

不是 tmux/PTY 原生，也不是混合双管线。理由：手机 UI 天花板、和 paseo 对标的
功能扩张性、单人维护可承受度。详见 design doc §4.2。

### 3. IDE 化推迟到 Phase 4

Phase 2/3 不做 diff 渲染、文件树、富权限审阅 UI。Phase 4 也只服务"审阅 agent +
批准 agent"，**不替代 VS Code**。

### 4. 访问与账户方向

早期 demo 里的 daemon 正在升级为本机常驻 **Tether Gateway**：负责 auth/pairing、
session registry、UI surface registry、agent process manager，以及 LAN/tunnel/relay
连接入口。Gateway 是本机 session 控制面 owner；运行时 PTY/provider child 由
per-session runner 持有。手机/Web/电脑端都是 UI surface。

访问层分三种模式：LAN、第三方 tunnel、自建 relay。目标认证模型是统一的多账户
token 认证：外部端登录远程 auth/control-plane 获得 client access/refresh token；
Gateway 启动时认证并绑定到 account/workspace，获得 Gateway token；浏览器 WS 通过
HTTP token auth 换短期一次性 ticket；Relay 的 Gateway WS 和 Client WS 都必须认证。
Personal Relay 的 shared secret 只能作为 bootstrap/开发模式，不作为生产 auth。

- LAN：手机直接访问 Gateway 的局域网地址，`--host 0.0.0.0` 必须显式开启。
- Tunnel：支持 Cloudflare Tunnel / Tailscale，通过 `--public-url` 生成外部 URL。
- Relay：Gateway 主动 outbound WSS 连接 Tether Relay，relay 只转发 frame，不执行命令。

同一个 agent session 可以挂多个 UI surface：terminal attach、mobile web、desktop web、
floating console。手机可以请求电脑打开某个 surface，但只能触发白名单动作
（打开本地 URL、attach 既有 session、focus 既有 UI），不能执行任意命令。

账户体系以远程 auth/control-plane 为账号、设备、Gateway 绑定、token 签发/刷新/
撤销的事实来源。v0.3 必须先定义并落实 `account -> workspace -> gateway -> session`
归属链，以及 `user`、`device`、`role`、`client token`、`gateway token`、`WS ticket`
之间的边界。云端默认不持有会话明文；Relay 只做认证后的 frame routing，不执行命令、
不接受 provider command/args/env、不成为 session ownership 的事实来源。

仓库已迁移为 pnpm monorepo：当前有 `apps/gateway`、`apps/cli`、`apps/web`、
`apps/admin-web`、`apps/server`、`apps/relay`、`packages/core`、
`packages/protocol`、`packages/config`、`packages/design`、`packages/theme` 和
`native/` 预留区。

HarmonyOS / Flutter / iOS / Android 都视为 client surface，只消费 Gateway/Relay 协议；
不要在原生 app 中复制 session 管理、权限判断或 relay 路由。先稳定 PWA 和
`packages/protocol`，再生成或手写 Dart / ArkTS client SDK。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 20+ LTS |
| 语言 | TypeScript（`tsx` 直跑，不打包） |
| Gateway/CLI HTTP | Hono |
| Server API | Egg.js + TypeScript |
| CLI 参数 | commander |
| SQLite | better-sqlite3 |
| 子进程 | 原生 `node:child_process`（**绝不** `shell:true`） |
| 前端 | `apps/web` + `apps/admin-web` React/Vite，消费 `packages/design` / `packages/theme` |
| 包管理 | pnpm |
| Gateway 单例 | `~/.tether/daemon.pid` + lockfile（当前实现仍沿用 daemon 命名） |

## 前端应用边界与规范

前端有两个独立 app：

- `apps/web`：普通用户会话控制台，只承载 `/login`、`/register` 和 session surface。
  不承载 `/admin/*`。
- `apps/admin-web`：唯一管理后台入口，承载 `/admin/login`、`/admin/register`、
  `/admin/dashboard`、`/admin/users`、`/admin/devices`、`/admin/gateways`、
  `/admin/audit`。

模块级前端规范：

- `apps/web/CLAUDE.md`
- `apps/admin-web/CLAUDE.md`

前端工程约束：

- 路由事实源必须是各 app 的 `src/routes.tsx`；不要继续把业务路由堆在 `main.tsx`。
- 前端新增文件统一使用 kebab-case；React 组件导出继续使用 PascalCase。
  当前 `apps/web` 与 `apps/admin-web` 前端源码文件名应保持 kebab-case。
- 可见文案必须走 i18n 文案目录和 hook；不要在页面里散落硬编码文案或自建
  `copy` map。`apps/web` 使用 `src/i18n/messages.ts` + `useI18n()`；
  `apps/admin-web` 使用 `src/i18n/messages.ts` + `useAdminI18n()`。
- 所有前端页面默认必须支持中文 / English；表单校验、toast、空态、错误兜底、状态栏和
  终端/表格辅助文案都属于 i18n 范围。新增单语言页面视为规范违规。
- 所有前端页面默认必须支持 light / dark；页面 shell、登录注册页、列表页、终端面板、
  表格和弹窗都要在两种主题下可读，并提供主题切换入口。
- 两个 app 都消费 `@tether/design` 和 `@tether/theme`；基础组件优先上移到
  `packages/design/src`，主题 token 只维护在 `packages/theme`。
- `apps/web` 的 Auth Shell、Session List、Terminal Surface 和 `apps/admin-web`
  的 Auth Shell、Admin Layout、Data Management Page 布局规则分别记录在对应
  app 的 `CLAUDE.md`。

## 仓库结构（当前）

```
/Users/dream/code/tether/
├── AGENTS.md / CLAUDE.md / PROJECT.md / AI_CONTEXT.md   # AI 协作规则
├── README.md
├── package.json / pnpm-workspace.yaml / tsconfig.base.json
├── bin/tether                                           # 可执行入口
├── apps/
│   ├── cli/                                             # commander 分发
│   ├── gateway/                                         # Hono server + PTY event stream + tmux fallback
│   ├── web/                                             # React/Vite Web 客户端
│   ├── admin-web/                                       # 管理控制台 Web 客户端
│   ├── server/                                          # Egg 认证 / 管理 API
│   └── relay/                                           # Relay 服务
├── packages/
│   ├── core/                                            # 核心类型
│   ├── protocol/                                        # API / Relay frame 契约
│   ├── config/                                          # 默认配置
│   ├── design/                                          # 共享基础 UI 组件
│   └── theme/                                           # 共享主题 token 与全局样式
├── native/                                              # Flutter / HarmonyOS 预留
├── docs/
│   ├── README.md                                        # 文档治理
│   ├── current/                                         # 长期事实
│   └── working/                                         # 立项前草稿
└── .planning/                                           # GSD 阶段计划、执行状态和验收记录
```

## Server API 约定（apps/server）

`apps/server` 是远程 auth/control-plane 的 Egg 服务端，负责普通用户、管理后台、
Gateway token、设备、审计、MySQL/Redis 接入和统一响应协议。

分层规则：

- Controller 只做参数读取、最小归一化、调用 `ctx.service`、`ctx.success(data)`。
- Controller 不写业务 `try/catch`，不直接 `ctx.error()`，不直接访问 MySQL / Redis。
- Service 必须 `import { Service } from 'egg'` 并 `extends Service`。
- Service 方法内优先 `const { app, ctx } = this` 或 `const { ctx } = this`，跨 service 调用走 `ctx.service`。
- Service 不导出业务函数；对外业务入口只能是 Service 方法。
- `config.middleware` 全局挂载 `error`、`verifyLogin`；公开接口必须写入 `config.verifyLoginWhitelist`。
- `verifyLogin` 负责校验登录态并写入 `ctx.state.auth`，路由级 `requireTokenClass` 负责接口权限。
- 可预期业务错误在 Service 或 Koa middleware 中用 `ctx.throw(status, msg)` 抛出。
- `app/middleware/error.ts` 统一捕获异常，HTTP 状态保持 `200`，响应体用数字 `code` 区分业务状态。
- 数据库基础能力收口到 `ctx.service.db`，领域数据访问收口到 `authRepository` / `gatewayRepository` / `auditRepository` 等 repository；业务 Service 不判断 MySQL / runtime，也不直接写 SQL。
- Redis 能力收口到 `ctx.service.redis`。
- 密码注册/校验统一走 `ctx.genHash` / `ctx.compare`，与 `egg-bcrypt` 保持一致。

响应结构：

```ts
type ApiResponse<T> = {
  code: number
  msg: string
  data: T | null
  stack?: string
}
```

## 数据模型（当前）

```ts
type Session = {
  id: string                 // tth_YYYYMMDD_xxxxxx
  provider: 'codex' | 'claude'
  title: string
  projectPath: string
  status: 'running' | 'stopped' | 'completed' | 'failed' | 'lost'
  attachState: 'attached' | 'detached'
  tmuxSessionName: string    // tmux fallback 使用；PTY session 为空
  command: string
  pid?: number
  transport: 'pty-event-stream' | 'tmux'
  createdAt: number
  updatedAt: number
  lastActiveAt: number
}
```

存储路径：`~/.tether/tether.db`。当前已有 `session_events` 表，terminal output、
user input、client attach/detach、resize、control change 都走 append-only event。

## PTY Event Stream 操作约定（默认）

| 行为 | 命令 |
|---|---|
| 创建并 attach | `tether run codex` / `tether run claude` / `tether run opencode` |
| 显式创建 | `tether run codex` |
| 后台创建 | `tether run codex --no-attach` |
| 本地 attach | `tether attach <id> --control` 或 `--observe` |
| 查看 client | `tether debug` |
| 发送输入 | `tether debug` 或 Web 输入框 |
| 停止 | `tether stop <id>` |

WebSocket 使用 HTTP 换一次性 ticket，再通过 query 连接 stream；浏览器不依赖
自定义 Authorization header。Gateway 在 `hello` 分配 `clientId`。

### Web/PTY 输入提交注意点

Codex TUI 对远程 PTY 输入的提交语义很敏感。Web 控制面、Relay 控制面、简洁聊天视图
向 Codex 写入一行输入时，必须保持和真实终端按键一致：

1. 先发送文本：`client.input` / `input` 的 `data` 为纯文本。
2. 等待一个很短的按键间隔，当前 Web composer 使用约 `40ms`。
3. 再单独发送 Enter：`client.input` / `input` 的 `data` 为 `"\r"`。

不要把两者合并成单个 `data: "text\r"` frame。实测 Codex `v0.128.0` 会把这种合并
写入显示到输入区，但不一定触发提交；事件库里会表现为一条 `user.input`：`'text^M'`。
正确路径应落成两条 `user.input`：`'text'` 和 `'^M'`。实测简洁视图同步连续发送两帧
也可能不稳定，必须保留和控制页一致的短延迟。

外置 composer（控制页底部输入框、简洁聊天输入框）可以在发送前把 textarea 内部换行归一成
空格，避免多行 textarea 把 Codex 带入多行编辑状态；但归一化后仍必须按“两帧提交”发送。
这条规则也适用于后续 Claude / Copilot / OpenCode 的外置输入框，除非对应 provider
实测证明支持合并帧提交。

Gateway/runner 会从 `user.input`、`terminal.output`、agent JSONL / transcript 和
`session.exited` 派生 `agent.status` 事件。当前状态值包括 `idle`、`submitted`、
`running`、`responding`、`done`、`exited`、`disconnected`。前端页面应消费
`agent.status`，不要直接把 `\u001b[I`、`\u001b[O`、OSC 颜色查询等 PTY 控制码暴露成
用户可见状态。

当前实现限制：

- Phase 6 后，常驻 Gateway 是正常路径：`tether gateway` 前台运行，或
  `tether gateway start` 通过 launchd 后台运行；`tether run codex` /
  `tether run <provider>` 会先探测常驻 Gateway，请求它创建 session。Gateway 会为每个
  session 启动 detached session runner 进程，由 runner 持有 PTY 和 provider child；
  CLI 只 attach 到该 session。
- session runner 通过 Unix domain socket 暴露本机控制面，socket 路径记录在
  `sessions.runner_socket_path`。Gateway 重启后会按 store 中的 runner metadata 重新 ping
  runner；runner 可连接时 session 保持 `running`，不可连接时标记为 `lost`。
- `tether run codex --inline` / `tether run <provider> --inline` 是调试 fallback，用于强制
  使用旧的单次 CLI 内联 Gateway。未检测到常驻 Gateway 时，CLI 会用中文提示并回退
  inline。
- 常驻 Gateway 的 `POST /api/sessions` 默认关闭，必须通过
  `allowApiSessionCreate` 显式开启；开启后仍只接受 provider 白名单，不能接受任意
  command/args/env。完整多账户 auth、Gateway startup auth、Relay WS auth 和 role
  authorization 属于后续 Phase 4/5。

## tmux 操作约定（迁移期 fallback）

| 行为 | 命令 |
|---|---|
| 创建 | `tmux new-session -d -s tether_<id> -c "$PROJECT_PATH" "codex"` 或 `"claude"` |
| 注入 prompt | `tmux send-keys -t tether_<id> "$PROMPT" Enter` |
| 电脑 attach | `tmux attach -t tether_<id>` |
| 手机读取 | `tmux capture-pane -t tether_<id> -p -S -200` |
| 手机发送 | `spawn('tmux', ['send-keys', '-t', name, content, 'Enter'])` |
| 停止 | `tmux kill-session -t tether_<id>` |

铁律：
- **绝不**用 `shell:true` 拼字符串
- 所有外部命令一律走列表参数

## 与外部参考项目的关系

| 仓库 | 角色 | 是否复用代码 |
|---|---|---|
| `/Users/dream/code/github/codex_manager` | 设计参考（README 风格、`/remote` 交互思路、auth 模型） | 否（Python，语言不同） |
| `/Users/dream/code/github/paseo` | 高级能力对标（事件流、WebSocket mux、provider 抽象、加密 relay） | Phase 2/3 可能借鉴具体协议格式 |

## 安全约束（项目专属）

Tether 直接控制本机命令行，安全是底线：

- daemon 默认只绑 `127.0.0.1`
- 客户端写操作必须经过认证；当前 WebSocket 写操作先用一次性 ticket，完整 device
  token / pairing 在 Phase 2.5 补齐
- 客户端只能 `send-keys` 到既有 agent 进程，**不能**让 daemon 起任意进程
- 终端输出外发前要做基础敏感信息掩码（已知 API Key 格式、常见 token 格式）
- 配对 token：一次性 / 5 分钟过期 / 使用后失效；配对成功后发长期 device token

详细安全规则见 `PROJECT.md`「安全门槛」一节。
