# 编码原则

这些原则用于减少 AI 编码时常见的误判和过度修改。执行具体任务时，应与项目
已有规则一起遵守。

**取舍：** 这些原则更偏向谨慎而不是速度。对于非常简单的任务，可以根据实际
情况判断。

## 1. 编码前先思考

**不要假设，不要隐藏困惑，要明确说出取舍。**

实现前：

- 明确说明自己的假设。不确定时，先问。
- 如果存在多种理解，列出来，不要默默选择其中一种。
- 如果有更简单的方案，说明它。必要时提出反对意见。
- 如果需求不清楚，停下来，指出哪里不清楚，并提问。

## 2. 简单优先

**用能解决问题的最小代码。不要写猜测性的扩展。**

- 不做需求之外的功能。
- 不为单次使用的代码新增抽象。
- 不添加未被要求的"灵活性"或"可配置性"。
- 不为不可能发生的场景写错误处理。
- 如果写了 200 行但 50 行就能解决，重写成更简单的版本。

自检问题：资深工程师会不会认为这过度复杂？如果会，就简化。

## 3. 外科手术式修改

**只改必须修改的地方。只清理自己造成的问题。**

编辑已有代码时：

- 不顺手"优化"相邻代码、注释或格式。
- 不重构没有坏掉的东西。
- 匹配现有风格，即使你个人会用另一种写法。
- 如果发现无关的废弃代码，可以提出来，但不要直接删除。

当你的修改造成孤立代码时：

- 删除由你的修改导致未使用的 import、变量、函数。
- 不删除原本就存在的废弃代码，除非用户明确要求。

判断标准：每一行改动都应该能直接追溯到用户的请求。

## 4. 目标驱动执行

**定义成功标准，验证后再结束。**

把任务转成可验证目标：

- "添加校验" -> "为非法输入写测试，然后让测试通过"
- "修复 bug" -> "写一个复现 bug 的测试，然后让测试通过"
- "重构 X" -> "确保重构前后测试都通过"

多步骤任务需要给出简短计划：

```text
1. [步骤] -> 验证：[检查项]
2. [步骤] -> 验证：[检查项]
3. [步骤] -> 验证：[检查项]
```

强成功标准可以让 AI 独立循环推进。弱标准，例如"让它能用"，通常需要持续澄清。

## 5. API 路由命名规范

所有 HTTP 接口按业务域分前缀，禁止直接在 `/api/` 下挂路由：

| 前缀 | 用途 | 示例 |
|------|------|------|
| `/api/server/` | 服务端数据读取（Session、Event、Conversation） | `/api/server/sessions` |
| `/api/admin/` | 管理后台接口 | `/api/admin/users` |
| `/api/relay/` | Relay 相关接口 | `/api/relay/gateway/bind` |
| `/ws/client` | 客户端 WebSocket（web/flutter → relay） | — |
| `/ws/gateway` | Gateway WebSocket（gateway → relay） | — |

所有接口均已按此规范迁移，新增接口必须遵守此规范。

## 6. Relay 多租户隔离规范

Relay 服务器是多租户共享服务，同一进程内可能同时连接多个不同账号的 Gateway
和 Client。**任何跨用户的数据读取或路由都是安全漏洞**，必须严格防止。

### 禁止行为

| 禁止 | 原因 |
|------|------|
| 在 Gateway 路由 fallback 中使用 `firstConnectedGateway()` | 会把 A 账号的请求发给 B 账号的 Gateway |
| Session 广播不过滤账号 | 会把 B 的 session 列表暴露给 A |
| `gateway_unavailable` 广播所有 Client | 会把 B 的 Gateway 断线事件通知给 A |
| 存储 session 时不注入来源 `gatewayId` | 导致后续路由使用无账号限制的 fallback |

### 强制规则

**R1 — 按账号查找 Gateway**

所有"给 Client 找对应 Gateway"的逻辑，必须使用 `firstGatewayForAccount(accountId)`
而不是 `firstConnectedGateway()`。后者只在不涉及账号隔离的全局检查中使用（如
`hasConnectedGateway()`）。

**R2 — Session 存储必须携带来源 gatewayId**

在 `gateway.sessions` 帧处理时，写入 `latestSessions` 前必须确保每个 session
带有 `gatewayId`，从帧中补填：

```typescript
latestSessions.set(session.id, { ...session, gatewayId: session.gatewayId ?? frame.gatewayId });
```

这样路由时不需要任何账号无关的 fallback。

**R3 — 广播必须过滤账号**

`broadcastSessionList()` 已经通过 `clientCanSeeRelaySession` 过滤，但所有其他
广播（如 `gateway_unavailable`）必须只通知 `client.scope.accountId` 匹配的
Client，不得遍历所有 Client 广播。

**R4 — 新增路由路径必须附带隔离测试**

每次新增以下任何一类逻辑，必须同时在 `relay.test.ts` 中新增多账号隔离测试：

- 新的 Client → Gateway 转发路径
- 新的 Gateway → Client 推送路径  
- 新的 broadcast / notify all 逻辑

测试模板：两个账号的 Gateway 都连接，**B 账号的 Gateway 先连**，验证 A 账号
的操作不泄漏到 B 的 Gateway（反之亦然）。

### 根因回溯（2025-05-10）

`firstConnectedGateway()` 在以下四处被错误用于有账号上下文的路由：

1. Client 认证时分配 Gateway（已修复）
2. `ensureClientGatewayId` fallback（已修复）
3. `gatewayForSession` fallback（已修复：先用 accountId 查，无 gatewayId 的 session 返回 undefined）
4. `forwardToSessionGateway` fallback（已修复：移除 fallback，依赖 R2 保证 gatewayId 始终存在）
5. `broadcastGatewayUnavailable` 全量广播（已修复：改为按账号过滤）

## 生效标准

这些原则生效时，diff 中不必要的改动会减少，因过度复杂导致的重写会减少，
澄清问题会发生在实现前，而不是犯错后。
