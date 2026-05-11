---
phase: 14
reviewers: [codex]
reviewed_at: 2026-05-11T05:19:39Z
model: gpt-5.5
plans_reviewed: [14-P01-db-migration.md, 14-P02-server-gateway-api.md, 14-P03-cli-auth-simplification.md, 14-P04-protocol-web-frames.md, 14-P05-relay-strict-routing.md, 14-P06-web-gateway-selector.md]
---

# Cross-AI Plan Review — Phase 14: Multi-device Gateway Routing

## Codex Review (gpt-5.5)

## Summary

整体方向是对的：P01→P06 的拆分覆盖了 DB、Server、CLI/Gateway auth、Protocol/Web、Relay 路由、Web 选择器，主链路基本能达成“同账号多 Gateway、Web 手动选、Relay 按 gatewayId 严格路由”的目标。但计划里有几个会直接导致执行失败或语义偏离的硬风险：P01 migration 在当前 `ensureSchema()` 机制下不幂等，P04 把“续聊 client.chat”也强制加 `gatewayId` 与 Phase 15 已交付设计冲突，P05 没有完全移除 Relay 的隐式 Gateway 绑定行为，P06 的 i18n/API helper 写法和现有代码不匹配。建议修正后再执行。

## Strengths

- 阶段顺序总体合理：先 DB，再 Server bind/list，再 CLI auth 形态，再 Protocol/Web，再 Relay 移除 fallback，最后做可见 UI。
- 明确识别了 Phase 15 已 shipped 的关键约束：`client.chat` 续聊分支应继续通过 DB metadata.gatewayId 路由。
- Server 侧“新建用 hostname 作为 name，后续登录不覆盖 name”的别名语义是正确的。
- Relay 侧新增 `gateway_required` / `gateway_unauthorized` 的方向正确，也把 R4 多账号隔离测试列进了计划。
- P03 把 auth.json 简化相关改动集中在同一个计划里，避免 CLI 写新格式但 Gateway 仍读旧字段的半迁移状态。

## Concerns

- **HIGH — P01 migration 不幂等，会被 `ensureSchema()` 重跑打爆。**  
  [db.ts](/Users/dream/code/tether/apps/server/app/service/db.ts:8) 只忽略 `DROP` 缺失和 `ADD INDEX/KEY` 重复，不忽略 `ADD COLUMN` 重复。`008` 第一次执行后，后续任何 `ctx.service.db.query()` 触发 `ensureSchema()` 都可能因为 `ER_DUP_FIELDNAME` 失败。

- **HIGH — P04 不应让 existing-session `client.chat` 强制携带 `gatewayId`。**  
  当前协议里 existing-session 分支没有 `gatewayId`，Phase 15 的 Relay 续聊分支已经通过 Server DB metadata 路由。把 `{ sessionId: string }` 变体改成必填 `gatewayId` 会让类型语义误导实现者，也会破坏“PTY/chat session 永远回到创建它的 Gateway”的目标。

- **HIGH — P05 没有完全消除 Relay 的隐式 Gateway 绑定。**  
  计划移除了 `client.auth` 和 `ensureClientGatewayId()` 的 `firstGatewayForScope()`，但 [broadcastGatewayStatus](/Users/dream/code/tether/apps/relay/src/relay.ts:935) 仍会在 client 没有 `gatewayId` 时把 connected gateway 写进 `client.gatewayId`。这仍然是“先连上的 Gateway 成为默认 Gateway”的 fallback，会影响 `hello/gateway.status`、`client.list`、`client.switch-model` 以及 P04/P06 的默认选择逻辑。

- **HIGH — P06 的 i18n 片段不符合现有 `messages.ts` 结构。**  
  当前是 `WEB_MESSAGES.zh.xxx` / `WEB_MESSAGES.en.xxx` 两套 locale，而计划给的是 `gatewaySelector: { offline: { zh, en } }` 这种嵌套格式。照抄会 typecheck 或使用侧出问题。

- **MEDIUM — P02/P05 的隔离校验只写 accountId，不够贴合“当前用户自己的 Gateway”。**  
  Server list 用当前 user，Gateway token 也有 userId；Relay helper 只校验 `gateway.scope.accountId === clientScope.accountId`。如果同一 account 下未来有多个 user，A 用户可能声明同账号 B 用户的 gatewayId。建议复用现有 `clientCanUseGateway()` 语义，至少 accountId + userId 都匹配。

- **MEDIUM — P02 缺少 `deviceKey` 格式校验。**  
  Threat model 说需要校验来自浏览器 URL 的 deviceKey，但任务只检查非空。至少应要求 `^dev_[A-Za-z0-9_-]{8,128}$` 或项目认可的随机格式，避免脏数据进入唯一键。

- **MEDIUM — P06 没明确“无 selectedGatewayId 时禁用发送”。**  
  计划的 disabled 条件是 `selectedGatewayId && !selectedGatewayOnline`，没有选中 Gateway 时仍可发送，随后只靠 Relay 返回 `gateway_required`。UX 上应直接禁用，并提示先选择 Gateway。

- **MEDIUM — P06 `normalAuthHeaders()` 并不存在。**  
  当前 [api.ts](/Users/dream/code/tether/apps/web/src/lib/api.ts:58) 导出的是 `gatewayAuthHeaders()`，名字虽然别扭但用于 normal access token。计划要明确使用现有 helper，或新增 `normalAuthHeaders()` 并同步调用点。

- **LOW — P02 的 `localPort` 映射用 truthy 判断会丢 `0`。**  
  `row.local_port ? Number(row.local_port) : undefined` 对 `0` 会变 undefined。端口 0 不应入库，但映射层最好用 `row.local_port == null` 判断。

## Suggestions

- P01：要么把 `ER_DUP_FIELDNAME` 加入 `ensureSchema()` 的可忽略 DDL 错误，并限定为 `ALTER TABLE ... ADD COLUMN`；要么把 008 写成真正幂等的 MySQL 过程/条件迁移。否则不要执行。
- P04：只给 `client.chat sessionId:null`、`client.list-providers`、`client.cwd-suggest` 加 `gatewayId`。existing-session `client.chat` 保持不带，或最多设为可选且 Relay 完全忽略。
- P05：同时审查并调整 `broadcastGatewayStatus()` 对 `client.gatewayId` 的写入逻辑。Gateway status 可以广播给同用户 client，但不能把“收到 status”变成隐式选择。
- P05：`forwardFrameToGateway()` 应用 `clientCanUseGateway(clientScope, gateway.scope)`，不存在 gateway 时返回 `gateway_unavailable`，缺少 frame.gatewayId 才返回 `gateway_required`。
- P05 测试：除了三条新增测试，还要加一条“B Gateway 先连，A client auth 后不自动绑定 B/A 任意 Gateway，发送无 gatewayId 的 list-providers/cwd-suggest 返回 gateway_required”。
- P06：GatewaySelector 加载列表后，如果没有 selectedGatewayId，选择第一个在线 Gateway；没有在线 Gateway 时禁用输入。
- P06：按现有 i18n 结构分别给 `zh` 和 `en` 增加 flat keys，例如 `gatewaySelectorOffline`、`gatewaySelectorSelect`、`gatewaySelectorEmpty`。
- P03：JWT decode 后校验 `tokenClass === 'gateway_access'`、`gatewayId/accountId/userId` 均存在；错误信息明确提示重新执行 `tether gateway login`。

## Risk Assessment

**整体风险：HIGH。** 不是因为目标不可行，而是因为当前计划有三个会影响主链路的硬问题：migration 幂等性会让 Server 启动/查询失败；Protocol 变更会误伤 Phase 15 的续聊语义；Relay 仍存在隐式 gateway 绑定路径，可能让“严格按 gatewayId、无 fallback”的安全目标落空。修正这些点后，风险可降到 **MEDIUM**，主要剩余风险会集中在多端 Web 选择状态和真实 Gateway 登录 E2E 验证。

---

## Consensus Summary

Single reviewer (Codex) — no cross-reviewer consensus needed.

### Key Concerns (Ordered by Priority)

1. **[HIGH] P01 migration idempotency** — `ensureSchema()` will re-run and crash with `ER_DUP_FIELDNAME` on subsequent server starts
2. **[HIGH] P04 existing-session `client.chat` should NOT get `gatewayId`** — conflicts with Phase 15 routing via DB metadata
3. **[HIGH] P05 incomplete fallback removal** — `broadcastGatewayStatus()` still implicitly binds client.gatewayId
4. **[HIGH] P06 i18n format wrong** — plan uses nested format, codebase uses flat keys
5. **[MEDIUM] Isolation check missing userId** — accountId-only check insufficient for multi-user accounts
6. **[MEDIUM] P06 disabled condition** — no selectedGatewayId should also disable send, not just offline gateway
7. **[MEDIUM] normalAuthHeaders() missing** — use existing web API helper
