# Token / Auth 未完成项核验清单

状态：Working  
创建时间：2026-05-04  
来源：从 `docs/archive/completed-working/2026-05-03-server-cli-bug-todo.md` 中按当前代码重新核验 token/auth 相关项  
范围：`apps/server`、`apps/gateway`、`apps/relay`、`apps/cli`

## 结论

以下是代码核验后仍真实未完成的 token/auth 相关问题。已完成的响应解包、
`/api/token/validate` whitelist、Gateway/Relay validate unwrap、Gateway 读接口鉴权、
Direct WS ticket subprotocol 等不再放入本清单。

## 必须继续修

| 原 TODO | 状态 | 问题 | 当前证据 | 建议优先级 |
| --- | --- | --- | --- | --- |
| TODO-008 | 未完成 | access token revoke 不会连带撤销同设备 refresh token | `apps/server/app/service/auth.ts` 的 `revokeToken()` 只 revoke 当前 token 的 `jti`；access token 与 refresh token 的 `jti` 不同 | P0 |
| TODO-014 | 未完成 | Gateway 保存了 refreshToken，但 access token 过期后不会自动 refresh | `apps/gateway/src/daemon.ts` 读取 `auth.json` 后只判断 `expiresAt`，过期返回 `gateway_auth_expired`；未调用 server refresh 接口写回新 token | P1 |
| TODO-007 | 未完成 | MySQL 设备列表和统计仍按旧 token class 查询 | `apps/server/app/service/authRepository.ts` 仍有 `token_class = 'normal_client_access'`；当前设备身份语义不应继续按普通 access token 过滤 | P1 |
| TODO-016 | 未完成 | `verifySignedToken()` 对不同长度 signature 会抛底层异常 | `apps/server/app/utils/auth-token.ts` 直接调用 `timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))`，未先比较长度 | P1 |

## 需要一并收敛的 auth 边界

这些不是纯 token 签发/刷新问题，但会影响 token 身份和权限边界。

| 原 TODO | 状态 | 问题 | 当前证据 | 建议优先级 |
| --- | --- | --- | --- | --- |
| TODO-009 | 未完成 | 公共 `/api/audit` 仍容易信任请求体身份 | audit 写入应从 `ctx.state.auth` 派生 `accountId/userId/adminUserId/deviceId/gatewayId`，不能信 body 里的身份字段 | P1 |
| TODO-010 | 未完成 | management token 只有 token class，缺少 admin role guard | 管理员创建/删除需要 `super_admin`、禁止自删、禁止删除最后一个 `super_admin`，不能只靠 `management_access` | P1 |
| TODO-015 | 未完成 | Server 测试没有覆盖 MySQL SQL 分支 | 当前 runtime fallback 测试抓不到 `token_class` SQL drift，也抓不到生产 MySQL 分支里的 revoke/query 语义问题 | P2 |

## 细化方案

### TODO-008：revoke / logout 语义拆清楚

当前问题不是单纯“没 revoke jti”，而是不同场景的 revoke 语义混在一起：

- `revokeTokenJti()`：只撤单个 token jti。
- `logoutDevice()`：撤当前 device 下所有 refresh token，并撤当前 access jti。
- `revokeDevice()`：撤设备身份，同时撤设备下所有 refresh token。
- `refreshFromToken()`：如果采用 refresh token rotation，成功换新 token 后应 revoke 旧 refresh
  token，避免 refresh token 可重复使用。

验收：

- 用 access token logout 后，旧 refresh token 不能再换新 access token。
- 用 refresh token logout 后，旧 refresh token 不能再使用。
- refresh token rotation 后，旧 refresh token 不能重复刷新。

### TODO-014：Gateway 自动 refresh

建议抽 `GatewayAuthStore`：

- `readValidAccessToken()`：access 未过期直接返回。
- access 过期或接近过期时，用 `refreshToken` 调 `/api/gateway/refresh`。
- refresh 成功后原子写回 `~/.tether/auth.json`。
- refresh 失败才返回 `gateway_auth_expired` 并提示重新 `tether gateway login`。

验收：

- 构造过期 access + 有效 refresh，Gateway API 调用能自动 refresh 并继续成功。
- refresh 失败时返回明确错误，不循环重试，不打印 token。

### TODO-007：MySQL device token_class 查询

需要先确认 `devices.token_class` 的长期语义：

- 如果 `devices` 表表示设备身份，查询应按 `device_identity` 或去掉 token class 过滤。
- 如果设备列表要展示普通客户端 access token，会和设备身份模型冲突，不建议继续这么设计。

验收：

- `countDevices()`、`countActiveDevices()`、`loadAllDevices()` 在 MySQL 分支不再按
  `normal_client_access` 过滤。
- runtime fallback 和 MySQL 分支结果语义一致。

### TODO-016：signature 长度安全比较

修复方式：

- 先把 `signature` 和 `expectedSignature` 转成 Buffer。
- 长度不一致直接抛 `invalid_signature`。
- 长度一致再调用 `timingSafeEqual()`。
- 对外统一映射为标准 token 错误，不泄露 Node 底层异常。

验收：

- 三段 token 中 signature 长度不一致时返回 `invalid_signature`。
- 不出现 `Input buffers must have the same byte length` 之类底层错误。

## 排除项

以下项经当前代码核验，不再算“真实未完成的 token 问题”：

- TODO-002：`/api/token/validate` 已加入 whitelist。
- TODO-003：Gateway validate access token 已解包 server `{ code, data }`。
- TODO-004：Relay validate token 已解包 server `{ code, data }`。
- TODO-006：Gateway 读接口已有 auth 注入和保护方向。
- TODO-017：Direct WS ticket 已支持 WebSocket subprotocol；query fallback 只是兼容旧客户端。
- TODO-018：Relay 控制帧 session scope 强校验已完成，方案归档到
  `docs/archive/completed-working/2026-05-04-relay-control-frame-scope.md`。
