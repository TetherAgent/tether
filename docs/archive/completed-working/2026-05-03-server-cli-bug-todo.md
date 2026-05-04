# Server / CLI / Gateway 关联逻辑 Bug TODO（归档）

状态：Completed Archive  
归档时间：2026-05-04  
说明：本文原为 `docs/working/` bug TODO。已完成项归档；仍未完成的 token/auth 问题已拆到 `docs/working/2026-05-04-token-auth-unfinished-items.md`。

状态：Working  
创建时间：2026-05-03  
范围：`apps/server`、`apps/cli`、`apps/gateway`、`apps/relay`、`apps/web`、`apps/admin-web`、`packages/http`

## 2026-05-03 本轮已验证

- `pnpm --filter @tether/gateway typecheck`
- `pnpm --filter @tether/gateway test`
- `pnpm --filter @tether/relay typecheck`
- `pnpm --filter @tether/relay test`
- `pnpm --filter @tether/web typecheck`
- `pnpm --filter @tether/server typecheck`
- `pnpm --filter @tether/server test`
- `pnpm --filter @tether/cli typecheck`
- `pnpm --filter @tether/cli test`

## 总结

这轮检查发现的主线问题是认证和响应协议没有贯穿一致：

- Server 已统一返回 `{ code, msg, data, stack? }`。
- CLI / Gateway / Relay 多处仍按旧的“接口直接返回业务 payload”解析。
- `/api/token/validate` 被全局登录中间件保护，但 Gateway / Relay 的 token introspection 调用没有 `Authorization`，会先被挡住。
- Web 登录态只覆盖部分 Gateway 写接口，直接读接口仍裸请求，LAN 暴露时会泄露 session 与终端输出。

## P0：必须优先修

- [x] **TODO-001：`tether gateway login` 解析 server 响应错误**

  影响：CLI 调 `/api/gateway/bind` 后直接读取 `body.gateway`、`body.gatewayAccessToken`；但 server controller 走 `ctx.success(data)`，真实响应是 `{ code: 200, msg: 'success', data: { gateway, gatewayAccessToken, ... } }`。因此登录会误报 `Gateway 登录失败：响应缺少必要字段`，`~/.tether/auth.json` 无法正确写入。

  证据：`apps/cli/src/main.ts:173`、`apps/cli/src/main.ts:181`、`apps/cli/src/main.ts:189`、`apps/server/app/controller/gateway.ts:14`

  修复建议：在 CLI 侧补 `unwrapServerApiResponse<T>()`，或者让 CLI 可复用 `@tether/http` 的响应解包逻辑；`gateway login` 读取 `payload.data.gateway`、`payload.data.gatewayAccessToken`、`payload.data.gatewayRefreshToken`；失败时展示 `payload.msg` 和 `payload.stack`。

  建议测试：新增 CLI 单测 mock `/api/gateway/bind` 返回 `{ code: 200, data: ... }`，断言能写入 `auth.json`；再测 `{ code: 401, msg: 'invalid_credentials' }` 时输出明确错误。

- [x] **TODO-002：`/api/token/validate` 被鉴权中间件挡住，Gateway / Relay introspection 必失败**

  影响：`/api/token/validate` 被挂了 `requireAnyAccess`，且不在 `verifyLoginWhitelist`。Gateway/Relay 调用时只传 body `{ token }`，不传 `Authorization`，请求会在 controller 前返回 `Token 必填`，导致本地 Gateway API 写操作、WS ticket、Relay token auth 全部判定 `invalid_token`。

  证据：`apps/server/app/router.ts:27`、`apps/server/config/config.default.ts:166`、`apps/gateway/src/daemon.ts:752`、`apps/gateway/src/daemon.ts:753`、`apps/relay/src/main.ts:29`

  修复建议：明确 introspection 规范，推荐将 `/api/token/validate` 设计为 server-to-server 校验接口：加入 `verifyLoginWhitelist`，去掉 route 上的 `requireAnyAccess`，但只返回最小 scope；如担心滥用，再加 `TETHER_SERVER_INTROSPECTION_SECRET` header。Gateway / Relay 调用该接口时统一解包 `ApiResponse`。

  建议测试：Egg request 测试覆盖无 `Authorization` 调 `/api/token/validate` 但 body 有 token 时能返回 `{ code: 200, data: scope }`；坏 token 返回业务 `401` code。

- [x] **TODO-003：Gateway `validateAccessToken()` 按裸 payload 解析，和 server 统一响应不兼容**

  影响：即使 `/api/token/validate` 放行，Gateway 仍会把 `{ code, msg, data }` 当成 `AuthScopePayload`，`typeof payload.accountId === 'string'` 会失败，最终所有受保护 Gateway API 返回 `invalid_token`。

  证据：`apps/gateway/src/daemon.ts:671`、`apps/gateway/src/daemon.ts:761`、`apps/server/app/controller/token.ts:15`

  修复建议：在 `apps/gateway` 新增 server API helper，例如 `readServerApiData<T>(response)`；`validateAccessToken()` 只读取 `payload.data`，并校验 `accountId/workspaceId/tokenClass/expiresAt/jti`；错误返回保留 `msg`，便于 CLI 和 web 诊断。

  建议测试：修改 `apps/gateway/src/daemon.test.ts` 的 auth fixture，让 `/api/token/validate` 返回 wrapped response；覆盖 `POST /api/ws-ticket`、`POST /api/sessions`、`POST /api/sessions/:id/stop`。

- [x] **TODO-004：Relay server token 校验也按裸 payload 解析，真实 server 下认证失败**

  影响：Relay `main.ts` 的 `validateToken` 直接返回 server JSON；Relay `authenticateGatewayFrame()` / `authenticateClientFrame()` 期望返回 `RelayAuthScope`。实际拿到 `{ code, msg, data }` 后 `scope.tokenClass` 是 `undefined`，会报 `wrong_token_class`。

  证据：`apps/relay/src/main.ts:27`、`apps/relay/src/main.ts:37`、`apps/relay/src/relay.ts:385`、`apps/relay/src/relay.ts:389`、`apps/relay/src/relay.ts:409`、`apps/relay/src/relay.ts:413`

  修复建议：Relay 复用同一套 `unwrapServerApiResponse<T>()` 思路；`validateToken` 返回 `payload.data`；对 `code !== 200` 返回 `undefined` 并记录最小错误日志，不打印 token。

  建议测试：`apps/relay/src/relay.test.ts` 增加 wrapped validateToken fixture；覆盖 gateway auth 和 client auth 成功/失败。

- [x] **TODO-005：Relay Gateway ID 认证后和后续 frame 不一致**

  影响：Gateway 认证帧发送的是 `auth.gatewayId`，但 `startDaemon()` 传给 `startRelayClient()` 的 `gatewayId` 默认是 `gw_${pid}_${port}`。Relay 认证通过后要求后续 gateway frame 的 `gatewayId` 与认证时一致，结果 `gateway.sessions` 等后续帧可能因为 `gatewayId` 不一致被 Relay 关闭。

  证据：`apps/gateway/src/daemon.ts:556`、`apps/gateway/src/daemon.ts:573`、`apps/gateway/src/relay-client.ts:81`、`apps/gateway/src/relay-client.ts:126`、`apps/relay/src/relay.ts:132`

  修复建议：`startRelayClient()` 连接时先解析有效 auth，得到 `effectiveGatewayId`；后续 `gateway.sessions`、`gateway.replay`、`gateway.event`、`gateway.error` 全部使用 `effectiveGatewayId`；本地 registry 临时 ID 只用于本地 URL 展示，不参与 Relay scope。

  建议测试：Relay client 测试里让本地 `options.gatewayId` 与 auth scope gatewayId 不同，断言认证后 `gateway.sessions.gatewayId` 使用 auth scope 的 ID，Relay 不关闭连接。

- [x] **TODO-006：直接访问 Gateway 的读接口未鉴权，会泄露 session 和终端输出**

  影响：Web 登录后，写操作加了 `Authorization`，但 session 列表、snapshot、events、clients 仍裸 `fetch`。Gateway 对这些读接口也没有 `authorizeRequest`。如果用户用 `--host 0.0.0.0` 暴露 LAN，未登录访问者可以读取 session 列表、历史事件和终端输出。

  证据：`apps/gateway/src/daemon.ts:139`、`apps/gateway/src/daemon.ts:232`、`apps/gateway/src/daemon.ts:295`、`apps/gateway/src/daemon.ts:305`、`apps/web/src/main.tsx:324`、`apps/web/src/main.tsx:586`、`apps/web/src/main.tsx:716`、`apps/web/src/main.tsx:893`

  修复建议：Gateway `/api/*` 默认要求 token，页面 HTML 和静态 assets 公开；读接口调用 `authorizeRequest()` 后再 `authorizeSessionAccess()`；`apps/web` 抽 `gatewayFetch()`，所有 Gateway API 自动注入 `normalAuth.accessToken`，401 时清理登录态并跳转登录。

  建议测试：Gateway 测试覆盖无 token 访问 `/api/sessions`、`snapshot`、`events`、`clients` 返回 401；带正常 token 且 owner 匹配返回成功；owner 不匹配返回 403。

- [x] **TODO-017：Direct WS ticket 放在 query string，容易进入访问日志**

  影响：一次性 `ws_ticket` 原来拼在 `/api/sessions/:id/stream?ticket=...` URL 上，浏览器、代理或服务日志容易记录完整 URL。虽然 ticket 只有 60 秒且一次性，但仍属于不必要的凭据暴露面。

  证据：`apps/cli/src/main.ts:1055`、`apps/web/src/main.tsx:1043`、`apps/gateway/src/daemon.ts:425`

  修复建议：客户端改用 WebSocket subprotocol `tether-ticket.<ticket>` 携带 ticket；Gateway 优先从 `Sec-WebSocket-Protocol` 读取 ticket，短期保留 query fallback 兼容旧客户端。

  建议测试：Gateway WS 测试改为 subprotocol 携带 ticket，覆盖 observe/control、resize、重复 controller 等路径。

- [x] **TODO-018：Relay 控制帧需要按 session scope 做强校验**

  独立方案文档已完成并归档：
  `docs/archive/completed-working/2026-05-04-relay-control-frame-scope.md`。

  影响：Relay 目前已在连接认证阶段通过 server `/api/token/validate` 拿到 `RelayAuthScope`，并在 `client.list` / `client.subscribe` 时用 `clientCanSeeSession()` 过滤 session。但 `client.input`、`client.resize`、`client.stop` 等控制帧仍主要依赖“先订阅成功”这一状态，`clientCanAccessFrameSession()` 对 `normal_client_access` 没有再次根据 `latestSessions.get(sessionId)` 校验 `accountId/workspaceId/userId/gatewayId`。这能跑，但安全边界不够硬；如果后续出现订阅状态残留、异常 frame 顺序或 legacy/unscoped session，就可能绕过每帧 ownership 校验。

  当前 Gateway 现状：Gateway 已具备支撑强校验的字段链路。`apps/gateway/src/store.ts` 的 `Session` 有 `accountId/workspaceId/userId/deviceId/gatewayId`；`apps/gateway/src/pty.ts` 创建 PTY session 时会写入 `owner`；`apps/gateway/src/daemon.ts` 通过认证 API 创建 session 时传入 actor scope；`apps/gateway/src/relay-client.ts` 的 `toRelaySession()` 会把这些字段转发给 Relay。也就是说，经过 server/Gateway auth 创建的 session 字段是齐的。风险只在旧的本地 CLI / inline / 未经 auth actor 创建的 legacy session，它们可能没有 scope 字段。

  证据：`apps/relay/src/relay.ts:259`、`apps/relay/src/relay.ts:421`、`apps/relay/src/relay.ts:458`、`apps/relay/src/relay.ts:478`、`apps/gateway/src/relay-client.ts:317`、`apps/gateway/src/pty.ts:68`、`apps/gateway/src/daemon.ts:228`

  修复建议：在 Relay 内新增统一函数，例如 `clientCanAccessSession(clientScope, sessionId, gatewayScope)`：先 `latestSessions.get(sessionId)`，不存在直接 forbidden；存在则复用 `clientCanSeeSession(clientScope, session, gatewayScope)`。把 `client.input`、`client.resize`、`client.stop`、`client.detach`、`sendReplay()`、`sendEventToSubscribers()` 都改成基于真实 session scope 判断。保留 `ws_ticket` 的 `sessionId/mode` 限制。token 模式下，缺少 `accountId/workspaceId/gatewayId` 的 session 不应转给普通 Web client；只有显式 legacy secret 模式才允许 unscoped session。

  建议测试：在 `apps/relay/src/relay.test.ts` 补跨 scope 用例：A 用户能 list/subscribe/input 自己的 session；B 用户看不到 A session；B 用户伪造 `client.subscribe/input/resize/stop` 指向 A session 时返回 `forbidden`；`ws_ticket` 只能访问 ticket 内的 `sessionId` 和 `mode`；缺少 scope 的 session 在 token 模式下不可见或不可控。

## P1：高风险业务问题

- [ ] **TODO-007：MySQL 设备列表/统计查错 token_class**

  影响：设备写入 `devices.token_class = 'device_identity'`，但管理后台设备列表和 dashboard 统计按 `normal_client_access` 查。Runtime 模式能看到设备，MySQL 模式设备列表/统计会是 0。

  证据：`apps/server/app/service/authRepository.ts:365`、`apps/server/app/service/authRepository.ts:558`、`apps/server/app/service/authRepository.ts:584`、`apps/server/app/service/authRepository.ts:601`

  修复建议：如果 `devices` 表表示设备身份，查询统一按 `device_identity`，或直接去掉 `token_class` 过滤；同时把 `DeviceRecord` 扩展 `revokedAt`，避免 runtime 删除设备、MySQL 标记吊销的语义分裂。

  建议测试：补 repository 测试或 SQL mock，断言 `countDevices()`、`countActiveDevices()`、`loadAllDevices()` 不再按 `normal_client_access` 过滤；补 admin dashboard 测试。

- [ ] **TODO-008：access token revoke 不会撤销对应 refresh token**

  影响：access token 和 refresh token 的 jti 是两个不同值。`revokeToken(rawToken)` 只按当前 token 的 jti 更新 refresh token 表。如果传入 access token，只会把 access jti 加进 revoked list，不会撤销同一设备/会话下的 refresh token，用户可以继续用旧 refresh token 换新 access token。

  证据：`apps/server/app/utils/auth-token.ts:96`、`apps/server/app/utils/auth-token.ts:102`、`apps/server/app/service/auth.ts:661`、`apps/server/app/service/auth.ts:676`

  修复建议：把 revoke 语义拆清楚：`revokeTokenJti()` 只撤单 token，`logoutDevice()` 撤销当前 device 下所有 refresh token，`revokeDevice()` 撤设备和 refresh token；前端 logout 调服务端 logout，并优先传 refresh token 或 deviceId。

  建议测试：注册/登录后保留 refresh token，调用 access token logout/revoke，再尝试 refresh，应失败；单独 token validate 仍按 jti 语义测试。

- [ ] **TODO-009：公共 `/api/audit` 信任请求体身份，容易伪造审计**

  影响：`/api/audit` 受全局登录保护，但没有路由级 token class 限制。Controller 直接使用 body 里的 `accountId/userId/adminUserId/deviceId/gatewayId`，任意已登录 token 可以写入任意 accountId 的审计事件，审计可信度被破坏。

  证据：`apps/server/app/router.ts:29`、`apps/server/app/controller/audit.ts:8`、`apps/server/app/controller/audit.ts:10`、`apps/server/app/controller/audit.ts:11`

  修复建议：优先删除公共写入接口，只保留 service 内部写 audit；如果要保留上报接口，身份只能来自 `ctx.state.auth`，body 只允许传 `action/sessionId/payload` 等业务字段；gateway 上报需单独 token class 或 `gateway_access`。

  建议测试：用 normal token 伪造其他 accountId 写 audit 应失败或被覆盖为当前 accountId；admin 查询只能看到当前 scope 内事件。

- [ ] **TODO-010：管理员管理缺少角色/自删/最后管理员保护**

  影响：任何 `management_access` 都可以创建/删除管理员。没有 `super_admin` 检查，没有禁止删除自己，也没有禁止删除最后一个管理员。

  证据：`apps/server/app/router/admin.ts:10`、`apps/server/app/router/admin.ts:11`、`apps/server/app/controller/admin/admins.ts:13`、`apps/server/app/service/admin/admins.ts:30`

  修复建议：在 `admin.admins` service 里根据 `ctx.state.auth.adminUserId` 读取当前 admin；只有 `super_admin` 可创建/删除 admin；禁止删除当前登录 admin；禁止删除最后一个 `super_admin`；创建 admin 也应走 `admin.admins.createAdminManager()`，不要 controller 直接调用 `auth.registerManagementUser()`。

  建议测试：普通 admin 创建/删除返回 403；super_admin 可以创建；删除自己返回 400/403；删除最后一个 super_admin 返回 409。

- [x] **TODO-011：CLI `gateway verify` 停止验证 session 时未带 auth header**

  影响：`createSessionViaGateway()` 创建 session 时带了 `gatewayAuthHeaders()`，但 `verifyGatewaySession()` 停止 session 时没有带 auth header。Gateway stop endpoint 已要求 auth，所以 verify 会创建成功后停止失败。

  证据：`apps/cli/src/main.ts:921`、`apps/cli/src/main.ts:926`、`apps/gateway/src/daemon.ts:345`、`apps/gateway/src/daemon.ts:346`

  修复建议：`verifyGatewaySession()` stop 请求加 `headers: await gatewayAuthHeaders()`；如果创建成功但 stop 失败，要输出 session id 和手工清理命令，避免遗留进程。

  建议测试：CLI verify 测试 mock Gateway，断言 create 和 stop 都携带 `Authorization`。

- [ ] **TODO-012：CLI `send` 硬编码 `127.0.0.1:4789`**

  影响：`tether send` 不读取 `~/.tether/config.json`，也没有 `--host/--port` 参数。用户只要改了 Gateway 端口，或常驻 Gateway 不在 4789，send 就失败。

  证据：`apps/cli/src/main.ts:682`、`apps/cli/src/main.ts:670`

  修复建议：给 `send` 增加 `--host` / `--port`，默认值来自 `resolveGatewayConfig()`；和 `attach`、`stop`、`verify` 的 Gateway 定位逻辑保持一致；错误信息里显示实际访问 URL。

  建议测试：配置非默认端口后执行 `send`，断言请求目标端口来自 config；CLI 参数覆盖 config。

## P2：需要收敛的稳定性/一致性问题

- [ ] **TODO-013：Server / Gateway / Relay API 响应协议不统一**

  影响：Server 是 `{ code, msg, data }`；Gateway/Hono 和 Relay HTTP 当前还是 `{ error }` 或业务裸 JSON；`apps/web` 同时使用 `@tether/http` 和裸 `fetch`，错误处理分散。

  证据：`apps/server/app/extend/context.ts:19`、`apps/gateway/src/daemon.ts:81`、`apps/web/src/main.tsx:324`、`packages/http/src/index.ts:101`

  修复建议：明确协议边界：远程 server 固定 `ApiResponse`；本地 Gateway 如果短期保持裸 JSON，则前端必须有两个 client：`serverApi` 和 `gatewayApi`；不要让 `@tether/http` 同时处理两种响应形态。

  建议测试：前端 API 层单测覆盖 server wrapped error、Gateway HTTP status error、网络错误三种路径。

- [ ] **TODO-014：Gateway auth.json 有 refreshToken 但没有自动 refresh**

  影响：`auth.json` 保存了 refresh token，但 CLI/Gateway 只检查 access token `expiresAt`，过期就要求重新 login。长驻 Gateway / Relay 会在 token 到期后直接失效，不会自动续期。

  证据：`apps/cli/src/main.ts:100`、`apps/cli/src/main.ts:1141`、`apps/cli/src/main.ts:1143`、`apps/gateway/src/daemon.ts:722`、`apps/server/app/controller/gateway.ts:17`

  修复建议：抽 `GatewayAuthStore`，提供 `readValidAccessToken()`；access token 过期前或过期后自动调用 `/api/gateway/refresh`，成功后原子写回 `auth.json`；refresh 失败再提示重新 `tether gateway login`。

  建议测试：构造过期 access + 有效 refresh，调用 Gateway API 时自动 refresh 并写回；refresh 失败时返回 `gateway_auth_expired`。

- [ ] **TODO-015：Server 测试只覆盖 runtime fallback，没有覆盖 MySQL SQL 分支**

  影响：当前测试通过不代表生产 MySQL 模式可用。`token_class` 查询错误这类问题 runtime 测试完全发现不了。

  证据：`apps/server/test/app/service/auth.test.ts:8`、`apps/server/app/service/authRepository.ts:26`

  修复建议：新增 repository SQL 层测试。短期可 mock `ctx.service.db.query()` 捕获 SQL 和参数；中期加可选 MySQL integration 测试。

  建议测试：覆盖设备、refresh revoke、admin list、audit filter 的 MySQL SQL 分支。

- [ ] **TODO-016：`verifySignedToken()` 对不同长度签名会抛底层异常**

  影响：`timingSafeEqual` 要求 buffer 长度一致。畸形 token 的 signature 长度不一致时，会抛 Node 原始错误，而不是标准 `invalid_signature`。

  证据：`apps/server/app/utils/auth-token.ts:66`

  修复建议：复用 Gateway `safeEqual()` 思路，先比较长度，不一致直接 `throw new Error('invalid_signature')`；所有 token decode 失败统一映射到 `invalid_token` 或 `invalid_signature`。

  建议测试：传入签名长度不一致的三段 token，断言返回 `invalid_signature`，不会抛底层 `Input buffers must have the same byte length`。

## 修复顺序建议

- [x] 第一波：统一 server API 解包，让 CLI / Gateway / Relay 都能正确读取 `{ code, data }`。
- [x] 第二波：定义并修复 `/api/token/validate` introspection 规范。
- [x] 第三波：修 Gateway 读接口鉴权和 web 统一注入 token。
- [x] 第四波：修 Relay gatewayId 一致性。
- [ ] 第五波：修 MySQL 设备查询、token revoke、admin 权限。
- [ ] 第六波：补 server wrapped response、Gateway auth、Relay auth、MySQL repository SQL 测试。
