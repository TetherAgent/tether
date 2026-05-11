---
phase: "15"
plan: "04"
type: execute
wave: 3
depends_on: ["15-P01", "15-P03"]
files_modified:
  - apps/gateway/src/chat-session-runner.ts
  - apps/gateway/src/relay-client.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "ChatSessionRunner.run() 续聊分支不调用 store.getSession()，直接用 frame.session"
    - "ChatSessionRunner.createChatSession() 不调用 store.insertSession()"
    - "chat runner 中没有 store.touchSession() 调用"
    - "chat runner 中没有 store.updateAgentSessionId() 调用（由 onAgentIdUpdate 回调处理，走 Server）"
    - "relay-client.ts 续聊分支从 frame.session 取 metadata 传给 runner"
    - "relay-client.ts 新建 chat 分支触发 onChatSessionCreated 回调发 gateway.chat-session-created 帧"
    - "chatClientBindings.set 在发帧之前执行（时序正确）"
  artifacts:
    - path: apps/gateway/src/chat-session-runner.ts
      provides: "去本地 DB 的 ChatSessionRunner"
      contains: "onChatSessionCreated"
    - path: apps/gateway/src/relay-client.ts
      provides: "使用 frame.session 的续聊 + gateway.chat-session-created 上报"
      contains: "gateway.chat-session-created"
  key_links:
    - from: apps/gateway/src/relay-client.ts
      to: apps/gateway/src/chat-session-runner.ts
      via: "onChatSessionCreated callback"
      pattern: "onChatSessionCreated"
    - from: apps/gateway/src/relay-client.ts
      to: apps/relay/src/relay.ts
      via: "gateway.chat-session-created 帧"
      pattern: "gateway.chat-session-created"
---

<objective>
重写 Gateway 的 ChatSessionRunner 和 relay-client.ts 中的 chat 处理逻辑，使 chat 链路完全脱离本地 SQLite（D-05、D-06、D-09）。

Purpose: Gateway 是 provider 执行者，不是 session metadata 事实源。续聊时直接用 Relay 注入的可信 metadata；新建时显式上报 metadata 给 Relay/Server 而非依赖 sendSessions 间接同步。
Output: chat-session-runner.ts 去掉所有本地 DB 写入（insertSession/touchSession/updateAgentSessionId/getSession），relay-client.ts 更新 client.chat 两个分支。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md

<interfaces>
<!-- 当前 ChatRunnerOptions（chat-session-runner.ts 38-74 行）-->
```typescript
export type ChatRunnerOptions = {
  store: Store;
  gatewayId: () => string;
  onSessionCreated: (clientId: string, sessionId: string) => void;
  onPermissionRequest: ...;
  onUserMessage: ...;
  onDelta: ...;
  onResult: ...;
  onTool: ...;
  onError: ...;
  onAgentIdUpdate: (sessionId: string, agentSessionId: string) => void;
};
```

<!-- 当前 run() 方法（242-245 行）-->
```typescript
const session =
  params.sessionId === null
    ? this.createChatSession(params)
    : this.options.store.getSession(params.sessionId);
```

<!-- 当前 createChatSession（428-459 行）-->
```typescript
private createChatSession(params) {
  const now = Date.now();
  const sessionId = createSessionId();
  this.options.store.insertSession({ ... });
  this.options.onSessionCreated(params.clientId, sessionId);
  return this.options.store.getSession(sessionId);
}
```

<!-- 当前 touchSession 调用位置 -->
// 第 273 行：this.options.store.touchSession(sessionId);  // run() 中 userEvent 之后
// 第 399 行：this.options.store.touchSession(sessionId);  // finishResult 中
// 第 418 行：this.options.store.touchSession(sessionId);  // emitTool 中
// 第 425 行：this.options.store.touchSession(sessionId);  // emitError 中

<!-- 当前 updateAgentSessionId 调用位置 -->
// 第 369 行：this.options.store.updateAgentSessionId(sessionId, id);   // agentSessionId emitter
// 第 398 行：this.options.store.updateAgentSessionId(sessionId, agentSessionId);  // finishResult 中

<!-- 当前 relay-client.ts case 'client.chat' 分支（334-358 行）-->
// sessionId !== null: const session = options.store.getSession(frame.sessionId); 续聊
// sessionId === null: 新建，调用 runner.run(...)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 重写 ChatSessionRunner — 去掉本地 DB 依赖</name>
  <read_first>
    apps/gateway/src/chat-session-runner.ts
  </read_first>
  <files>apps/gateway/src/chat-session-runner.ts</files>
  <behavior>
    - ChatRunnerOptions 新增 onChatSessionCreated: (clientId: string, metadata: TrustedChatSessionMetadata) => void
    - ChatRunnerOptions 保留 onSessionCreated（供 PTY 链路使用，不删除）
    - run() 签名新增续聊变体：{ clientId, sessionId: string, message, model?, session: TrustedChatSessionMetadata }
    - run() 续聊分支：直接用 params.session，不调用 store.getSession()
    - createChatSession() 不调用 store.insertSession()，不调用 store.getSession()，返回构造的 TrustedChatSessionMetadata 对象，调用 onChatSessionCreated 替代 onSessionCreated
    - 删除 run() 中 store.touchSession 调用（第 273 行）
    - 删除 finishResult 中 store.updateAgentSessionId + store.touchSession（398-399 行）
    - 删除 emitTool 中 store.touchSession（第 418 行）
    - 删除 emitError 中 store.touchSession（第 425 行）
    - 删除 agentSessionId emitter 中 store.updateAgentSessionId（第 369 行）—— onAgentIdUpdate 保留，由外部（relay-client）处理 Server 更新
  </behavior>
  <action>
读取 chat-session-runner.ts 完整内容，确认所有 store.* 调用的精确行号，然后：

**步骤 1 — 在文件顶部新增 import：**

```typescript
import type { TrustedChatSessionMetadata } from '@tether/protocol';
```

**步骤 2 — 修改 ChatRunnerOptions 类型：**

在 `onSessionCreated` 行后新增：
```typescript
onChatSessionCreated: (clientId: string, metadata: TrustedChatSessionMetadata) => void;
```

**步骤 3 — 修改 run() 方法签名（params 联合类型）：**

在现有两个变体后新增（或替换已有 sessionId: string 变体）：
```typescript
// 续聊变体（带可信 metadata）
| { clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }
```

**步骤 4 — 修改 run() 续聊分支（第 242-254 行）：**

将：
```typescript
const session =
  params.sessionId === null
    ? this.createChatSession(params)
    : this.options.store.getSession(params.sessionId);
if (!session) {
  this.options.onError({ ... });
  return;
}
```

改为：
```typescript
const session: TrustedChatSessionMetadata =
  params.sessionId === null
    ? this.createChatSession(params)
    : params.session;  // D-05: 直接使用 Relay 注入的可信 metadata
// 续聊变体中 session 始终存在（由 TypeScript 类型保证）
```

**步骤 5 — 修改 run() 中 cwd 推导（第 257 行）：**

原代码 `normalizeCwd(params.sessionId === null ? params.cwd : session.projectPath)` 保持逻辑不变（session.projectPath 现在来自 TrustedChatSessionMetadata）。

**步骤 6 — 删除 store.touchSession 和 store.updateAgentSessionId 调用：**

- 删除 `this.options.store.touchSession(sessionId)` 所有出现（约 4 处）
- 删除 `this.options.store.updateAgentSessionId(sessionId, ...)` 所有出现（约 2 处）
- 保留 `this.options.onAgentIdUpdate(sessionId, id)` 和 `this.options.onAgentIdUpdate(sessionId, agentSessionId)`

**步骤 7 — 重写 createChatSession（第 428-459 行）：**

```typescript
private createChatSession(params: {
  clientId: string;
  sessionId: null;
  provider: string;
  model: string;
  cwd: string;
  message: string;
  accountId?: string;
  userId?: string;
}): TrustedChatSessionMetadata {
  const sessionId = createSessionId();
  const metadata: TrustedChatSessionMetadata = {
    id: sessionId,
    provider: params.provider,
    projectPath: normalizeCwd(params.cwd),
    accountId: params.accountId ?? '',
    userId: params.userId ?? '',
    gatewayId: this.options.gatewayId(),
    transport: 'chat'
  };
  // D-06: 不写本地 sessions，通过 onChatSessionCreated 回调上报 Relay/Server
  this.options.onChatSessionCreated(params.clientId, metadata);
  return metadata;
}
```
  </action>
  <verify>
    <automated>grep -n "store\.getSession\|store\.insertSession\|store\.touchSession\|store\.updateAgentSessionId" /Users/dream/code/tether/apps/gateway/src/chat-session-runner.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "store\.getSession" apps/gateway/src/chat-session-runner.ts` 输出 `0`
    - `grep -c "store\.insertSession" apps/gateway/src/chat-session-runner.ts` 输出 `0`
    - `grep -c "store\.touchSession" apps/gateway/src/chat-session-runner.ts` 输出 `0`
    - `grep -c "store\.updateAgentSessionId" apps/gateway/src/chat-session-runner.ts` 输出 `0`
    - `grep -c "onChatSessionCreated" apps/gateway/src/chat-session-runner.ts` 输出 >= 2（类型定义 + 调用）
    - `grep -n "TrustedChatSessionMetadata" apps/gateway/src/chat-session-runner.ts` 有输出
    - `pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>chat-session-runner.ts 中所有本地 DB 调用已删除，onChatSessionCreated 替代 onSessionCreated</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: relay-client.ts — 更新 case 'client.chat' 两个分支 + 激活 T4/T5/A8 测试</name>
  <read_first>
    apps/gateway/src/relay-client.ts
    apps/gateway/test/chat-session-runner.test.ts
    apps/gateway/test/relay-client.test.ts
  </read_first>
  <files>
    apps/gateway/src/relay-client.ts
    apps/gateway/test/chat-session-runner.test.ts
    apps/gateway/test/relay-client.test.ts
  </files>
  <behavior>
    - 续聊分支（sessionId !== null）：从 frame.session 取 metadata 传给 runner.run()，不调用 store.getSession()
    - frame.session 缺失时发 gateway.error { code: 'missing_session_metadata' } 给 Relay
    - 新建分支（sessionId === null）：传 onChatSessionCreated 回调，回调中先 chatClientBindings.set 后 send gateway.chat-session-created
    - T4（无本地续聊）、T5（新建不写本地）、A8（provider 白名单）三个测试从 skip 改为完整通过
  </behavior>
  <action>
**relay-client.ts** — 读取完整文件，找到 case 'client.chat' 分支（约 334-358 行）：

续聊分支改为：

```typescript
// 已有 session 续聊（sessionId !== null）
if (!frame.session) {
  // D-05: frame.session 是 Relay 注入的可信 metadata，缺失则报错
  send({
    type: 'gateway.error',
    gatewayId: effectiveGatewayId,
    clientId: frame.clientId,
    sessionId: frame.sessionId,
    code: 'missing_session_metadata',
    message: 'trusted session metadata is missing from relay frame'
  });
  return;
}
void runnerForProvider(frame.session.provider).run({
  clientId: frame.clientId,
  sessionId: frame.sessionId,
  message: frame.message,
  model: frame.model,
  session: frame.session  // TrustedChatSessionMetadata
});
```

新建分支（sessionId === null）的 runner 构造中，将 onSessionCreated 改为 onChatSessionCreated：

```typescript
// 在 ChatSessionRunner 构造时（或在 runnerForProvider 返回的 options 中）
// 确保 onChatSessionCreated 回调已配置：
onChatSessionCreated: (clientId, metadata) => {
  // Pitfall 3: 先 set bindings 再 send 帧（时序必须正确）
  chatClientBindings.set(metadata.id, clientId);
  send({
    type: 'gateway.chat-session-created',
    gatewayId: effectiveGatewayId,
    clientId,
    session: metadata
  });
}
```

注意：读取 relay-client.ts 确认 runner 是如何构造的（是否有 ChatSessionRunner 工厂或 options 对象），确保 onChatSessionCreated 被正确传入。

**chat-session-runner.test.ts** — 将 T4/T5 测试桩改为完整实现：

T4 测试：创建一个 mock store，runner.run 续聊时传入 session metadata，断言 store.getSession 从未被调用

T5 测试：创建 runner，调用 run({ sessionId: null, ... })，断言 store.insertSession 从未被调用，onChatSessionCreated 被调用

**relay-client.test.ts** — 将 A8 测试桩改为完整实现：

测试非白名单 provider：使用 relay-client 构造一个只支持 claude 的 runner，发送 provider: 'evil' 的帧，断言 onError 被调用
  </action>
  <verify>
    <automated>grep -n "store\.getSession\|store\.insertSession" /Users/dream/code/tether/apps/gateway/src/relay-client.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "store\.getSession" apps/gateway/src/relay-client.ts` 输出 `0`
    - `grep -n "missing_session_metadata" apps/gateway/src/relay-client.ts` 有输出
    - `grep -n "gateway.chat-session-created" apps/gateway/src/relay-client.ts` 有输出
    - `grep -n "chatClientBindings.set" apps/gateway/src/relay-client.ts` 在 onChatSessionCreated 回调中（位于 send 之前）
    - Phase15-T4、Phase15-T5、Phase15-A8 测试从 skip 变为 passing
    - `pnpm --filter @tether/gateway test` 全绿
    - `pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>relay-client.ts chat 分支已更新，三个 Gateway 测试绿色通过</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| frame.session | 来源于 Relay 的可信 metadata，Gateway 直接使用，不做额外 DB 查询 |
| onChatSessionCreated | 触发 Relay 侧 Server upsert，时序保证（D-04）由 Relay 侧负责 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P04-01 | Tampering | frame.session 缺失 | mitigate | relay-client.ts 检查 frame.session 存在性；缺失时返回 gateway.error，不执行 provider |
| T-15-P04-02 | Tampering | 新建 chat provider/cwd | mitigate | D-09：runnerForProvider 查找失败（白名单）返回 provider_not_supported 错误；cwd 由 normalizeCwd 处理 |
| T-15-P04-03 | Information Disclosure | 本地 DB 不再写 chat sessions | accept | chat 历史只存 Server DB，本地 SQLite 只保留 PTY sessions；隔离更清晰 |
</threat_model>

<verification>
```bash
# 代码级验收 A2-A5（CONTEXT.md 验收命令）
rg -n "store\.getSession\|insertSession\|touchSession\|updateAgentSessionId" \
  apps/gateway/src/chat-session-runner.ts apps/gateway/src/relay-client.ts

# Gateway 测试
pnpm --filter @tether/gateway test

# Gateway typecheck
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit
```
</verification>

<success_criteria>
- chat-session-runner.ts 无 store.getSession/insertSession/touchSession/updateAgentSessionId 调用
- relay-client.ts 无 store.getSession 调用（在 client.chat 分支中）
- relay-client.ts 有 gateway.chat-session-created 上报逻辑
- chatClientBindings.set 在 send 之前执行
- Phase15-T4/T5/A8 测试全绿
- gateway typecheck 无错误
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P04-SUMMARY.md`
</output>
