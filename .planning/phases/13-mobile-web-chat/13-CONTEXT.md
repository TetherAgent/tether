# Phase 13: Mobile Web Chat Interface - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

新建 `apps/mobile-web`：类微信风格的移动端 Web 聊天界面，用户可以从手机/浏览器
创建 AI 会话（选择 model）、发送消息、实时渲染 agent 的 JSON 事件流（tool 调用、
回复、权限提示等）。

**本 phase 交付：**
- 全新独立 app `apps/mobile-web`（React，移动端优先 PWA）
- 左侧导航（会话列表、新建会话入口、设置/账号）+ 右侧聊天区，类微信布局
- 通过 Relay WS 新帧创建 session（不依赖 CLI）
- Gateway 动态提供可用 model 列表
- Session ID 关联到 Server DB 用户账号（跨设备同步）
- Relay 同步**全量事件**到 Server DB

**不在本 phase：**
- 修改 apps/web（保持现状）
- Flutter 客户端（Phase 9）
- 多 workspace 支持（Phase 10）
- 离线模式/PWA push 通知

</domain>

<decisions>
## Implementation Decisions

### 会话创建路径
- **D-01:** 从客户端创建 session 走 **Relay WS 新帧**，在 `RelayClientToServerFrame` 加 `client.create-session` 帧，包含 `provider` 字段。Relay 收到后转发给对应 Gateway，Gateway 起新 PTY + AI agent，成功后 Relay 回 `server.session-created` 帧含 `sessionId`。
- **D-02:** 复用现有 WS 认证通道（`client.auth` → `client.auth.ok`），不新增 HTTP 端点。

### Model 选择
- **D-03:** 新增 `client.list-providers` 帧，Gateway 回 `gateway.providers` 帧，包含当前可用的 provider 列表（从现有白名单动态读取）。
- **D-04:** 创建 session 时 `client.create-session` 携带 `provider: string`（如 `"claude"` / `"codex"`）。Gateway 校验 provider 在白名单内，否则拒绝。
- **D-05:** UI 中不同 model 对应不同头像/颜色：Claude = 紫色，Codex = 蓝色，opencode = 橙色（可扩展）。

### UI 结构（类微信）
- **D-06:** 新建 `apps/mobile-web`，独立 React 应用，不改动 `apps/web`。
- **D-07:** 布局：左侧固定窄导航栏（图标 tab）+ 右侧两列区（会话列表 + 聊天区）。移动端折叠为单列（会话列表 ↔ 聊天区）。
- **D-08:** 左侧导航 tab：① 会话列表 ② 新建会话（`+`按钮触发 model 选择弹窗）③ 设置/账号。
- **D-09:** 会话列表每行显示：AI model 头像（颜色圆形）+ model 名称、最后一条消息预览（截断 50 字）、时间戳、session 运行状态指示（闪烁绿点）。
- **D-10:** 渲染风格参考用户提供的 HTML mockup（`docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html`）：tool call 折叠卡片、agent 气泡、user 气泡、结果卡片（耗时/token/花费）。

### Session ID 追踪
- **D-11:** Session 创建时，Relay 同步写 Server DB（通过 `syncToServer`），Server 将 session 关联到当前登录用户（accountId/workspaceId/userId）。
- **D-12:** Web 端通过 `/api/server/sessions` 读取当前用户的会话列表（已有接口），不依赖 localStorage。

### Relay → Server 同步
- **D-13:** Relay 同步**全量事件**到 Server DB（包括 `terminal.output`、`agent.turn`、`agent.typing`、`session.exited` 等），扩展现有 `syncToServer` 机制，不限于白名单事件。
- **D-14:** 新增：session 创建时 Relay 调 `POST /api/relay/sessions` 写 Server，记录 sessionId/gatewayId/provider/accountId。

### 认证
- **D-15:** `apps/mobile-web` **完整复用** `apps/web` 的登录/auth 体系：登录页 UI、auth context、token 存储、路由守卫全部搬过来，不重建。
- **D-16:** Server 侧登录接口（`POST /api/auth/login`、`POST /api/auth/register` 等）直接复用，不新增也不修改。
- **D-17:** WS 连接用现有 `ws-ticket` 机制（`GET /api/relay/ws-ticket` + `client.auth: { ticket }`）。
- **D-18:** 参考源文件：`apps/web/src/contexts/auth-context.tsx`、`apps/web/src/pages/login-page.tsx`、`apps/web/src/pages/register-page.tsx`、`apps/web/src/components/console/web-auth-shell.tsx`——将这些文件复制到 `apps/mobile-web` 并按新 app 结构调整 import，不改 Server 接口。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Protocol 定义
- `packages/protocol/src/index.ts` — 所有 Relay WS 帧类型定义，新增帧必须在此添加
- `apps/relay/src/relay.ts` — Relay 服务端逻辑，`client.create-session` 和 `client.list-providers` 在此处理
- `apps/gateway/src/relay-client.ts` — Gateway 侧 Relay 客户端，处理来自 Relay 的新帧

### 现有 Chat 基础设施
- `apps/gateway/src/chat-handler.ts` — handleChatMessage 逻辑，新 session 的 chat 消息复用此处理
- `apps/gateway/src/agent-select-detect.ts` — provider 选项检测逻辑，provider 白名单参考

### Server 接口
- `apps/server/app/controller/session.ts` — session list/conversation/events 接口
- `apps/server/app/router.ts` — 所有 API 路由，新增路由按 `/api/relay/` 前缀规范

### UI 参考
- `docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html` — **必读**，聊天区渲染样式的完整参考实现（tool card、gas bubble、result card、dark mode 变量全在此）
- `apps/web/src/components/session/chat-bubble.tsx` — 现有 chat-bubble 组件，可参考但本 phase 在新 app 中重建

### 认证流程（搬迁源，必读）
- `apps/web/src/contexts/auth-context.tsx` — **直接搬迁**，auth 状态管理
- `apps/web/src/pages/login-page.tsx` — **直接搬迁**，登录 UI
- `apps/web/src/pages/register-page.tsx` — **直接搬迁**，注册 UI
- `apps/web/src/components/console/web-auth-shell.tsx` — **直接搬迁**，auth 守卫 shell

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/protocol/src/index.ts`：扩展 `RelayClientToServerFrame` 和 `RelayServerToClientFrame`，加新帧类型
- `apps/relay/src/relay.ts`：`syncToServer` 函数已有，扩展调用点即可；gateway/client 连接管理逻辑已有
- `apps/gateway/src/session-runner-spawn.ts`：新 session 的 PTY spawn 逻辑已有，`client.create-session` 最终调用此
- `apps/server/app/controller/session.ts`：`list`/`conversation`/`events` 接口已有，mobile-web 直接复用

### Established Patterns
- Relay WS 帧格式：discriminated union，`type` 字段作区分，现有帧遵守此格式，新帧同理
- Gateway 白名单校验：`SAFE-01` 要求 provider 必须在白名单内，`client.create-session` 中的 provider 校验遵守同一规则
- Server 路由前缀：新增接口走 `/api/relay/` 前缀（参见 CLAUDE.md 规范）
- Auth token 流：login → JWT → ws-ticket → WS auth，mobile-web 走同一流程

### Integration Points
- `apps/relay/src/relay.ts` → 新增对 `client.create-session` 和 `client.list-providers` 的处理，转发给目标 gateway
- `apps/gateway/src/relay-client.ts` → 新增对 `gateway.create-session` 和 `gateway.list-providers` 帧的响应
- `apps/server/app/router.ts` + `apps/server/app/controller/` → 新增 `POST /api/relay/sessions` 供 Relay 写入
- `apps/mobile-web/` → 全新 React app，连接 Relay WS，调 Server REST API

</code_context>

<specifics>
## Specific Ideas

- UI 参考：微信聊天列表截图（用户提供）——左侧窄导航图标栏，中间会话列表（头像、名称、消息预览、时间），右侧聊天区
- 聊天区渲染参考：`docs/archive/completed-working/2026-05-04-simple-chat-mockup-stream-json.html`，该 mockup 已完整实现所需的所有组件（tool card 展开/折叠、用户气泡绿色、agent 气泡白色/暗色、流式光标、thinking 动画、result 花费卡片）
- Model 头像颜色：Claude = 紫色系 (#c084fc / #6366f1)，Codex = 蓝色系，opencode = 橙色系
- 移动端优先：viewport meta 已在 mockup 中，max-width 760px，手机上全屏单列

</specifics>

<deferred>
## Deferred Ideas

- **PWA push 通知** — session 完成后推送到手机，属于通知基础设施，独立 phase
- **Flutter 客户端** — Phase 9 已规划
- **多 workspace 切换** — Phase 10 已规划
- **会话内权限审批** — permission prompt 渲染做到 UI 里，但批准/拒绝的实际执行逻辑（写 PTY）属于 Experience Hardening (Phase 2)

</deferred>

---

*Phase: 13-mobile-web-chat*
*Context gathered: 2026-05-10*
