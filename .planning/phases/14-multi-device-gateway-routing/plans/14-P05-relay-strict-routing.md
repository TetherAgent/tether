---
phase: 14-multi-device-gateway-routing
plan: 05
type: execute
wave: 4
depends_on: [14-P04]
files_modified:
  - apps/relay/src/relay.ts
  - apps/relay/test/relay.test.ts
autonomous: true
requirements: [GATEWAY-MULTI-05]
must_haves:
  truths:
    - "client.chat（新建分支）/list-providers/cwd-suggest 帧必须携带 frame.gatewayId，否则返回 gateway_required 错误"
    - "Relay 校验 frame.gatewayId 对应 gateway.scope.accountId == client.scope.accountId，否则返回 gateway_unauthorized"
    - "line 599 fallback 移除：client.auth 后 gatewayId 不再从 firstGatewayForScope 获取"
    - "lines 879-891 fallback 移除：ensureClientGatewayId 不再调用 firstGatewayForScope"
    - "client.chat 续聊分支（Phase 15 P03 实现，lines 764-807）不得修改"
    - "line 288 的 firstGatewayForScope 使用保留（全局检查，无账号路由语义）"
    - "新增路由路径有多账号隔离测试（CLAUDE.md R4）"
  artifacts:
    - path: "apps/relay/src/relay.ts"
      provides: "移除 fallback + gateway_required/gateway_unauthorized 返回 + 跨账号校验"
    - path: "apps/relay/test/relay.test.ts"
      provides: "多账号隔离测试：A 的 client.chat 不路由到 B 的 Gateway"
  key_links:
    - from: "relay.ts client.chat case"
      to: "frame.gatewayId -> gateways.get(frame.gatewayId)"
      via: "直接从帧读取，不经过 ensureClientGatewayId"
    - from: "relay.ts gateway_unauthorized 检查"
      to: "gateway.scope.accountId === clientScope.accountId"
      via: "D-12 跨账号隔离"
---

<objective>
移除 Relay 中两处 fallback，将 client.chat/list-providers/cwd-suggest 的路由从"按连接绑定的 gatewayId"改为"从帧中读取 gatewayId"，并加入缺失 gatewayId 和跨账号的错误返回。新路由路径必须附带隔离测试（CLAUDE.md R4）。

**此 Plan 必须在 Plan 04 之后执行**：Plan 04 使 Web 帧携带 gatewayId，移除 fallback 才不会破坏现有客户端。

Purpose: 实现 D-11（gateway_required）、D-12（gateway_unauthorized）、D-13（移除 fallback）。
Output: 收紧后的 relay.ts + 隔离测试
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
@/Users/dream/code/tether/CLAUDE.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md

<interfaces>
<!-- relay.ts line 599 — 待移除的 fallback（Phase 15 完成后行号已偏移，原文档 line 501）-->
const gatewayId = clientScope.gatewayId ?? firstGatewayForScope(clientScope)?.gatewayId;
clients.set(clientId, { clientId, scope: auth.scope, gatewayId, authMethod: auth.authMethod, socket, subscriptions });
-- 改为:
const gatewayId = clientScope.gatewayId;  // 不再 fallback

<!-- relay.ts lines 879-891 — ensureClientGatewayId 含 fallback（原文档 lines 746-748）-->
function ensureClientGatewayId(clientId: string): string | undefined {
  const client = clients.get(clientId);
  if (!client) return undefined;
  if (client.gatewayId) return client.gatewayId;
  const gatewayId = client.scope?.gatewayId ??
    firstGatewayForScope(client.scope)?.gatewayId;  // 待移除
  client.gatewayId = gatewayId;
  return gatewayId;
}

<!-- relay.ts lines 751-808 — case 'client.chat' 当前完整结构（Phase 15 P03 已实现续聊分支）-->
case 'client.chat':
  if (frame.sessionId === null) {
    // lines 752-763：新建分支 — 仍用 ensureClientGatewayId，Phase 14 要改这里
    forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.chat', clientId, sessionId: null, ... });
  } else {
    // lines 764-807：续聊分支 — Phase 15 P03 实现，用 fetchSessionMetadata + metadata.gatewayId 路由
    // ⚠️ 不得修改此分支：已含 session_not_found/forbidden/wrong_transport 校验
    const metadata = await fetchSessionMetadata(frame.sessionId);
    ...
  }
  break;

<!-- relay.ts lines 809-813 — list-providers/cwd-suggest 仍用 ensureClientGatewayId -->
case 'client.list-providers':
  forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.list-providers', clientId });
  break;
case 'client.cwd-suggest':
  forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.cwd-suggest', clientId, cwd: frame.cwd });
  break;

<!-- relay.ts line 288 — 保留的合法使用（原文档 line 246）-->
if (disconnectedScope && !firstGatewayForScope(disconnectedScope))  // 全局检查，不涉及账号路由，保留

<!-- gateway_unauthorized 需要的账号隔离校验 (D-12) -->
gateway.scope.accountId === clientScope.accountId
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: relay.ts — 移除两处 fallback + 新增 gateway_required/gateway_unauthorized 路由</name>
  <files>apps/relay/src/relay.ts</files>
  <action>
    先读取 relay.ts 完整内容确认当前行号，然后执行以下四处修改。

    **修改 1 — line 599：移除 firstGatewayForScope fallback（client.auth 后设置 gatewayId）**

    找到：
    ```typescript
    const gatewayId = clientScope.gatewayId ?? firstGatewayForScope(clientScope)?.gatewayId;
    ```
    改为：
    ```typescript
    const gatewayId = clientScope.gatewayId;
    ```

    **修改 2 — lines 879-891：移除 ensureClientGatewayId 中的 firstGatewayForScope fallback**

    找到并替换 ensureClientGatewayId 整个函数体：
    ```typescript
    function ensureClientGatewayId(clientId: string): string | undefined {
      const client = clients.get(clientId);
      if (!client) return undefined;
      return client.gatewayId ?? client.scope?.gatewayId;
    }
    ```
    注意：函数保留供 client.switch-model 等其他调用方使用，只是移除 fallback。

    **修改 3 — 新增 forwardFrameToGateway helper（紧靠 ensureClientGatewayId 之后）：**

    ```typescript
    function forwardFrameToGateway(
      clientId: string,
      clientScope: RelayAuthScope,
      frameGatewayId: string | undefined,
      gatewayFrame: RelayServerToGatewayFrame
    ): void {
      if (!frameGatewayId) {
        sendToClient(clientId, { type: 'error', code: 'gateway_required', message: 'gatewayId is required in frame' });
        return;
      }
      const gateway = gateways.get(frameGatewayId);
      if (gateway && gateway.scope.accountId !== clientScope.accountId) {
        sendToClient(clientId, { type: 'error', code: 'gateway_unauthorized', message: 'gateway does not belong to client account' });
        return;
      }
      forwardToGateway(frameGatewayId, gatewayFrame);
    }
    ```

    **修改 4 — case 'client.chat'：只改新建分支（lines 752-763），续聊分支完全不动**

    ⚠️ relay.ts 中 case 'client.chat' 的结构是：
    ```
    if (frame.sessionId === null) { ... }  ← 只改这里
    else { ... fetchSessionMetadata ... }  ← Phase 15 P03 实现，一行都不改
    ```

    将 `if (frame.sessionId === null)` 分支的内容从：
    ```typescript
    forwardToGateway(ensureClientGatewayId(clientId), {
      type: 'client.chat',
      clientId,
      sessionId: null,
      provider: frame.provider,
      model: frame.model,
      cwd: frame.cwd,
      message: frame.message,
      accountId: clientScope.accountId,
      userId: clientScope.userId
    });
    ```
    改为：
    ```typescript
    forwardFrameToGateway(clientId, clientScope, frame.gatewayId, {
      type: 'client.chat',
      clientId,
      sessionId: null,
      provider: frame.provider,
      model: frame.model,
      cwd: frame.cwd,
      message: frame.message,
      accountId: clientScope.accountId,
      userId: clientScope.userId
    });
    ```

    **修改 5 — case 'client.list-providers' 和 'client.cwd-suggest'（lines 809-813）：**

    ```typescript
    case 'client.list-providers':
      forwardFrameToGateway(clientId, clientScope, frame.gatewayId, { type: 'client.list-providers', clientId });
      break;
    case 'client.cwd-suggest':
      forwardFrameToGateway(clientId, clientScope, frame.gatewayId, { type: 'client.cwd-suggest', clientId, cwd: frame.cwd });
      break;
    ```

    **line 288 保留不变**：`if (disconnectedScope && !firstGatewayForScope(disconnectedScope))` 是全局检查（不涉及账号路由），合法使用。

    **TypeScript**：Protocol 帧类型经 Plan 04 更新后已含 `gatewayId: string`，可直接 `frame.gatewayId` 访问。如 TS 联合类型推断失败，用 `(frame as { gatewayId?: string }).gatewayId`。
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/relay typecheck
    ```
  </verify>
  <done>
    - line 599 不再使用 firstGatewayForScope（原 line 501）
    - ensureClientGatewayId（lines 879-891）不再使用 firstGatewayForScope
    - client.chat 新建分支 / list-providers / cwd-suggest 从 frame.gatewayId 路由
    - client.chat 续聊分支（Phase 15 P03）完全未动
    - 缺少 gatewayId 返回 gateway_required
    - 跨账号返回 gateway_unauthorized
    - line 288 的 firstGatewayForScope 使用保留
    - typecheck 通过
  </done>
</task>

<task type="auto">
  <name>Task 2: relay.test.ts — 多账号隔离测试（CLAUDE.md R4）</name>
  <files>apps/relay/test/relay.test.ts</files>
  <action>
    在现有测试文件末尾（或合适的 describe 块内），添加以下隔离测试。测试模板按 CLAUDE.md R4 规定：**B 账号的 Gateway 先连接**，验证 A 账号的操作不泄漏到 B 的 Gateway。

    **测试 1：client.chat 带 A 的 gatewayId，不路由到 B 的 Gateway（gateway_required 场景）**
    ```typescript
    describe('Phase 14 multi-account isolation', () => {
      it('client.chat with missing gatewayId returns gateway_required', async () => {
        // 建立 B 账号 Gateway 连接（先连）
        // 建立 A 账号 client 连接
        // A 发送 client.chat 不含 gatewayId
        // 验证 A 的 client 收到 { type: 'error', code: 'gateway_required' }
        // 验证 B 的 Gateway 没有收到任何帧
      });

      it('client.chat with B gatewayId from A client returns gateway_unauthorized', async () => {
        // 建立 B 账号 Gateway 连接（先连），记录 B_gatewayId
        // 建立 A 账号 client 连接
        // A 发送 client.chat 带 gatewayId = B_gatewayId（跨账号）
        // 验证 A 的 client 收到 { type: 'error', code: 'gateway_unauthorized' }
        // 验证 B 的 Gateway 没有收到 client.chat 帧
      });

      it('client.list-providers with A gatewayId routes only to A gateway, not B', async () => {
        // 建立 B 账号 Gateway 连接（先连）
        // 建立 A 账号 Gateway 连接，记录 A_gatewayId
        // 建立 A 账号 client 连接
        // A 发送 client.list-providers 带 gatewayId = A_gatewayId
        // 验证 A 的 Gateway 收到 { type: 'client.list-providers' }
        // 验证 B 的 Gateway 没有收到任何帧
      });
    });
    ```

    实现测试时参考现有 relay.test.ts 的连接建立模式（createGatewayWs / createClientWs 等 helper，或直接用 WebSocket 客户端）。

    每个测试：
    - 用不同 accountId 的 token/scope 建立 Gateway 和 client 连接
    - B 账号 Gateway 先连（如 CLAUDE.md R4 模板要求）
    - 验证帧不跨账号泄漏

    如果现有 relay.test.ts 有 helper 函数用于建立认证连接，直接复用；不要重写连接层。
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/relay test
    ```
    新增测试应全部通过。
  </verify>
  <done>
    - 3 个隔离测试存在（missing gatewayId, 跨账号 gatewayId, 正确 gatewayId 只路由到正确 Gateway）
    - 所有测试通过
    - 现有测试不退步
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client WS → Relay frame.gatewayId | 客户端声明 gatewayId，Relay 必须验证它属于同一账号 |
| Relay routing logic | 路由完全依赖 gatewayId，不再有 fallback；必须防止跨账号路由 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-P05-01 | Elevation of Privilege | client 声明 B 账号的 gatewayId | mitigate | D-12: 校验 gateway.scope.accountId === clientScope.accountId，不匹配返回 gateway_unauthorized |
| T-14-P05-02 | Spoofing | client 发送无 gatewayId 的帧 | mitigate | D-11: 缺少 gatewayId 直接返回 gateway_required，不 fallback 到任何 Gateway |
| T-14-P05-03 | Information Disclosure | Relay 将 A 的请求路由到 B 的 Gateway | mitigate | forwardFrameToGateway 在路由前校验账号；隔离测试覆盖此场景（R4） |
| T-14-P05-04 | Denial of Service | 大量缺 gatewayId 的帧导致 error 广播 | accept | gateway_required 只发给发送方 client，不广播；无放大效应 |
</threat_model>

<verification>
```bash
pnpm --filter @tether/relay typecheck
pnpm --filter @tether/relay test
```
</verification>

<success_criteria>
- 缺少 gatewayId 的 client.chat/list-providers/cwd-suggest 返回 gateway_required（不 fallback）
- 跨账号 gatewayId 返回 gateway_unauthorized
- line 599 和 lines 879-891 的 firstGatewayForScope 调用已移除
- line 288 的 firstGatewayForScope 使用保留
- client.chat 续聊分支（Phase 15 实现）完全未改动
- 3 个隔离测试全部通过
- typecheck 和 test 全通过
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-05-SUMMARY.md`，记录：
- 两处 fallback 移除的实际行号
- forwardFrameToGateway helper 的位置
- 新增的 3 个隔离测试的描述
</output>
