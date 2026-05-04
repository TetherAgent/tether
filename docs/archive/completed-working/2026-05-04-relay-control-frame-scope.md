# Relay 控制帧 session scope 强校验

状态：Completed Archive  
创建时间：2026-05-04  
范围：`apps/relay`、`apps/gateway`、`apps/web`、`apps/cli`、`apps/server`

## 完成记录

已完成：

- Relay 控制帧、detach、replay、event 分发统一按当前 session scope 校验。
- token 模式下缺少 `accountId` / `workspaceId` / `gatewayId` 的 unscoped session 不再暴露给普通 Web client。
- legacy secret 兼容边界保留为显式分支。
- 覆盖测试已补入 `apps/relay/src/relay.test.ts` 和 `apps/gateway/src/relay-client.test.ts`。

## 问题背景

Relay 目前已在连接认证阶段通过 Server `/api/token/validate` 拿到 `RelayAuthScope`，并在
`client.list` / `client.subscribe` 时用 `clientCanSeeSession()` 过滤 session。

但 `client.input`、`client.resize`、`client.stop` 等控制帧仍只做很薄的一层
`clientCanAccessFrameSession(clientScope, sessionId)` 检查。该函数对
`normal_client_access` 不会再次根据 `latestSessions.get(sessionId)` 校验
`accountId`、`workspaceId`、`userId`、`gatewayId` 等 ownership 字段，主要依赖
“客户端之前已经用 control mode 订阅成功”这一 Relay 内部状态。

这不是“任意已认证客户端可以直接控制任意 session”：当前 `client.subscribe` 已经会查
`latestSessions` 并用 `clientCanSeeSession()` 过滤。但安全边界仍不够硬。如果后续出现
订阅状态残留、session ownership 变化、异常 frame 顺序、legacy/unscoped session，或者
Relay 内部状态不同步，控制帧可能绕过“当前真实 session metadata”的每帧校验。

## 当前 Gateway 支撑条件

Gateway 已具备支撑强校验的字段链路：

- `apps/gateway/src/store.ts` 的 `Session` 已包含 `accountId`、`workspaceId`、`userId`、
  `deviceId`、`gatewayId`。
- `apps/gateway/src/pty.ts` 创建 PTY session 时会写入 `owner`。
- `apps/gateway/src/daemon.ts` 通过认证 API 创建 session 时会传入 actor scope。
- `apps/gateway/src/relay-client.ts` 的 `toRelaySession()` 会把这些字段转发给 Relay。

也就是说，经过 Server / Gateway auth 创建的 session 字段是齐的。风险主要在旧的本地 CLI、
inline fallback 或未经 auth actor 创建的 legacy session，它们可能没有完整 scope 字段。

## 风险

- 跨用户或跨 workspace 的 `client.input` / `client.resize` / `client.stop` 控制帧可能在
  Relay 状态漂移时只因历史订阅状态而被转发。
- 缺少 scope 字段的 legacy session 如果在 token 模式下继续暴露给普通 Web client，会削弱
  account/workspace/session ownership 边界。
- 订阅权限和控制权限分散在多个分支，后续维护容易遗漏。

## 修复方向

在 Relay 内新增统一校验函数，例如：

```ts
clientCanAccessSession(clientScope, sessionId, gatewayScope)
```

规则：

1. 先通过 `latestSessions.get(sessionId)` 读取真实 session metadata。
2. session 不存在时直接拒绝，返回 `forbidden` 或 `session_not_found`。
3. session 存在时复用 `clientCanSeeSession(clientScope, session, gatewayScope)` 判断
   `accountId`、`workspaceId`、`userId`、`gatewayId` 等 scope。
4. `client.input`、`client.resize`、`client.stop`、`client.detach`、`sendReplay()`、
   `sendEventToSubscribers()` 都必须基于这个统一函数判断。
5. `ws_ticket` 仍必须限制 `sessionId` 和 `mode`，不能因为持有 ticket 就访问其他 session；
   observe ticket 不能发送 `input` / `resize` / `stop`。
6. token 模式下，缺少 `accountId` / `workspaceId` / `gatewayId` 的 session 不应转给普通
   Web client；只有显式 legacy secret 模式才允许 unscoped session。
7. `clientCanSeeSession()` 也要收紧：token client 不能因为 session 缺字段而默认通过；
   legacy secret 兼容必须是显式分支，不能被 token client 复用。

## 建议测试

在 `apps/relay/src/relay.test.ts` 增加跨 scope 用例：

- A 用户可以 `list` / `subscribe` / `input` 自己的 session。
- B 用户看不到 A 的 session。
- B 用户伪造 `client.subscribe` 指向 A session 时返回 `forbidden`。
- B 用户伪造 `client.input` / `client.resize` / `client.stop` 指向 A session 时返回
  `forbidden`。
- `ws_ticket` 只能访问 ticket 内的 `sessionId` 和 `mode`；observe ticket 不能发送控制帧。
- 缺少 scope 的 session 在 token 模式下不可见或不可控。
- legacy secret 模式如仍保留，需要单独覆盖其兼容边界，避免误用于正式 token 模式。

## 验收口径

- Relay 所有控制帧都在转发前做 session scope 校验。
- Relay 不再只依赖“之前订阅过”来判断控制权限。
- token 模式下，unscoped session 不会暴露给普通 Web client。
- 相关错误码和日志不包含 token、secret 或终端明文。
