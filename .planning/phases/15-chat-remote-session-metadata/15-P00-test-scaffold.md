---
phase: "15"
plan: "00"
type: execute
wave: 0
depends_on: []
files_modified:
  - apps/relay/test/relay.test.ts
  - apps/gateway/test/chat-session-runner.test.ts
  - apps/gateway/test/relay-client.test.ts
  - apps/server/test/chat-repository.test.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "relay.test.ts 包含 T1（metadata 补齐）、T2（跨账号隔离）、A7（transport 校验）三个 SKIP/TODO 测试用例，运行时报 skip 或 fail"
    - "chat-session-runner.test.ts 包含 T4（无本地续聊）、T5（新建不写本地）两个 SKIP 测试用例"
    - "relay-client.test.ts 包含 A8（provider/cwd 约束）一个 SKIP 测试用例"
    - "chat-repository.test.ts 包含 T7（updateAgentSessionId scope 校验）一个 SKIP 测试用例"
  artifacts:
    - path: apps/relay/test/relay.test.ts
      provides: "T1/T2/A7 RED test stubs"
      contains: "Phase 15"
    - path: apps/gateway/test/chat-session-runner.test.ts
      provides: "T4/T5 RED test stubs"
      contains: "Phase 15"
    - path: apps/gateway/test/relay-client.test.ts
      provides: "A8 RED test stub"
      contains: "Phase 15"
    - path: apps/server/test/chat-repository.test.ts
      provides: "T7 RED test stub"
      contains: "Phase 15"
  key_links: []
---

<objective>
Phase 15 测试脚手架：在现有测试文件末尾追加标注为 Phase 15 的 RED（失败）测试用例，为后续 Wave 1-3 的实现提供可执行的验收门。

Purpose: 遵循 Nyquist 验收合规要求 — 所有验收测试必须在实现前以失败状态存在，避免"绿灯幻觉"。
Output: 四个现有测试文件各新增若干 TODO/skip 测试，运行测试套件时这些用例报 skip 或 pending。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: relay.test.ts — 追加 T1/T2/A7 测试桩</name>
  <read_first>
    apps/relay/test/relay.test.ts
  </read_first>
  <files>apps/relay/test/relay.test.ts</files>
  <action>
在文件末尾追加三个测试（使用 node:test 的 `test.todo()` 形式，或 `skip: true` 选项），不得修改已有测试。

测试描述（**必须使用这些精确描述字符串**）：

```typescript
// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-T1: relay injects trusted metadata into client.chat (existing session)', { skip: 'Phase 15 not implemented' }, async () => {
  // Relay 收到已有 session 的 client.chat（sessionId !== null）
  // 应向 Server 查询 metadata 并在转发给 Gateway 的帧中注入 session 字段
  // 断言：Gateway 收到的 client.chat 帧含 session.provider / session.projectPath / session.transport='chat'
});

test('Phase15-T2: relay rejects cross-account session continuation', { skip: 'Phase 15 not implemented' }, async () => {
  // 多租户隔离：A 账号的 client 发续聊 B 账号的 sessionId
  // 断言：Relay 返回 error { code: 'forbidden' }，不转发给任何 Gateway
  // 两个 Gateway 均连接，B 的 Gateway 先连（CLAUDE.md R4 模板）
});

test('Phase15-A7: relay rejects client.chat for PTY sessions (transport mismatch)', { skip: 'Phase 15 not implemented' }, async () => {
  // Server 返回 transport='pty-event-stream' 的 session
  // 断言：Relay 返回 error { code: 'wrong_transport' }，不转发给 Gateway
});
```

注意：
- `test.todo()` 在 tsx --test 框架中可能表现不同，使用 `{ skip: 'Phase 15 not implemented' }` 选项最兼容
- 追加位置：文件末尾最后一个 `test(...)` 块之后
- 不能修改已有任何测试
  </action>
  <verify>
    <automated>grep -c "Phase15-T1\|Phase15-T2\|Phase15-A7" /Users/dream/code/tether/apps/relay/test/relay.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase15-T1" apps/relay/test/relay.test.ts` 输出 `1`
    - `grep -c "Phase15-T2" apps/relay/test/relay.test.ts` 输出 `1`
    - `grep -c "Phase15-A7" apps/relay/test/relay.test.ts` 输出 `1`
    - `pnpm --filter @tether/relay test` 运行不报编译错误，原有测试全绿，新增 3 个报 skip
  </acceptance_criteria>
  <done>relay.test.ts 末尾有 3 个标注 Phase 15 的 skip 测试，不影响现有测试通过状态</done>
</task>

<task type="auto">
  <name>Task 2: chat-session-runner.test.ts + relay-client.test.ts — 追加 T4/T5/A8 测试桩</name>
  <read_first>
    apps/gateway/test/chat-session-runner.test.ts
    apps/gateway/test/relay-client.test.ts
  </read_first>
  <files>
    apps/gateway/test/chat-session-runner.test.ts
    apps/gateway/test/relay-client.test.ts
  </files>
  <action>
**chat-session-runner.test.ts** — 文件末尾追加：

```typescript
// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-T4: chat runner resumes existing session from frame.session without calling store.getSession', { skip: 'Phase 15 not implemented' }, async () => {
  // 续聊分支：runner.run({ sessionId: 'tth_xxx', session: trustedMetadata, message: 'hi' })
  // 断言：store.getSession 从未被调用
  // 断言：subprocess 被以正确 provider/cwd/agentSessionId 启动
});

test('Phase15-T5: createChatSession does not call store.insertSession', { skip: 'Phase 15 not implemented' }, async () => {
  // 新建分支：runner.run({ sessionId: null, provider: 'claude', cwd: '/tmp', ... })
  // 断言：store.insertSession 从未被调用
  // 断言：onChatSessionCreated 回调被调用（取代 onSessionCreated）
});
```

**relay-client.test.ts** — 文件末尾追加：

```typescript
// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-A8: relay-client rejects new chat with non-whitelisted provider', { skip: 'Phase 15 not implemented' }, async () => {
  // Gateway 收到 client.chat { sessionId: null, provider: 'evil-provider', ... }
  // 断言：onError 被调用，错误码为 'provider_not_supported' 或 'invalid_provider'
  // 断言：没有启动任何 subprocess
});
```
  </action>
  <verify>
    <automated>grep -c "Phase15-T4\|Phase15-T5" /Users/dream/code/tether/apps/gateway/test/chat-session-runner.test.ts && grep -c "Phase15-A8" /Users/dream/code/tether/apps/gateway/test/relay-client.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase15-T4" apps/gateway/test/chat-session-runner.test.ts` 输出 `1`
    - `grep -c "Phase15-T5" apps/gateway/test/chat-session-runner.test.ts` 输出 `1`
    - `grep -c "Phase15-A8" apps/gateway/test/relay-client.test.ts` 输出 `1`
    - `pnpm --filter @tether/gateway test` 运行不报编译错误，原有测试全绿，新增 3 个报 skip
  </acceptance_criteria>
  <done>两个 Gateway 测试文件各新增 skip 测试桩，现有测试不受影响</done>
</task>

<task type="auto">
  <name>Task 3: chat-repository.test.ts — 追加 T7 测试桩</name>
  <read_first>
    apps/server/test/chat-repository.test.ts
  </read_first>
  <files>apps/server/test/chat-repository.test.ts</files>
  <action>
在文件末尾 `describe` 块内（或块外，保持与现有测试一致的风格）追加：

```typescript
  it.skip('Phase15-T7: updateAgentSessionId scopes WHERE to accountId, gatewayId, userId', async () => {
    // 断言：SQL 中包含 "account_id = ?" "gateway_id = ?" "user_id = ?"
    // 断言：scope 参数被正确传递到 SQL 占位符
  })
```

若文件使用 mocha/describe 风格，使用 `it.skip()`；若使用 node:test，使用 `test(..., { skip: true }, ...)`。当前文件使用 `describe/it`，用 `it.skip` 形式。
  </action>
  <verify>
    <automated>grep -c "Phase15-T7" /Users/dream/code/tether/apps/server/test/chat-repository.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Phase15-T7" apps/server/test/chat-repository.test.ts` 输出 `1`
    - `pnpm --filter @tether/server test` 运行不报编译错误，T7 用例报 pending/skip
  </acceptance_criteria>
  <done>chat-repository.test.ts 末尾有 Phase15-T7 的 skip 测试桩</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test code → production | 测试文件只追加 skip 用例，不修改生产逻辑 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P00-01 | Tampering | test stubs | accept | 测试脚手架不修改生产代码，风险为零 |
</threat_model>

<verification>
```bash
# 验证所有测试桩已追加
grep -rn "Phase15-" apps/relay/test/relay.test.ts apps/gateway/test/chat-session-runner.test.ts apps/gateway/test/relay-client.test.ts apps/server/test/chat-repository.test.ts

# 验证现有测试不受影响
pnpm --filter @tether/relay test
pnpm --filter @tether/gateway test
```
</verification>

<success_criteria>
- relay.test.ts 新增 3 个 Phase 15 skip 测试（T1/T2/A7）
- chat-session-runner.test.ts 新增 2 个 Phase 15 skip 测试（T4/T5）
- relay-client.test.ts 新增 1 个 Phase 15 skip 测试（A8）
- chat-repository.test.ts 新增 1 个 Phase 15 skip 测试（T7）
- 原有测试套件全部绿色通过，无新增失败
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P00-SUMMARY.md`
</output>
