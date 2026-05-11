---
phase: "15"
plan: "02"
type: execute
wave: 2
depends_on: ["15-P01"]
files_modified:
  - apps/server/app/controller/runtime-sync.ts
  - apps/server/app/service/chatRepository.ts
  - apps/server/app/controller/chat.ts
  - apps/server/app/router.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "GET /api/relay/gateway-sessions/:sessionId/metadata 返回 provider/projectPath/agentSessionId/gatewayId/transport"
    - "该接口使用 requireRuntimeSyncSecret 中间件鉴权"
    - "返回的 accountId 和 userId 用于调用方（Relay）做权限校验"
    - "chatRepository.updateAgentSessionId 接受 scope 参数并在 WHERE 中带 account_id/gateway_id/user_id"
    - "chat.updateAgentSessionId controller 从请求体中取 scope 并传给 repository"
  artifacts:
    - path: apps/server/app/controller/runtime-sync.ts
      provides: "getSessionMetadata action"
      contains: "getSessionMetadata"
    - path: apps/server/app/service/chatRepository.ts
      provides: "updateAgentSessionId with scope WHERE clause"
      contains: "account_id = ?"
    - path: apps/server/app/router.ts
      provides: "GET /api/relay/gateway-sessions/:sessionId/metadata route"
      contains: "/api/relay/gateway-sessions/:sessionId/metadata"
  key_links:
    - from: apps/relay/src/relay.ts
      to: apps/server/app/controller/runtime-sync.ts
      via: "GET /api/relay/gateway-sessions/:sessionId/metadata"
      pattern: "gateway-sessions.*metadata"
    - from: apps/relay/src/relay.ts
      to: apps/server/app/service/chatRepository.ts
      via: "PATCH /api/relay/gateway-sessions/:sessionId/agent-session-id with scope"
      pattern: "account_id.*gateway_id.*user_id"
---

<objective>
在 Server 新增内部只读 metadata 接口，并修复 updateAgentSessionId 缺少 scope 的安全问题（D-03、D-07）。

Purpose: Relay 需要从 Server DB 获取可信 session metadata（不能依赖内存缓存），同时 agent_session_id 更新必须带账号隔离 WHERE 子句，防止跨账号覆写。
Output: 新接口 GET /api/relay/gateway-sessions/:sessionId/metadata（由 requireRuntimeSyncSecret 保护），以及 updateAgentSessionId 的 scope 增强。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md

<interfaces>
<!-- 现有 router.ts 相关路由 -->
```typescript
// 已有路由模式（apps/server/app/router.ts）
const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

router.post('/api/relay/runtime-sync/gateway/sessions', requireRuntimeSyncSecret, controller.runtimeSync.sessions);
router.patch('/api/relay/gateway-sessions/:sessionId/agent-session-id', requireRuntimeSyncSecret, controller.chat.updateAgentSessionId);
```

<!-- 现有 chatRepository.ts updateAgentSessionId（apps/server/app/service/chatRepository.ts 143-151 行） -->
```typescript
public async updateAgentSessionId(sessionId: string, agentSessionId: string): Promise<void> {
  if (!this.mysqlModeEnabled()) { return; }
  await this.ctx.service.db.query(
    'UPDATE gateway_sessions SET agent_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [agentSessionId, sessionId]
  );
}
```

<!-- 现有 gateway_sessions 查询模式（apps/server/app/service/chatRepository.ts 65-77 行） -->
```typescript
const rows = await this.ctx.service.db.query(
  `SELECT id, gateway_id, provider, project_path, title, agent_session_id, status, transport, last_active_at, created_at
   FROM gateway_sessions
   WHERE account_id = ? AND user_id = ? AND transport = 'chat'
   ORDER BY last_active_at DESC, created_at DESC
   LIMIT 50`,
  [accountId, userId]
);
```

<!-- 现有 RuntimeSyncController 结构（apps/server/app/controller/runtime-sync.ts） -->
```typescript
export default class RuntimeSyncController extends Controller {
  public async sessions(): Promise<void> { ... }
  public async event(): Promise<void> { ... }
  public async chatMessages(): Promise<void> { ... }
  public async chatCatchup(): Promise<void> { ... }
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: chatRepository — updateAgentSessionId 补 scope WHERE 子句</name>
  <read_first>
    apps/server/app/service/chatRepository.ts
    apps/server/app/controller/chat.ts
  </read_first>
  <files>
    apps/server/app/service/chatRepository.ts
    apps/server/app/controller/chat.ts
  </files>
  <behavior>
    - chatRepository.updateAgentSessionId 签名扩展为 (sessionId, agentSessionId, scope: { accountId, gatewayId, userId })
    - SQL WHERE 子句变为 `WHERE id = ? AND account_id = ? AND gateway_id = ? AND user_id = ?`
    - chat.updateAgentSessionId controller 从请求体中读取 scope.accountId、scope.gatewayId、scope.userId 并传给 repository
    - scope 字段缺失时 controller 返回 400（用 ctx.throw(400, 'Missing scope')）
  </behavior>
  <action>
**apps/server/app/service/chatRepository.ts：**

将 updateAgentSessionId 方法改为：

```typescript
public async updateAgentSessionId(
  sessionId: string,
  agentSessionId: string,
  scope: { accountId: string; gatewayId: string; userId: string }
): Promise<void> {
  if (!this.mysqlModeEnabled()) {
    return;
  }
  await this.ctx.service.db.query(
    `UPDATE gateway_sessions
     SET agent_session_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND account_id = ? AND gateway_id = ? AND user_id = ?`,
    [agentSessionId, sessionId, scope.accountId, scope.gatewayId, scope.userId]
  );
}
```

**apps/server/app/controller/chat.ts** — 找到 updateAgentSessionId 方法：

读取当前实现，在原有 sessionId/agentSessionId 参数基础上新增 scope 读取：

```typescript
public async updateAgentSessionId(): Promise<void> {
  const { ctx } = this;
  const body = ctx.request.body as Record<string, unknown>;
  const sessionId = String(body.sessionId ?? ctx.params['sessionId'] ?? '');
  const agentSessionId = String(body.agentSessionId ?? '');
  const scopeRaw = body.scope as Record<string, unknown> | undefined;
  if (!scopeRaw?.accountId || !scopeRaw?.gatewayId || !scopeRaw?.userId) {
    ctx.throw(400, 'Missing scope: accountId, gatewayId, userId required');
    return;
  }
  const scope = {
    accountId: String(scopeRaw.accountId),
    gatewayId: String(scopeRaw.gatewayId),
    userId: String(scopeRaw.userId)
  };
  await ctx.service.chatRepository.updateAgentSessionId(sessionId, agentSessionId, scope);
  ctx.success(null);
}
```

注意：先读取 chat.ts 确认当前 updateAgentSessionId 实现方式，保持其他 controller 方法不变。
  </action>
  <verify>
    <automated>grep -n "account_id = ?" /Users/dream/code/tether/apps/server/app/service/chatRepository.ts | grep -i "agent_session_id"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -A8 "updateAgentSessionId" apps/server/app/service/chatRepository.ts | grep "account_id = ?"` 有输出
    - `grep -A8 "updateAgentSessionId" apps/server/app/service/chatRepository.ts | grep "gateway_id = ?"` 有输出
    - `grep -A8 "updateAgentSessionId" apps/server/app/service/chatRepository.ts | grep "user_id = ?"` 有输出
    - `grep "scope" apps/server/app/controller/chat.ts | grep "updateAgentSessionId\|accountId\|gatewayId"` 有输出
    - `pnpm --filter @tether/server typecheck` 无错误
  </acceptance_criteria>
  <done>updateAgentSessionId 的 SQL WHERE 包含 account_id/gateway_id/user_id，controller 读取并传递 scope</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Server — 新增 GET /api/relay/gateway-sessions/:sessionId/metadata 接口</name>
  <read_first>
    apps/server/app/controller/runtime-sync.ts
    apps/server/app/service/chatRepository.ts
    apps/server/app/router.ts
  </read_first>
  <files>
    apps/server/app/controller/runtime-sync.ts
    apps/server/app/service/chatRepository.ts
    apps/server/app/router.ts
  </files>
  <behavior>
    - GET /api/relay/gateway-sessions/:sessionId/metadata 受 requireRuntimeSyncSecret 保护
    - 接口查询 gateway_sessions 表，按 id = :sessionId 返回 provider/projectPath/agentSessionId/gatewayId/accountId/userId/transport
    - session 不存在时返回 404（ctx.throw(404, 'Session not found')）
    - 返回数据通过 ctx.success({ data: {...} }) 包装
    - chatRepository 新增 getSessionMetadata(sessionId) 方法
  </behavior>
  <action>
**apps/server/app/service/chatRepository.ts** — 新增方法（在 updateAgentSessionId 之后）：

```typescript
public async getSessionMetadata(sessionId: string): Promise<{
  id: string;
  provider: string;
  projectPath: string;
  agentSessionId: string | undefined;
  gatewayId: string;
  accountId: string;
  userId: string;
  transport: string;
} | undefined> {
  if (!this.mysqlModeEnabled()) {
    return undefined;
  }
  const rows = await this.ctx.service.db.query(
    `SELECT id, provider, project_path, agent_session_id, gateway_id, account_id, user_id, transport
     FROM gateway_sessions
     WHERE id = ?
     LIMIT 1`,
    [sessionId]
  ) as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return undefined;
  }
  const row = rows[0]!;
  return {
    id: String(row.id ?? ''),
    provider: String(row.provider ?? ''),
    projectPath: String(row.project_path ?? ''),
    agentSessionId: row.agent_session_id != null ? String(row.agent_session_id) : undefined,
    gatewayId: String(row.gateway_id ?? ''),
    accountId: String(row.account_id ?? ''),
    userId: String(row.user_id ?? ''),
    transport: String(row.transport ?? '')
  };
}
```

**apps/server/app/controller/runtime-sync.ts** — 在类末尾新增方法：

```typescript
public async getSessionMetadata(): Promise<void> {
  const { ctx } = this;
  const sessionId = String(ctx.params['sessionId'] ?? '');
  if (!sessionId) {
    ctx.throw(400, 'Missing sessionId');
    return;
  }
  const metadata = await ctx.service.chatRepository.getSessionMetadata(sessionId);
  if (!metadata) {
    ctx.throw(404, 'Session not found');
    return;
  }
  ctx.success({ data: metadata });
}
```

**apps/server/app/router.ts** — 在 patch /api/relay/gateway-sessions/:sessionId/agent-session-id 附近新增：

```typescript
router.get('/api/relay/gateway-sessions/:sessionId/metadata', requireRuntimeSyncSecret, controller.runtimeSync.getSessionMetadata);
```

按路由文件现有风格放置（Relay → Server 运行时同步区域）。
  </action>
  <verify>
    <automated>grep -n "getSessionMetadata" /Users/dream/code/tether/apps/server/app/router.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "/api/relay/gateway-sessions/:sessionId/metadata" apps/server/app/router.ts` 有输出且包含 requireRuntimeSyncSecret
    - `grep -n "getSessionMetadata" apps/server/app/controller/runtime-sync.ts` 有输出
    - `grep -n "getSessionMetadata" apps/server/app/service/chatRepository.ts` 有输出
    - `grep -n "project_path.*agent_session_id.*gateway_id.*account_id.*user_id" apps/server/app/service/chatRepository.ts` 在 getSessionMetadata SQL 中有输出
    - `pnpm --filter @tether/server typecheck` 无错误
  </acceptance_criteria>
  <done>GET /api/relay/gateway-sessions/:sessionId/metadata 接口已注册，受 requireRuntimeSyncSecret 保护，返回完整 metadata</done>
</task>

<task type="auto">
  <name>Task 3: Server 测试 — 激活 T7 测试桩并通过</name>
  <read_first>
    apps/server/test/chat-repository.test.ts
    apps/server/app/service/chatRepository.ts
  </read_first>
  <files>apps/server/test/chat-repository.test.ts</files>
  <action>
将 Wave 0 追加的 Phase15-T7 测试桩从 `it.skip` 改为 `it`，并填入完整实现：

```typescript
it('Phase15-T7: updateAgentSessionId scopes WHERE to accountId, gatewayId, userId', async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = []
  const db = ctx.service.db as unknown as {
    mysqlModeEnabled: () => boolean
    query: (sql: string, values?: unknown[]) => Promise<unknown>
  }
  db.mysqlModeEnabled = () => true
  db.query = async (sql, values) => {
    queries.push({ sql, values })
    return { affectedRows: 1 }
  }

  await ctx.service.chatRepository.updateAgentSessionId(
    'tth_session_1',
    'agent-session-abc',
    { accountId: 'acct_1', gatewayId: 'gw_1', userId: 'user_1' }
  )

  assert.equal(queries.length, 1)
  assert.match(queries[0]!.sql, /account_id = \?/)
  assert.match(queries[0]!.sql, /gateway_id = \?/)
  assert.match(queries[0]!.sql, /user_id = \?/)
  assert.deepEqual(queries[0]!.values, ['agent-session-abc', 'tth_session_1', 'acct_1', 'gw_1', 'user_1'])
})
```
  </action>
  <verify>
    <automated>pnpm --filter @tether/server test 2>&1 | grep -E "Phase15-T7|passing|failing"</automated>
  </verify>
  <acceptance_criteria>
    - Phase15-T7 测试从 skip/pending 变为 passing
    - `pnpm --filter @tether/server test` 全绿，无新增失败测试
  </acceptance_criteria>
  <done>T7 测试绿色通过，updateAgentSessionId scope 校验覆盖完整</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| GET /api/relay/gateway-sessions/:sessionId/metadata | 只有携带 TETHER_RUNTIME_SYNC_SECRET 的内部调用者（Relay）可访问，nginx 限制 127.0.0.1 |
| PATCH .../agent-session-id scope | 必须携带 accountId/gatewayId/userId，Server SQL WHERE 强制隔离，防止跨账号覆写 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P02-01 | Elevation of Privilege | GET /api/relay/.../metadata | mitigate | requireRuntimeSyncSecret 中间件拦截无密钥请求；路由前缀 /api/relay/ 表示内部专用 |
| T-15-P02-02 | Tampering | updateAgentSessionId | mitigate | D-07：SQL WHERE 带 account_id/gateway_id/user_id，影响行数为 0 时为静默（已接受：Relay 携带正确 scope） |
| T-15-P02-03 | Information Disclosure | getSessionMetadata 返回字段 | mitigate | 接口仅返回 metadata（无密码/token/secret），调用方（Relay）需持有 runtimeSyncSecret |
</threat_model>

<verification>
```bash
# 路由注册验证
grep -n "getSessionMetadata" apps/server/app/router.ts

# SQL scope 验证
grep -A10 "updateAgentSessionId" apps/server/app/service/chatRepository.ts | grep "account_id\|gateway_id\|user_id"

# 全量 typecheck
pnpm --filter @tether/server typecheck

# 运行 Server 测试
pnpm --filter @tether/server test
```
</verification>

<success_criteria>
- GET /api/relay/gateway-sessions/:sessionId/metadata 已注册并受 requireRuntimeSyncSecret 保护
- chatRepository.getSessionMetadata 返回 provider/projectPath/agentSessionId/gatewayId/accountId/userId/transport
- chatRepository.updateAgentSessionId SQL WHERE 包含 account_id/gateway_id/user_id
- T7 测试绿色通过
- pnpm --filter @tether/server typecheck 无错误
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P02-SUMMARY.md`
</output>
