# Direct / Relay 统一 Web 创建 session 方案

本文记录在 Web 页面创建后台 session 的统一方案。目标是让页面能力等价于：

```bash
tether codex --no-attach -- <provider args>
```

也就是创建一个由 Gateway/runner 托管的 PTY session，但不自动 attach 到本机 CLI。

## 目标

- Web 页面可以新建 `codex` 等 provider session。
- 创建后 session 默认进入列表，用户需要时再点“进入”。
- Direct 和 Relay 语义一致。
- 创建逻辑只在 Gateway 落一份，避免 Direct / Relay 两套规则漂移。

## 统一原则

创建 session 是 Gateway action：

```text
CreateSessionRequest
-> Gateway 校验
-> Gateway spawn runner
-> Gateway 返回 session
```

Direct 和 Relay 的区别只在传输层。

```text
Direct:
Web -> Gateway HTTP POST /api/sessions
Gateway -> create runner session
Gateway -> Web 返回 session

Relay:
Web -> Relay client.create_session
Relay -> Gateway client.create_session
Gateway -> create runner session
Gateway -> Relay gateway.session_created
Relay -> Web session.created
```

Relay 只做鉴权、scope 路由和 frame 转发：

- Relay 不执行命令。
- Relay 不拼 provider args。
- Relay 不接触 shell/env。
- Relay 不持久化 provider 参数。

## 请求结构

复用现有 Gateway API payload：

```ts
type CreateSessionRequest = {
  provider: 'codex' | 'claude';
  title?: string;
  projectPath?: string;
  providerArgs?: string[];
  cols?: number;
  rows?: number;
};
```

Relay frame 增加 requestId：

```ts
// Web -> Relay
type ClientCreateSessionFrame = {
  type: 'client.create_session';
  requestId: string;
  payload: CreateSessionRequest;
};

// Relay -> Gateway
type RelayCreateSessionFrame = {
  type: 'client.create_session';
  clientId: string;
  requestId: string;
  payload: CreateSessionRequest;
};

// Gateway -> Relay
type GatewaySessionCreatedFrame = {
  type: 'gateway.session_created';
  clientId: string;
  requestId: string;
  session: RelaySession;
};

type GatewaySessionCreateFailedFrame = {
  type: 'gateway.session_create_failed';
  clientId: string;
  requestId: string;
  code: string;
  message: string;
};

// Relay -> Web
type ClientSessionCreatedFrame = {
  type: 'session.created';
  requestId: string;
  session: RelaySession;
};

type ClientSessionCreateFailedFrame = {
  type: 'session.create_failed';
  requestId: string;
  code: string;
  message: string;
};
```

## 权限和安全

Gateway 做最终校验：

- `gateway.allowApiSessionCreate` 必须显式开启。
- provider 必须是白名单 provider。
- 禁止 `command` / `env` / `shell` / `args` / `argv` / `providerCommand` 等命令形字段。
- `providerArgs` 必须是 string array。
- `projectPath` 必须是字符串，并按 Gateway 当前规则 resolve。
- actor scope 写入 session owner。
- 普通用户只能创建到自己的 account / workspace / gateway 下。

Relay 做传输层校验：

- client 必须已认证。
- token scope 必须允许当前 gateway / workspace。
- Relay 不修改 payload。
- Relay 只把 Gateway 返回的结果转给原始 `clientId`。

## 前端抽象

前端页面不直接关心 Direct / Relay 传输差异，提供统一函数：

```ts
createSession(connectionMode, payload)
```

内部：

```text
Direct:
fetch('/api/sessions', payload)

Relay:
send client.create_session over Relay WS
wait session.created / session.create_failed by requestId
```

Sessions 页第一版 UI：

- `新建 session` 按钮。
- 表单字段：
  - Provider
  - Title
  - Project path
  - Provider args
- 操作：
  - `创建`
  - `创建并进入`

创建成功后刷新 session list。默认停留在列表；如果选择“创建并进入”，跳转到
`/remote/session/:id`。

## 改动规模

Direct-only 创建是小改，因为现有 Gateway 已有 `POST /api/sessions`。

Direct + Relay 统一创建是中等改动：

- `packages/protocol`：新增 create session request / result / failed frame 类型。
- `apps/relay`：接收 Web create frame、校验 scope、转发给 Gateway、按 requestId 回传结果。
- `apps/gateway`：Relay client 处理 create frame，并复用 HTTP 创建校验和 runner spawn。
- `apps/web`：Sessions 页新增创建入口，Direct 走 HTTP，Relay 走 requestId frame。
- 测试：Relay frame 转发、Gateway Relay 创建、Web 创建失败/成功状态。

如果再加 preset、参数历史、路径白名单、创建并进入自动 attach、多用户策略，范围会变成中等偏大。

## 推荐拆法

第一步先做统一协议和最小 UI：

- 只支持白名单 provider。
- 只支持显式输入 projectPath / providerArgs。
- 创建成功刷新列表。
- 可选“创建并进入”。

第二步再补体验能力：

- presets。
- 最近 projectPath。
- providerArgs 历史。
- projectPath 白名单管理。
- 更细的创建审计和失败提示。

