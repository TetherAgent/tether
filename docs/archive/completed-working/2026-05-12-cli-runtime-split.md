# CLI runtime split

本文记录 `apps/cli/src/main.ts` 的分层拆分计划、TODO 和验收项目。目标是降低 CLI 入口文件耦合，不改变用户命令、协议 frame、Gateway/Relay 行为和发布包入口。

## 不做的事

- 不改 `tether start/stop/restart/status/run/ls/login/logout/debug` 的用户行为。
- 不改 Relay / Gateway / Client 协议字段。
- 不引入通用 `relay/client.ts` 抽象。
- 不拆 `apps/cli` package。
- 不改 `launchd.ts` 的业务行为；`serve` 仍是隐藏内部命令。
- 不碰归档文档。

## 目标目录

```text
apps/cli/src/
  main.ts                  # Node 版本检查、Command 创建、注册 commands、parseAsync

  commands/
    login.ts
    logout.ts
    start.ts
    stop.ts
    restart.ts
    status.ts
    run.ts
    ls.ts
    debug.ts
    serve.ts

  gateway/
    supervisor.ts          # start/stop/restart foreground/background
    status.ts              # printGatewayStatus + status formatter
    doctor.ts              # runGatewayDoctor + runtime/provider checks
    logs.ts
    probe.ts               # find/fetch/wait Gateway status
    urls.ts                # gatewayApiUrl

  auth/
    gateway-auth-store.ts  # auth.json read/write/refresh/summary
    gateway-login.ts       # browser login + callback server
    device-state.ts        # device.json
    token.ts               # decodeTokenPayload

  relay/
    sessions.ts            # list/create/stop 短请求

  attach/
    pty-attach.ts          # 长连接 attach，自己管理 WS 生命周期
    terminal-state.ts

  utils/
    errors.ts
    prompt.ts
    package-version.ts
    sleep.ts
    values.ts
    server-api.ts
    process.ts

  launchd.ts
  terminal.ts
```

## 边界规则

- `relay/sessions.ts` 只处理短生命周期 Relay 请求：`listSessionsViaRelay`、`createSessionViaRelay`、`stopSessionViaRelay`。
- `attach/pty-attach.ts` 只处理长生命周期全双工 attach：认证、subscribe、stdin/stdout、resize、reconnect、detach/stop。
- `utils/server-api.ts` 放 `unwrapServerApiData`，避免 `relay/` 反向依赖 `auth/`。
- `forwarding.ts` 不迁移；先确认是否只有测试引用，再决定删除或把测试改到真实创建 payload 路径。

## Wave 0：只读确认

- [x] 确认 `forwarding.ts` 引用方。
  - 结果：生产代码没有引用；只有 `apps/cli/test/main.test.ts` 直接测试 `buildCreateSessionPayload`。
- [x] 确认当前测试覆盖。
  - 结果：CLI 当前主要是源码字符串断言、`launchd` plist 断言和 `runningSessionIds` 单元测试。
- [x] 列出 `main.ts` 函数归属。

| 当前函数/类型 | 目标归属 |
| --- | --- |
| `resolvePackageVersion` | `utils/package-version.ts` |
| `isNodeError` / `NonTetherGatewayError` | `utils/errors.ts` |
| `sleep` | `utils/sleep.ts` |
| `stringValue` / `numberValue` / `booleanValue` | `utils/values.ts` |
| `promptLine` / `promptRequiredLine` | `utils/prompt.ts` |
| `unwrapServerApiData` | `utils/server-api.ts` |
| `commandAvailable` / `openBrowser` / `findAvailablePort` | `utils/process.ts` |
| `gatewayAuthPath` / `readFreshGatewayAuthState` / `refreshGatewayAuthState` / `gatewayAuthSummary` | `auth/gateway-auth-store.ts` |
| `performGatewayLogin` / `waitForGatewayAuthCallback` / `resolveGatewayLoginServerUrl` | `auth/gateway-login.ts` |
| `loadOrCreateDeviceState` / `deviceStatePath` | `auth/device-state.ts` |
| `decodeTokenPayload` | `auth/token.ts` |
| `listSessionsViaRelay` / `createSessionViaRelay` / `stopSessionViaRelay` | `relay/sessions.ts` |
| `attachPtySession` / `attachPtySessionOnce` / attach close/auth helpers | `attach/pty-attach.ts` |
| `startGatewayBackground` / `startGatewayForeground` / `stopGatewayBackground` / `ensureGatewayAuthForProfile` | `gateway/supervisor.ts` |
| `printGatewayStatus` and status formatters | `gateway/status.ts` |
| `runGatewayDoctor` / `checkNodePty` / `checkGatewayRuntimeInfo` / `verifyGatewaySession` | `gateway/doctor.ts` |
| `showGatewayLogs` / `gatewayLogPaths` | `gateway/logs.ts` |
| `findPersistentGateway` / `gatewayCandidateUrls` / `fetchGatewayStatus*` / `waitForStartedGateway` | `gateway/probe.ts` |
| `gatewayApiUrl` | `gateway/urls.ts` |
| `relayClientUrl` | `relay/sessions.ts` for now; only split if another Relay short-request module appears |
| `parseGatewayLoginEnvOption` / `gatewayProfileFromEnv` | `config/profiles.ts` or command-local helper |

## Wave 1：抽 utils

- [x] 新建 `utils/values.ts`。
- [x] 新建 `utils/sleep.ts`。
- [x] 新建 `utils/errors.ts`。
- [x] 新建 `utils/package-version.ts`。
- [x] 新建 `utils/prompt.ts`。
- [x] 新建 `utils/server-api.ts`。
- [x] 新建 `utils/process.ts`。
- [x] 更新 `main.ts` imports，删除已迁出的本地函数。

验收：

- [x] `pnpm --filter @tether-labs/cli typecheck`
- [x] `pnpm --filter @tether-labs/cli test`
- [x] `pnpm tether --help` 不暴露 hidden `serve`，不恢复 `gateway` 命名空间。

## Wave 2：抽 auth

- [x] `auth/gateway-auth-store.ts`
- [x] `auth/gateway-login.ts`
- [x] `auth/device-state.ts`
- [x] `auth/token.ts`

验收：

- [x] `tether login` callback server 相关测试仍通过。
- [x] `tether status` 能读取 auth/device summary。
- [x] `tether start` 仍能触发 auth refresh 检查。

## Wave 3：抽 relay/sessions + attach

- [x] `relay/sessions.ts`
- [x] `attach/pty-attach.ts`
- [x] `attach/terminal-state.ts`

验收：

- [x] 自动验证：`pnpm --filter @tether-labs/cli typecheck`
- [x] 自动验证：`pnpm --filter @tether-labs/cli test`
- [ ] 人工 UAT：`tether run <provider>` 创建 session 后仍自动 attach。
- [ ] 人工 UAT：`tether ls` 仍走 Relay list。
- [ ] 人工 UAT：`tether stop <id>` / `tether stop --all` 仍走 Relay stop。
- [ ] 人工 UAT：Ctrl-C stop、Ctrl-A detach、resize、reconnect 行为不变。

## Wave 4：抽 gateway/*

- [x] `gateway/supervisor.ts`
- [x] `gateway/status.ts`
- [x] `gateway/doctor.ts`
- [x] `gateway/logs.ts`
- [x] `gateway/probe.ts`
- [x] `gateway/urls.ts`

验收：

- [x] 自动验证：`pnpm --filter @tether-labs/cli typecheck`
- [x] 自动验证：`pnpm --filter @tether-labs/cli test`
- [ ] `tether start` 启动过程仍打印进度。
- [ ] `tether stop` 仍停止 LaunchAgent 和残留 Gateway 进程。
- [ ] `tether restart` 仍复用 stop + start。
- [ ] `tether status` 输出字段不减少。
- [ ] `tether debug` 菜单仍可进入 doctor/logs/url。

## Wave 5：抽 commands/*

- [x] `commands/login.ts`
- [x] `commands/logout.ts`
- [x] `commands/start.ts`
- [x] `commands/stop.ts`
- [x] `commands/restart.ts`
- [x] `commands/status.ts`
- [x] `commands/run.ts`
- [x] `commands/ls.ts`
- [x] `commands/debug.ts`
- [x] `commands/serve.ts`
- [x] `main.ts` 只保留 command 初始化和注册。

验收：

- [x] `pnpm tether --help` 命令列表不变。
- [x] `release/bin/tether --help` 命令列表不变。
- [x] `pnpm build:release`
- [x] `npm pack --dry-run` in `release/`
