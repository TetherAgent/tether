# Web Terminal 创建 PTY 会话方案

日期：2026-05-13

## 目标

在 `apps/web` 左侧 Terminal tab 空态和列表区域增加创建入口，支持用户从 Web 创建本机 Gateway 托管的 PTY session。

第一版要支持现有三个 provider：

- `shell`：等价 `tether run shell`
- `claude`：等价 `tether run claude`
- `codex`：等价 `tether run codex`

同时支持两种启动方式：

- 后台启动：Gateway 直接创建 PTY，Web 跳转 `/terminal/:id` 接管。
- 前台启动：Gateway 唤起 macOS Terminal.app，在本机终端里执行 `tether run <provider>`。

## 当前事实

已有基础链路：

- `packages/protocol/src/index.ts` 已定义 `client.new-pty-session`。
- `apps/relay/src/relay.ts` 已能把 `client.new-pty-session` 从 Web/CLI 转发给绑定 Gateway。
- `apps/gateway/src/relay/pty-handler.ts` 已能处理 `client.new-pty-session`。
- `apps/gateway/src/pty/manager.ts` 已通过 `node-pty.spawn(...)` 创建 `pty-event-stream` session。
- `apps/cli/src/commands/run.ts` 已使用 `createSessionViaRelay(...)` 创建 PTY session。
- `apps/web` 已有 `/terminal/:id` 和 TerminalPane 接管能力。

所以后台启动不是从零做，主要缺 Web 创建入口和安全收口。

## 设计原则

1. Web 不传任意 command。
2. Web 只传 provider 白名单：`shell` / `claude` / `codex`。
3. Gateway 决定实际 command、args、env、cwd。
4. 第一版不开放自由 cwd、env、provider args。
5. PTY 永远由 Gateway 托管，Web 只是发起创建和接管 UI。
6. 前台启动只做 macOS Terminal.app 简单版，不先做 `tether attach <sessionId>`。

## 启动模式

### 1. 后台启动

流程：

```text
Web 点击新建
  -> Relay WS 发送 client.new-pty-session
  -> Relay 转发给当前绑定 Gateway
  -> Gateway 调 PtySessionManager.create(...)
  -> Gateway 返回 gateway.session-created
  -> Web 跳转 /terminal/:sessionId
```

Web frame 建议：

```ts
{
  type: 'client.new-pty-session',
  provider: 'shell' | 'claude' | 'codex',
  launchMode: 'background',
  clientRequestId: 'uuid'
}
```

Gateway 内部映射：

```text
shell  -> shell provider command
claude -> claude provider command
codex  -> codex provider command
```

验收重点：

- 创建成功后 Web 立即进入 `/terminal/:id`。
- 左侧 Terminal 列表出现该 session。
- session transport 为 `pty-event-stream`。
- Web 刷新后仍能从列表进入。

### 2. 前台启动

第一版前台启动只做简单版：

```text
Web 点击“在本机终端打开”
  -> Relay WS 发送 client.new-pty-session + launchMode=local-terminal
  -> Relay 转发给 Gateway
  -> Gateway 用 osascript 打开 Terminal.app
  -> Terminal.app 执行 tether run <provider>
  -> CLI 自己创建 PTY session
  -> Relay sessions frame 推送到 Web
  -> 左侧列表出现新 session
```

Gateway 实际执行形态：

```bash
osascript -e 'tell application "Terminal" to do script "cd /path && tether run shell"'
```

注意：

- 前台启动第一版不保证立即返回 `sessionId`。
- Web 成功提示即可：`已在本机终端打开，session 创建后会出现在左侧列表`。
- 后续如需立即拿到 sessionId，再补 `tether attach <sessionId>` 方案。
- `osascript` 必须用 `execFile` / `spawn` 列表参数调用，不要拼 shell 字符串。
- AppleScript 里的命令字符串必须做 AppleScript 字符串转义，不等同于 shell quote。

## 目录架构建议

整体原则：

- 协议类型只放 `packages/protocol`。
- Relay 继续集中在 `apps/relay/src/relay.ts`，第一版不拆新目录。
- Gateway 的 PTY 创建和本机终端唤起都归到 `apps/gateway/src/pty/`。
- Web 的 Terminal 创建 UI 放 `apps/web/src/components/terminal/`，不要塞进 chats。
- Web 的共享 WS 能力继续放现有 `apps/web/src/components/relay/`。

建议目标结构：

```text
packages/protocol/src/
  index.ts
    # client.new-pty-session 增加 launchMode

apps/relay/src/
  relay.ts
    # 继续负责 client.new-pty-session 转发和权限校验

apps/gateway/src/relay/
  frame-router.ts
    # 继续路由 client.new-pty-session 到 pty-handler
  pty-handler.ts
    # 解析 launchMode，调用后台创建或前台唤起
  relay-sender.ts
    # 继续发送 gateway.session-created / error

apps/gateway/src/pty/
  manager.ts
    # 现有后台 PTY 创建，继续由 node-pty.spawn 托管
  local-terminal.ts
    # 新增：macOS Terminal.app 唤起逻辑，封装 osascript

apps/web/src/components/relay/
  relay-client-provider.tsx
    # 继续维护共享 Relay WS；增加 createPtySession 方法或暴露 send/request helper

apps/web/src/components/terminal/
  terminal-session-picker.tsx
    # 现有 /terminal 空态说明，可扩展创建入口
  terminal-create-session.tsx
    # 新增：Shell / Claude / Codex 创建 UI
  terminal-pane.tsx
    # 不承载创建逻辑，只负责接管已有 session

apps/web/src/components/workbench/
  workbench-sidebar.tsx
    # 可显示 Terminal 列表中的创建入口；不直接写 WS 细节
```

### 文件职责边界

| 文件 | 职责 | 不做 |
| --- | --- | --- |
| `packages/protocol/src/index.ts` | 定义 frame 类型 | 不写业务判断 |
| `apps/relay/src/relay.ts` | 鉴权、Gateway 绑定校验、转发 | 不解释 provider、不 spawn |
| `apps/gateway/src/relay/pty-handler.ts` | 处理创建请求，选择 background/local-terminal | 不拼 UI 文案 |
| `apps/gateway/src/pty/manager.ts` | 后台 PTY 生命周期 | 不打开系统 Terminal.app |
| `apps/gateway/src/pty/local-terminal.ts` | 打开 macOS Terminal.app 执行固定 `tether run <provider>` | 不创建 PTY、不做 attach |
| `apps/web/src/components/relay/relay-client-provider.tsx` | Web 共享 WS 请求能力 | 不渲染按钮 |
| `apps/web/src/components/terminal/terminal-create-session.tsx` | 创建按钮、loading、toast | 不直接操作 WebSocket 底层 |
| `apps/web/src/components/terminal/terminal-pane.tsx` | 接管已有 PTY session | 不负责新建 |

### 为什么这样拆

- `terminal-pane.tsx` 保持纯接管视图，避免继续膨胀。
- `relay-client-provider.tsx` 是 Web 当前共享 WS 真相源，创建 PTY 也应该从这里发 request。
- `local-terminal.ts` 独立出来，方便以后加 iTerm2 / WezTerm，而不污染 PTY manager。
- Relay 不理解 provider，避免 Relay 变成业务编排层。

## 改动范围

### packages/protocol

目标：补齐启动模式和收紧语义。

TODO：

- [ ] 给 `client.new-pty-session` 增加 `launchMode?: 'background' | 'local-terminal'`。
- [ ] 给 `client.new-pty-session` 增加 `clientRequestId?: string`，用于 Web 关联创建响应。
- [ ] 把 `RelayClientToServerFrame['client.new-pty-session']` 里的 `command` 改为可选：`command?: string`。
- [ ] 把 `cwd` 改为可选：`cwd?: string`。Web 第一版不传，由 Gateway 使用默认 project path。
- [ ] 把 `cols` / `rows` 改为可选：`cols?: number`、`rows?: number`。Web 第一版可不传，由 Gateway 使用默认尺寸。
- [ ] `gatewayId` 暂时保持必填，Web 从共享 Relay 状态中选择当前绑定 Gateway。
- [ ] `RelayServerToGatewayFrame['client.new-pty-session']` 同步增加 `launchMode` / `clientRequestId`，并允许 `command` / `cwd` / `cols` / `rows` 可选。
- [ ] `gateway.session-created` 增加 `clientRequestId?: string`，让 Web 能精确匹配响应。
- [ ] 新增 `gateway.local-terminal-opened`，用于前台启动成功但暂时没有 `sessionId` 的场景：
  ```ts
  {
    type: 'gateway.local-terminal-opened',
    clientRequestId: string,
    provider: 'shell' | 'claude' | 'codex'
  }
  ```
- [ ] 保留当前字段兼容 CLI：CLI 继续传 `command` / `cwd` / `cols` / `rows`。
- [ ] Web 侧不要传任意 `command` / `providerArgs`。
- [ ] 如需要，可以增加创建失败错误码文档：
  - `gateway_not_bound`
  - `gateway_not_found`
  - `gateway_unauthorized`
  - `session_create_failed`
  - `unsupported_provider`
  - `unsupported_launch_mode`

### apps/relay

目标：继续做转发，不下沉执行逻辑。

TODO：

- [ ] 允许转发 `launchMode`。
- [ ] 允许转发 `clientRequestId`。
- [ ] 保持 Gateway 绑定和 scope 校验。
- [ ] 不在 Relay 里解释 provider。
- [ ] 不需要在 Relay 层过滤 `command`。现有安全边界在 Gateway `onNewPtySession`：`pty-handler.ts` 当前调用时没有把 `frame.command` 传给创建处理器。

验收：

- [ ] 未绑定 Gateway 时返回 `gateway_not_bound`。
- [ ] Gateway 不在线时返回 `gateway_not_found`。
- [ ] scope 不匹配时返回 `gateway_unauthorized`。

### apps/gateway

目标：由 Gateway 负责 provider 映射和真实创建。

TODO：

- [ ] 增加 provider 白名单校验：`shell` / `claude` / `codex`。
- [ ] 后台模式复用现有 `PtySessionManager.create(...)`。
- [ ] Web 未传 `cwd` 时使用 Gateway 默认 project path，不能使用浏览器传来的空字符串。
- [ ] Web 未传 `cols` / `rows` 时使用默认尺寸，例如 `120x40`。
- [ ] 前台模式新增 `openLocalTerminalForProvider(...)`。
- [ ] macOS 下用 `execFile` / `spawn` 调 `osascript` 打开 Terminal.app。
- [ ] 非 macOS 返回明确错误：`local_terminal_unsupported`。
- [ ] 前台模式只执行固定命令：`tether run <provider>`。
- [ ] 前台模式命令里的 cwd 必须分别处理两层转义：
  - shell 层：`cd <quoted cwd> && tether run <provider>`，cwd 需要 shell quote。
  - AppleScript 层：整条 shell command 作为 AppleScript 字符串，`"`、`\` 等字符需要 AppleScript 字符串转义。
- [ ] `gateway.session-created` 回传 `clientRequestId`。
- [ ] 前台模式如果只是打开 Terminal.app，不返回 `sessionId`，应回 `gateway.local-terminal-opened`；不要复用 `gateway.session-created`，避免 Web 误跳转。

不做：

- [ ] 不开放 Web 自由 command。
- [ ] 不开放 Web 自由 args。
- [ ] 不开放 Web 自由 env。
- [ ] 不实现 iTerm / WezTerm / Ghostty 适配。

验收：

- [ ] `shell` 后台创建成功。
- [ ] `claude` 后台创建成功。
- [ ] `codex` 后台创建成功。
- [ ] `shell` 前台能打开 Terminal.app 并执行 `tether run shell`。
- [ ] `claude` 前台能打开 Terminal.app 并执行 `tether run claude`。
- [ ] `codex` 前台能打开 Terminal.app 并执行 `tether run codex`。
- [ ] 不支持 provider 返回错误，不创建进程。

### apps/web

目标：在 Terminal tab 提供创建入口。

TODO：

- [ ] 从 `relay-client-provider.tsx` 暴露 `createPtySession(...)`，不要让 UI 直接拼 WebSocket 细节。
- [ ] `createPtySession(...)` 生成 `clientRequestId`，发 frame 后等待匹配的 `gateway.session-created` / `gateway.local-terminal-opened` / `error`。
- [ ] 等待响应时必须按 `clientRequestId` 关联，不能靠“下一条 session-created”时序猜测。
- [ ] Web 选择 `gatewayId`：优先使用当前绑定/在线 Gateway；如果有多个 Gateway，第一版可禁用并提示需要先选择 Gateway，或复用现有 Gateway selector 的选中值。
- [ ] 后台创建 frame 第一版不传 `command` / `cwd` / `providerArgs`，`cols` / `rows` 可不传或传默认值。
- [ ] 在 Terminal 空态增加 provider 创建区域。
- [ ] 支持三个 provider：
  - `Shell`
  - `Claude`
  - `Codex`
- [ ] 每个 provider 支持两种动作：
  - `后台启动`
  - `在本机终端打开`
- [ ] 后台启动成功后跳 `/terminal/:id`。
- [ ] 前台启动成功后 toast 提示，不立即跳转。
- [ ] 创建中按钮显示 loading，避免重复点击。
- [ ] Gateway 未连接时禁用创建按钮或显示错误。
- [ ] Relay 未连接时禁用创建按钮或显示错误。

验收：

- [ ] `/terminal` 没有 session 时显示创建入口。
- [ ] Terminal 列表已有 session 时仍能创建新 session。
- [ ] 多个快速创建请求不会串响应；每个请求只处理自己的 `clientRequestId`。
- [ ] 后台 Shell 创建后进入 `/terminal/:id`。
- [ ] 后台 Claude 创建后进入 `/terminal/:id`。
- [ ] 后台 Codex 创建后进入 `/terminal/:id`。
- [ ] 前台启动后 Terminal.app 被打开。
- [ ] 前台启动后 Web 不假装已经拿到 sessionId。
- [ ] 失败时显示 toast，页面不崩溃。

## 安全边界

必须满足：

- [ ] Web 不允许传任意 command。
- [ ] Web 不允许传任意 env。
- [ ] Web 不允许传任意 shell script。
- [ ] Gateway 只接受 provider 白名单。
- [ ] Relay 只转发给当前 client 绑定且有权限的 Gateway。
- [ ] 前台启动 command 必须由 Gateway 拼固定模板。

## 验证清单

### 自动验证

- [ ] `pnpm --filter @tether/protocol typecheck`
- [ ] `pnpm --filter @tether/relay test`
- [ ] `pnpm --filter @tether/gateway test`
- [ ] `pnpm --filter @tether-labs/cli test`
- [ ] `pnpm --filter @tether/web typecheck`
- [ ] `git diff --check`

### 手工 UAT

前置：

- [ ] `tether start` 已运行。
- [ ] Web 显示 Gateway 已连接。
- [ ] Web 显示 Relay 已连接。

后台启动：

- [ ] 打开 `/terminal`。
- [ ] 点击 `Shell -> 后台启动`。
- [ ] 跳转到 `/terminal/:id`。
- [ ] 能输入命令并看到输出。
- [ ] 刷新页面后 history 正常。
- [ ] 左侧列表显示该 session。
- [ ] 重复测试 `Claude -> 后台启动`。
- [ ] 重复测试 `Codex -> 后台启动`。

前台启动：

- [ ] 打开 `/terminal`。
- [ ] 点击 `Shell -> 在本机终端打开`。
- [ ] macOS Terminal.app 被唤起。
- [ ] Terminal.app 中执行 `tether run shell`。
- [ ] 新 session 出现在 Web 左侧 Terminal 列表。
- [ ] 重复测试 `Claude -> 在本机终端打开`。
- [ ] 重复测试 `Codex -> 在本机终端打开`。

回归：

- [ ] `/chats` 默认仍显示 Chats。
- [ ] `/chats/:id` 打开已有 chat 正常。
- [ ] 发送 chat 消息正常。
- [ ] Terminal 订阅和 Chat 订阅互不取消。

## 后续增强

不进入第一版：

- `tether attach <sessionId>`。
- Gateway 先创建 session，再唤起 Terminal.app attach。
- iTerm2 / WezTerm / Ghostty 支持。
- cwd 选择器。
- provider args 输入。
- 自定义 title 输入。
