# Phase 14: Multi-device Gateway Routing - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

允许同一账号在多台设备上各自绑定一个稳定 Gateway 记录；Web 显示 Gateway 列表并手动选择；Relay 按 `gatewayId` 严格路由，禁止任何 fallback；PTY session 永远回到创建它的那台机器的 Gateway。

**本 Phase 交付：**
- `gateways` 表支持多设备（schema migration）
- `tether gateway login` 携带 `device_key/hostname/port`，Server upsert by device
- `GET /api/server/gateways` 返回当前用户自己的 Gateway 列表
- Web `/chats` 顶部 Gateway 选择器（显示名称/别名、在线状态、多台时可切换）
- Relay 移除 `firstGatewayForScope()` fallback，无 `gatewayId` 返回 `gateway_required`
- `client.chat / list-providers / cwd-suggest` 均需在 frame 里带 `gatewayId`

**不在本 Phase：**
- 本机自动探测（`127.0.0.1/identity`）——用户远程使用，此功能无意义，permanently deferred
- Gateway 撤销 UI（revoke 用 status='revoked'，管理界面已在 Phase 6）
- workspace 切换（Phase 10）

</domain>

<decisions>
## Implementation Decisions

### gateways 表 Schema

- **D-01:** 新增 `device_key VARCHAR` 列，用于标识本机设备。格式：`dev_xxx`（nanoid/uuid），Gateway 本机生成。
- **D-02:** 删除旧 `UNIQUE KEY uq_gateways_account_user (account_id, user_id)`，新增 `UNIQUE KEY uq_gateways_device_key (account_id, user_id, device_key)`。注意：`workspace_id` 已从 Gateway 链路移除，unique key 不含 `workspace_id`。已有行 `device_key` 为 NULL，读取不受影响。
- **D-03:** 新增 `hostname VARCHAR` 和 `local_port INT` 字段，Gateway 登录时 upsert 更新，用于 Web 展示（不用于本机探测）。
- **D-03b:** `gateways.workspace_id` 当前是 `NOT NULL` 加 FK 约束，但 workspace_id 正从 Gateway 链路移除。Migration 需明确处理：先删 FK 约束 `fk_gateways_workspace`，再将 `workspace_id` 改为 `NULLABLE`（保留列供历史读取）。不直接 DROP 列，避免破坏已有数据。
- **D-04:** 撤销用 `status = 'revoked'` 表示，不新增 `revoked_at` 列。路由和选择器校验 `status != 'revoked'`。
- **D-05:** `gateways.name` 字段作为用户可编辑别名。登录时默认填 `hostname`，用户可后续修改。前端展示优先级：有别名用别名，无别名用 `hostname`。

### Gateway 登录流程

- **D-06:** `device_key` 存储在 `~/.tether/device.json`（`{ deviceKey, deviceName }`），与主数据库分离，重装 Gateway 不会换 key。
- **D-07:** `tether gateway login` 打开浏览器时 URL 带参数：`/gateway-auth?deviceKey=dev_xxx&hostname=xxx&port=55424`。Server `/gateway-auth` 页面读取这些参数，用户登录完成后做 upsert。
- **D-08:** Server upsert 逻辑：按 `(account_id, user_id, device_key)` 查找；存在则更新 `hostname/local_port/status/last_seen_at`（**不更新 `name`**，避免覆盖用户自定义别名），不存在则新建（新建时 `name` 默认填 `hostname`）。返回稳定的 `gatewayId`（`gateways.id`）和新签发的 gateway access token。
- **D-09:** `~/.tether/auth.json` 只保留 `serverUrl / accessToken / refreshToken / expiresAt`。`gatewayId / accountId / userId` 等从 `accessToken` JWT decode 获取，不再单独存储。**关联影响（必须全部修改，否则 Gateway 无法连接 Relay）**：
  - `apps/gateway/src/relay-client.ts:1059-1081` — auth.json 解析函数直接检查 `typeof parsed.gatewayId !== 'string'`，**这是最关键的改动点**，简化后必须改为 decode accessToken 获取 gatewayId
  - `apps/gateway/src/daemon.ts:188, 687, 1083` — `authState.value.gatewayId` / `authState.value.accountId` 调用点，改为从 token payload 读取
  - 建议封装 `getGatewayIdentity(authState)` 辅助函数统一处理 decode 逻辑

### Relay 路由收紧

- **D-10:** `client.chat / list-providers / cwd-suggest` 等所有需要 Gateway 响应的帧必须在 frame 里带 `gatewayId` 字段。Relay 直接读取做路由，WS 连接本身不绑定 Gateway，切换 Gateway 不需重新握手。**Protocol 类型必须同步更新**（`packages/protocol/src/index.ts`）：
  - `client.chat sessionId: null`（line 100）加 `gatewayId: string`
  - `client.list-providers`（line 103）加 `gatewayId: string`
  - `client.cwd-suggest`（line 102）加 `gatewayId: string`
- **D-11:** 没有 `gatewayId` 的请求一律返回错误帧 `{ type: 'error', code: 'gateway_required' }`，禁止任何 fallback。前端收到后展示 Gateway 选择器。
- **D-12:** Relay 收到 frame 里的 `gatewayId` 后，校验 `gateway.scope.accountId == client.scope.accountId`。不属于则返回 `{ type: 'error', code: 'gateway_unauthorized' }`，防止跨账户路由。
- **D-13:** 移除 `relay.ts` 中以下 fallback 逻辑：
  - `line 501`：`clientScope.gatewayId ?? firstGatewayForScope(clientScope)?.gatewayId`
  - `line 746-748`：`ensureClientGatewayId` 里的 `firstGatewayForScope` fallback

### Web Gateway 选择器

- **D-14:** 新增 `GET /api/server/gateways`，按 `accountId + userId` 过滤，只返回当前用户自己的 Gateway。返回字段：`gatewayId / deviceKey / hostname / name / status / lastSeenAt`。
- **D-15:** Gateway 选择器放在 `/chats` 页面顶部 header，显示当前选中 Gateway 的名称（优先别名）和在线状态。多台在线时点击可切换。
- **D-16:** 当前会话所属 Gateway 离线时：展示历史消息，输入框禁用并显示"Gateway 已离线"提示。
- **D-17:** 本机自动探测（`127.0.0.1/identity`）**不做**。用户场景是远程使用，此功能无意义。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 设计文档
- `docs/working/2026-05-11-multi-device-gateway-routing.md` — 完整多设备路由方案，包含数据模型、登录流程、Relay 规则、安全边界、分阶段落地计划

### 多租户隔离规范
- `CLAUDE.md` §6 — Relay 多租户隔离强制规则（R1-R4），本 Phase 的所有 Relay 改动必须满足这些规则，且新增的路由路径必须附带隔离测试

### 数据库 Schema
- `apps/server/sql/001_init.sql` — `gateways` 表当前定义，migration 在此基础上改

### 现有 Gateway 认证实现
- `apps/gateway/src/daemon.ts` — `GatewayAuthState` 类型（line 46），`loadGatewayAuthState`（line 1114），`authState.value.gatewayId` 调用点（line 188, 687, 1083）
- `apps/gateway/src/relay-client.ts` — auth.json 读取（line 1059），`gateway.auth` 帧发送（line 171）
- `apps/server/app/controller/gateway-auth.ts` — 现有 gateway-auth 控制器（需扩展 deviceKey/hostname/port 参数）
- `apps/server/app/controller/gateway.ts` — `bindGateway` 和 `refreshGatewayToken` 实现

### Relay 路由现有实现
- `apps/relay/src/relay.ts` — `firstGatewayForScope` fallback 位置（line 501, 746-748），需要移除

### Web 聊天界面
- `apps/web/src/components/chats/chat-panel.tsx` — Phase 13 聊天界面，Gateway 选择器接入点

</canonical_refs>

<code_context>
## Existing Code Insights

### 可复用资产
- `apps/server/app/controller/gateway-auth.ts`：现有 Gateway 绑定控制器，扩展接受 `deviceKey/hostname/port` URL 参数即可，不需重写
- `apps/server/app/controller/gateway.ts`：`bindGateway` service 调用，upsert 逻辑在 service 层实现
- `apps/relay/src/relay.ts`：`firstGatewayForScope()` 函数本身保留（用于全局检查如 `hasConnectedGateway`），只移除它在路由 fallback 中的使用

### 现有模式
- `gateways.status` 字段已有 `'offline' | 'online'`，新增 `'revoked'` 值遵循同一模式
- `gateway.auth` 帧已携带 `gatewayId + token + scope`，token payload 里已有 `accountId/userId/gatewayId`
- Relay 现有 `broadcastGatewayStatus` 按 scope 过滤，符合隔离规则，可参考实现 Gateway 列表推送

### 集成点
- `apps/relay/src/relay.ts` line 501, 746-748：移除 fallback
- `apps/gateway/src/daemon.ts` line 46：`GatewayAuthState` 类型简化
- `apps/web/src/components/chats/chat-panel.tsx`：顶部加入 Gateway 选择器组件
- 新增 migration 文件（`apps/server/sql/004_multi_device_gateway.sql` 或类似）

</code_context>

<specifics>
## Specific Ideas

- `device_key` 格式参考设计文档：`dev_xxx`（nanoid 前缀 + 随机串）
- Gateway 名称别名：登录时默认 `hostname`（如 `dreamdeMacBook-Pro.local`），用户可在 Web 里改成"公司 Mac"/"家里 mini"
- `gateway_required` 和 `gateway_unauthorized` 作为新的 Relay 错误 code，需加入 protocol 类型定义
- auth.json 简化后，`loadGatewayAuthState` 需要在加载时 decode JWT 拿 `gatewayId/accountId/userId`，建议封装成 `getGatewayIdentity(authState)` 辅助函数

</specifics>

<deferred>
## Deferred Ideas

- **本机自动探测**（`127.0.0.1/identity`）：用户场景为远程使用，此功能对远程场景无意义，permanently deferred
- **Gateway 撤销 UI**：`status='revoked'` 的写入入口已在 Phase 6 管理后台，本 Phase 只需在路由和选择器里读取这个状态
- **多标签页 Gateway 选择同步**（BroadcastChannel）：设计文档提到但属于体验优化，可后续加

</deferred>

---

*Phase: 14-multi-device-gateway-routing*
*Context gathered: 2026-05-11*
