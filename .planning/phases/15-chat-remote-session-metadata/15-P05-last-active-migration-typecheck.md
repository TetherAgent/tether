---
phase: "15"
plan: "05"
type: execute
wave: 4
depends_on: ["15-P02", "15-P03", "15-P04"]
files_modified:
  - apps/server/app/service/runtimeSyncRepository.ts
  - apps/server/app/controller/runtime-sync.ts
  - apps/relay/src/relay.ts
autonomous: false
requirements: []
must_haves:
  truths:
    - "user.message / agent.result 类型的 chat event 入库时更新 gateway_sessions.last_active_at"
    - "migration 007 在所有环境已执行，gateway_sessions 无 workspace_id 列"
    - "全量 TypeScript typecheck：gateway、relay、server 三个包均 --noEmit 无错误"
    - "代码级验收 A1-A5 全部通过（rg 输出为空）"
    - "updateAgentSessionId PATCH 中 Relay 携带 scope（accountId/gatewayId/userId）"
  artifacts:
    - path: apps/server/app/service/runtimeSyncRepository.ts
      provides: "user.message/agent.result 入库时更新 last_active_at"
      contains: "last_active_at"
  key_links:
    - from: apps/relay/src/relay.ts
      to: apps/server/app/controller/chat.ts
      via: "PATCH /api/relay/gateway-sessions/:sessionId/agent-session-id with scope body"
      pattern: "scope.*accountId.*gatewayId.*userId"
---

<objective>
完成 Phase 15 最后收尾：last_active_at 更新（D-11）、migration 验证（D-12）、Relay PATCH scope 注入（D-07 的 Relay 侧）、全量 typecheck，以及最终验收命令确认。

Purpose: 三个实现 Plan（P02/P03/P04）完成后，需要验证整体 typecheck 通过、last_active_at 在 Server 侧正确更新、migration workspace_id 问题不影响新建 chat，并通过验收命令确认所有代码级 A1-A5 通过。
Output: last_active_at 更新逻辑、Relay PATCH scope、完整 typecheck 无错误，以及人工 UAT checkpoint。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md
@.planning/phases/15-chat-remote-session-metadata/15-P02-SUMMARY.md
@.planning/phases/15-chat-remote-session-metadata/15-P03-SUMMARY.md
@.planning/phases/15-chat-remote-session-metadata/15-P04-SUMMARY.md

<interfaces>
<!-- 现有 upsertGatewaySession（apps/server/app/service/runtimeSyncRepository.ts 115-131 行）-->
```typescript
// 已验证不含 workspace_id 列，按 D-12 合规
public async upsertGatewaySession(session: ..., scope: ...): Promise<void>
```

<!-- 现有 chatMessages/chatEvent 入库（apps/server/app/controller/runtime-sync.ts chatMessages 方法）-->
// gateway_chat_messages 表写入时，updateLastActiveAt 应同时触发
// event.type 为 'user.message' 或 'agent.result' 时触发

<!-- Relay 中 session.agent-id-updated 处理（relay.ts handleGatewayFrame）-->
// 现有 PATCH 调用只发 { sessionId, agentSessionId }，需加 scope: { accountId, gatewayId, userId }
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Server — user.message/agent.result 入库时更新 last_active_at（D-11）</name>
  <read_first>
    apps/server/app/service/runtimeSyncRepository.ts
    apps/server/app/controller/runtime-sync.ts
  </read_first>
  <files>
    apps/server/app/service/runtimeSyncRepository.ts
    apps/server/app/controller/runtime-sync.ts
  </files>
  <behavior>
    - chatMessages 入库逻辑（gateway_chat_messages INSERT）后，当 event.type 为 'user.message' 或 'agent.result' 时，同步执行 UPDATE gateway_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = :sessionId
    - 此更新在 runtimeSyncRepository 中实现（新方法 updateSessionLastActiveAt 或在 upsertChatMessage 内联）
    - 不更新 last_active_at 对 agent.tool 和 session.error 类型（避免频繁更新）
    - 如果现有 chatMessages controller 已有 event.type 判断逻辑，复用该逻辑
  </behavior>
  <action>
读取 runtimeSyncRepository.ts 和 runtime-sync.ts 的 chatMessages 处理方法，确认 gateway_chat_messages 写入的位置和 event.type 判断。

**在 runtimeSyncRepository.ts 中新增（或在现有 upsertChatMessage 内）：**

```typescript
public async updateSessionLastActiveAt(sessionId: string): Promise<void> {
  if (!this.mysqlModeEnabled()) {
    return;
  }
  await this.ctx.service.db.query(
    `UPDATE gateway_sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [sessionId]
  );
}
```

**在 runtime-sync.ts 的 chatMessages 方法中（处理 user.message / agent.result 后）：**

```typescript
if (event.type === 'user.message' || event.type === 'agent.result') {
  await ctx.service.runtimeSyncRepository.updateSessionLastActiveAt(sessionId);
}
```

注意：先读取文件确认 chatMessages 方法是否已有类似逻辑，如有则复用而不是新增重复。
  </action>
  <verify>
    <automated>grep -n "updateSessionLastActiveAt\|last_active_at" /Users/dream/code/tether/apps/server/app/service/runtimeSyncRepository.ts | head -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "updateSessionLastActiveAt\|last_active_at.*CURRENT_TIMESTAMP" apps/server/app/service/runtimeSyncRepository.ts` 有输出（在 chat 相关方法中）
    - `grep -n "user.message.*agent.result\|agent.result.*user.message" apps/server/app/controller/runtime-sync.ts` 或等效的 event.type 判断有输出
    - `pnpm --filter @tether/server typecheck` 无错误
  </acceptance_criteria>
  <done>user.message/agent.result 入库时 last_active_at 自动更新</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Relay — PATCH agent-session-id 携带 scope（D-07 Relay 侧）</name>
  <read_first>
    apps/relay/src/relay.ts
  </read_first>
  <files>apps/relay/src/relay.ts</files>
  <behavior>
    - 找到 relay.ts 中处理 session.agent-id-updated 事件并发 PATCH 到 Server 的位置
    - 在 PATCH body 中加入 scope: { accountId, gatewayId, userId }
    - accountId/gatewayId 从 gatewayScope 取（已在 handleGatewayFrame 上下文中）
    - userId 从 latestSessions.get(sessionId)?.userId 取（若不存在则使用 gatewayScope.userId 或空字符串）
  </behavior>
  <action>
读取 relay.ts，查找 `session.agent-id-updated` 事件的处理代码（在 handleGatewayFrame 的 gateway.event case 中）：

```typescript
// 当前（只发 { sessionId, agentSessionId }）
// 目标（加 scope）
await syncToServer(`/api/relay/gateway-sessions/${sessionId}/agent-session-id`, {
  sessionId,
  agentSessionId,
  scope: {
    accountId: gatewayScope.accountId,
    gatewayId: gatewayScope.gatewayId ?? frame.gatewayId,
    userId: latestSessions.get(sessionId)?.userId ?? ''
  }
}, 'PATCH');
```

注意：读取文件确认当前 PATCH 调用的实际代码位置和变量名（gatewayScope 在 handleGatewayFrame 中的实际绑定名称）。
  </action>
  <verify>
    <automated>grep -n "agent-session-id\|agent-id-updated" /Users/dream/code/tether/apps/relay/src/relay.ts | head -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -A5 "agent-session-id" apps/relay/src/relay.ts | grep "scope\|accountId\|gatewayId"` 有输出
    - `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>Relay 发 PATCH agent-session-id 时携带 scope，与 Server D-07 scoped WHERE 对应</done>
</task>

<task type="auto">
  <name>Task 3: 全量 TypeScript typecheck + 代码级验收 A1-A5</name>
  <read_first>
    apps/gateway/src/chat-session-runner.ts
    apps/gateway/src/relay-client.ts
  </read_first>
  <files></files>
  <action>
此任务为纯验证，不修改任何文件。按顺序执行以下验证：

**验收 A1-A5（代码级验收命令来自 CONTEXT.md）：**

```bash
# A1: chat 内容不写本地 DB（已在 Phase 13 完成，应输出为空）
rg -n "appendChatEvent|listChatEvents|session_chats_events" apps/gateway/src

# A2: Gateway 续聊不调用 store.getSession
rg -n "store\.getSession\(" apps/gateway/src/chat-session-runner.ts apps/gateway/src/relay-client.ts

# A3: createChatSession 不调用 insertSession
rg -n "insertSession\(" apps/gateway/src/chat-session-runner.ts

# A4: chat runner 不调用 touchSession
rg -n "touchSession\(" apps/gateway/src/chat-session-runner.ts

# A5: chat runner 不调用 updateAgentSessionId
rg -n "updateAgentSessionId\(" apps/gateway/src/chat-session-runner.ts
```

**全量 TypeScript typecheck：**

```bash
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/server run typecheck
```

**如果任何 typecheck 报错，则修复对应文件。**

常见修复点：
- Gateway chat-session-runner.ts 中 run() params 联合类型判断（'session' in params）
- relay-client.ts 对 RelayServerToGatewayFrame client.chat 新 session 字段的 TypeScript 访问
- relay.ts 中 TrustedChatSessionMetadata import（来自 @tether/protocol）

执行方式：在 relay.ts/relay-client.ts/chat-session-runner.ts 顶部添加必要 import，修复类型错误后再次运行 typecheck。
  </action>
  <verify>
    <automated>pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS" || echo "0 errors"</automated>
  </verify>
  <acceptance_criteria>
    - A1-A5 的 rg 命令均输出为空（无匹配行）
    - `pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit` 输出 0 TypeScript 错误
    - `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` 输出 0 TypeScript 错误
    - `pnpm --filter @tether/server run typecheck` 输出 0 TypeScript 错误
  </acceptance_criteria>
  <done>代码级验收 A1-A5 全部通过（rg 无输出），三个包 typecheck 无错误</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
Phase 15 全量实现完成。以下是已交付的功能：
- GET /api/relay/gateway-sessions/:sessionId/metadata — Relay 内部 metadata 查询接口
- Relay client.chat 续聊：从 Server DB 取 metadata → 权限校验 → 注入 session 字段转发
- Relay gateway.chat-session-created：await Server upsert → 通知 Web session-created
- Gateway ChatSessionRunner：续聊用 frame.session，新建不写本地 DB
- updateAgentSessionId：Server WHERE 带 scope，Relay PATCH 携带 scope
- last_active_at：user.message/agent.result 入库时更新
- 全量 typecheck 通过，T1/T2/T4/T5/T7/A7/A8 测试全绿
  </what-built>
  <how-to-verify>
本地测试拓扑启动（需要 4 个终端）：

```bash
# 终端 1
pnpm --filter @tether/server dev

# 终端 2
pnpm --filter @tether/relay dev

# 终端 3
pnpm tether gateway login --env local
pnpm tether gateway start

# 终端 4
pnpm --filter @tether/web dev
```

验收步骤：

1. 登录 Web，进入 `/chats`
2. 新建一个 chat（选择 provider 和 cwd），发送第一条消息，确认 AI 回复出现
3. 刷新页面，确认消息历史从 Server DB 恢复（不依赖 Gateway）
4. 停止 Gateway（Ctrl+C），再重新启动 Gateway
5. 对同一个 chat 继续发送消息，确认续聊成功（Gateway 无本地 session 行）
6. 查询 Server DB（或 /api/server/chat-sessions）：
   - gateway_sessions 有该 chat session
   - agent_session_id 已更新
   - last_active_at 随新消息更新
7. 查询本地 SQLite，确认 chat 链路无新增 sessions 行：

```bash
sqlite3 ~/.tether/tether.db "select id, transport from sessions where transport = 'chat';"
# 期望：空结果

sqlite3 ~/.tether/tether.db ".tables"
# 期望：不含 session_chats_events
```

8. 验证 PTY sessions 不受影响（attach 到现有 PTY session，确认仍可输入/输出）
  </how-to-verify>
  <resume-signal>输入 "approved" 或描述发现的问题（如果有问题，记录具体现象后继续修复）</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Relay → Server PATCH scope | PATCH body 携带 accountId/gatewayId/userId，Server WHERE 强制隔离 |
| last_active_at 更新 | 只在 server-side chat event 入库时触发，不由 Gateway 本地触发 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P05-01 | Tampering | agent_session_id PATCH scope | mitigate | D-07：Relay 携带 gatewayScope.accountId/gatewayId + session userId，Server WHERE 4 字段限定 |
| T-15-P05-02 | Information Disclosure | workspace_id schema（D-12） | mitigate | upsertGatewaySession SQL 不含 workspace_id；007 migration 已删除该列；验证命令确认无列 |
| T-15-P05-03 | Tampering | last_active_at 更新时机 | accept | 只在 user.message/agent.result 入库时更新，精确反映聊天活跃度，无安全风险 |
</threat_model>

<verification>
```bash
# 代码级验收 A1-A5
rg -n "appendChatEvent|listChatEvents|session_chats_events" apps/gateway/src
rg -n "store\.getSession\(|insertSession\(|touchSession\(|updateAgentSessionId\(" \
  apps/gateway/src/chat-session-runner.ts apps/gateway/src/relay-client.ts

# 全量 typecheck
pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit
pnpm --filter @tether/server run typecheck

# 全量测试
pnpm --filter @tether/gateway test
pnpm --filter @tether/relay test
pnpm --filter @tether/server test
```
</verification>

<success_criteria>
- A1-A5 rg 命令全部输出为空
- 三个包 typecheck 无 TypeScript 错误
- last_active_at 在 user.message/agent.result 入库时更新
- Relay PATCH agent-session-id 携带 scope
- 所有自动化测试绿色
- 人工 UAT checkpoint 通过
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P05-SUMMARY.md`
</output>
