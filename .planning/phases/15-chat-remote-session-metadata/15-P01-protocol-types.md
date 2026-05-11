---
phase: "15"
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/protocol/src/index.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "TrustedChatSessionMetadata 类型在 protocol 包中导出"
    - "RelayServerToGatewayFrame 的 client.chat 已有 session 变体包含 session: TrustedChatSessionMetadata 字段（必填）"
    - "RelayGatewayToServerFrame 包含 gateway.chat-session-created 新变体"
    - "RelayClientToServerFrame 的 client.chat 不包含 provider/projectPath/agentSessionId/accountId/userId/gatewayId 字段（已有 session 续聊变体）"
  artifacts:
    - path: packages/protocol/src/index.ts
      provides: "TrustedChatSessionMetadata, 扩展后的 RelayServerToGatewayFrame, gateway.chat-session-created 帧"
      exports:
        - TrustedChatSessionMetadata
        - RelayGatewayToServerFrame (含 gateway.chat-session-created)
        - RelayServerToGatewayFrame (client.chat 已有 session 变体含 session 字段)
  key_links:
    - from: packages/protocol/src/index.ts
      to: apps/relay/src/relay.ts
      via: "import TrustedChatSessionMetadata"
      pattern: "TrustedChatSessionMetadata"
    - from: packages/protocol/src/index.ts
      to: apps/gateway/src/relay-client.ts
      via: "import TrustedChatSessionMetadata"
      pattern: "TrustedChatSessionMetadata"
---

<objective>
扩展 packages/protocol/src/index.ts 中的帧类型，为 Phase 15 的全部实现提供类型合约。

Purpose: protocol 包是所有包共用的唯一类型来源。先定义类型，后续 Wave 2/3 的 Relay、Gateway、Server 实现都以这些类型为准，避免各自定义导致漂移。
Output: 三个新增/扩展的类型导出：TrustedChatSessionMetadata、gateway.chat-session-created 帧变体、以及携带 session 字段的 RelayServerToGatewayFrame client.chat 变体。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md

<interfaces>
<!-- 当前 packages/protocol/src/index.ts 关键类型（执行前必须以文件实际内容为准） -->

<!-- RelayGatewayToServerFrame 末尾变体（当前） -->
```typescript
| { type: 'gateway.session-created'; gatewayId: string; clientId: string; sessionId: string }
| { type: 'gateway.chat-catchup'; gatewayId: string; clientId: string; sessionId: string; text: string }
| { type: 'gateway.error'; gatewayId: string; clientId?: string; sessionId?: string; code: string; message: string };
```

<!-- RelayServerToGatewayFrame 中 client.chat 变体（当前） -->
```typescript
| {
    type: 'client.chat';
    clientId: string;
    sessionId: null;
    provider: string;
    model: string;
    cwd: string;
    message: string;
    accountId?: string;
    userId?: string;
  }
| { type: 'client.chat'; clientId: string; sessionId: string; message: string; model?: string }
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 新增 TrustedChatSessionMetadata 类型 + 扩展帧类型</name>
  <read_first>
    packages/protocol/src/index.ts
  </read_first>
  <files>packages/protocol/src/index.ts</files>
  <behavior>
    - TrustedChatSessionMetadata 类型包含所有字段：id、provider、projectPath、agentSessionId?、accountId、userId、gatewayId、transport: 'chat'（字面量类型）
    - RelayServerToGatewayFrame 的已有 session 续聊变体（sessionId: string）新增 session: TrustedChatSessionMetadata 字段（必填，非可选）
    - RelayGatewayToServerFrame 新增 gateway.chat-session-created 变体，字段：type、gatewayId、clientId、session: TrustedChatSessionMetadata
    - RelayClientToServerFrame 的两个 client.chat 变体保持不变（不添加任何 metadata 字段）
  </behavior>
  <action>
修改 `packages/protocol/src/index.ts`：

**步骤 1 — 在文件顶部（RelaySessionStatus 之前）插入新类型：**

```typescript
export type TrustedChatSessionMetadata = {
  id: string;
  provider: string;
  projectPath: string;
  agentSessionId?: string;
  accountId: string;
  userId: string;
  gatewayId: string;
  transport: 'chat';
};
```

**步骤 2 — 修改 RelayGatewayToServerFrame，在 gateway.error 变体之前插入：**

```typescript
| { type: 'gateway.chat-session-created'; gatewayId: string; clientId: string; session: TrustedChatSessionMetadata }
```

最终 RelayGatewayToServerFrame 的 gateway.error 前有 gateway.chat-session-created。

**步骤 3 — 修改 RelayServerToGatewayFrame 的已有 session client.chat 变体：**

将：
```typescript
| { type: 'client.chat'; clientId: string; sessionId: string; message: string; model?: string }
```

改为：
```typescript
| { type: 'client.chat'; clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }
```

注意：sessionId: null（新建 chat）变体保持不变（不加 session 字段）。

**禁止修改：**
- RelayClientToServerFrame（Web → Relay 帧，D-02 要求不携带 metadata）
- RelaySession 类型
- 任何现有字段的类型
  </action>
  <verify>
    <automated>pnpm --filter @tether/protocol exec tsc -p tsconfig.json --noEmit 2>&1 | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "TrustedChatSessionMetadata" packages/protocol/src/index.ts` 输出 >= 3（类型定义 + RelayServerToGatewayFrame 引用 + RelayGatewayToServerFrame 引用）
    - `grep -n "gateway.chat-session-created" packages/protocol/src/index.ts` 输出 1 行且在 RelayGatewayToServerFrame 内
    - `grep -n "session: TrustedChatSessionMetadata" packages/protocol/src/index.ts` 在 client.chat sessionId:string 变体中
    - `grep -n "sessionId: string.*message" packages/protocol/src/index.ts` 对应的 session 字段为必填（无 ?）
    - `pnpm --filter @tether/protocol exec tsc -p tsconfig.json --noEmit` 无错误输出
    - RelayClientToServerFrame 中的两个 client.chat 变体不包含 provider/projectPath/agentSessionId/accountId/userId/gatewayId 字段（grep 验证：`grep -A5 "client.chat.*sessionId: string" packages/protocol/src/index.ts` 应只见 message/model/session 字段）
  </acceptance_criteria>
  <done>protocol 包 typecheck 通过，TrustedChatSessionMetadata 已导出，三处帧类型正确扩展</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| RelayClientToServerFrame | Web 客户端只能发 sessionId + message + model?，不能携带可执行 metadata |
| RelayServerToGatewayFrame | Relay → Gateway 的 session 字段由 Relay 注入，不来源于客户端 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P01-01 | Tampering | RelayClientToServerFrame | mitigate | D-02：RelayClientToServerFrame 类型不含 provider/projectPath/agentSessionId 字段，TypeScript 编译时强制拦截 |
| T-15-P01-02 | Elevation of Privilege | TrustedChatSessionMetadata | mitigate | 类型只在 RelayServerToGatewayFrame 出现（Relay → Gateway 方向），不在 RelayClientToServerFrame 出现（Web → Relay 方向） |
</threat_model>

<verification>
```bash
# 类型定义存在
grep -c "TrustedChatSessionMetadata" packages/protocol/src/index.ts

# 新帧类型存在
grep -n "gateway.chat-session-created" packages/protocol/src/index.ts

# protocol 包 typecheck
pnpm --filter @tether/protocol exec tsc -p tsconfig.json --noEmit

# 下游包 typecheck（期望此时报错，因为实现尚未更新）
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit 2>&1 | head -30
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit 2>&1 | head -30
```
</verification>

<success_criteria>
- TrustedChatSessionMetadata 已在 protocol 包导出
- RelayServerToGatewayFrame 的 client.chat 已有 session 变体含 session: TrustedChatSessionMetadata（必填）
- RelayGatewayToServerFrame 含 gateway.chat-session-created 变体
- RelayClientToServerFrame 未被修改（不含 metadata 字段）
- pnpm --filter @tether/protocol exec tsc -p tsconfig.json --noEmit 无错误
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P01-SUMMARY.md`
</output>
