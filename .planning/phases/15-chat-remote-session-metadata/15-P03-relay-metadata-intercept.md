---
phase: "15"
plan: "03"
type: execute
wave: 2
depends_on: ["15-P01"]
files_modified:
  - apps/relay/src/relay.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "已有 session 续聊（sessionId !== null）时 Relay 调用 Server GET metadata 接口后再转发给 Gateway"
    - "转发帧包含 session: TrustedChatSessionMetadata（Relay 注入，不来源于 Web）"
    - "accountId/userId/transport='chat' 三项权限校验在转发前执行"
    - "PTY session（transport != 'chat'）发 client.chat 时 Relay 返回 error { code: 'wrong_transport' }"
    - "跨账号 session（metadata.accountId != clientScope.accountId）返回 error { code: 'forbidden' }"
    - "gatewayId 对应 Gateway 不在线时返回 gateway_unavailable"
    - "Relay 收到 gateway.chat-session-created 时，await syncToServer 成功后再通知 Web session-created"
  artifacts:
    - path: apps/relay/src/relay.ts
      provides: "fetchSessionMetadata helper + 改造后的 case 'client.chat' + case 'gateway.chat-session-created'"
      contains: "fetchSessionMetadata"
  key_links:
    - from: apps/relay/src/relay.ts
      to: apps/server/app/controller/runtime-sync.ts
      via: "GET /api/relay/gateway-sessions/:sessionId/metadata"
      pattern: "fetchSessionMetadata"
    - from: apps/relay/src/relay.ts
      to: apps/gateway/src/relay-client.ts
      via: "client.chat 帧带 session: TrustedChatSessionMetadata"
      pattern: "session.*TrustedChatSessionMetadata"
---

<objective>
改造 relay.ts 中的 `case 'client.chat'` 和新增 `case 'gateway.chat-session-created'` 处理，实现 D-03/D-08/D-13 的权限和 transport 校验以及 D-04 的新建 chat 同步顺序。

Purpose: Relay 是系统的信任边界。已有 session 续聊时 Relay 必须从 Server DB 查可信 metadata，注入到转发帧，并做三项校验（账号、transport、Gateway 在线状态）。新建 chat 时 Relay 必须 await Server upsert 成功后才通知 Web。
Output: relay.ts 中的 fetchSessionMetadata helper 函数、改造后的 case 'client.chat' 已有 session 分支、新增 case 'gateway.chat-session-created' 处理。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/15-chat-remote-session-metadata/15-CONTEXT.md
@.planning/phases/15-chat-remote-session-metadata/15-RESEARCH.md

<interfaces>
<!-- 当前 relay.ts case 'client.chat'（第 653-667 行）-->
```typescript
case 'client.chat':
  forwardToGateway(ensureClientGatewayId(clientId), frame.sessionId === null
    ? {
        type: 'client.chat',
        clientId,
        sessionId: null,
        provider: frame.provider,
        model: frame.model,
        cwd: frame.cwd,
        message: frame.message,
        accountId: clientScope.accountId,
        userId: clientScope.userId
      }
    : { type: 'client.chat', clientId, sessionId: frame.sessionId, message: frame.message, model: frame.model });
  break;
```

<!-- syncToServer helper（第 78-98 行，可复用为 fetchFromServer） -->
```typescript
async function syncToServer(endpoint: string, body: unknown, method = 'POST'): Promise<void> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) { return; }
  try {
    const response = await fetch(`${options.serverSyncUrl}${endpoint}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tether-runtime-sync-secret': options.runtimeSyncSecret
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) console.warn(`[relay] sync failed: ${endpoint} HTTP ${response.status}`);
  } catch (error) {
    console.warn(`[relay] sync error: ${endpoint}`, String(error));
  }
}
```

<!-- sendToClient helper（已存在于 relay.ts） -->
```typescript
function sendToClient(clientId: string, frame: RelayServerToClientFrame): void { ... }
function sendGatewayUnavailable(clientId: string, sessionId?: string): void { ... }
```

<!-- handleClientFrame 函数签名（当前同步，需改为 async） -->
```typescript
function handleClientFrame(clientId: string, frame: RelayClientToServerFrame): void { ... }
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: 新增 fetchSessionMetadata helper + handleClientFrame 改为 async</name>
  <read_first>
    apps/relay/src/relay.ts
  </read_first>
  <files>apps/relay/src/relay.ts</files>
  <behavior>
    - fetchSessionMetadata(sessionId) 调用 GET /api/relay/gateway-sessions/:sessionId/metadata，返回 TrustedChatSessionMetadata | undefined
    - 如果 serverSyncUrl/runtimeSyncSecret 未配置，返回 undefined
    - HTTP 失败（非 2xx）或 fetch 异常时，返回 undefined（Relay 侧失败由 case 'client.chat' 处理为明确错误）
    - handleClientFrame 改为 async function 返回 Promise<void>
    - 调用 handleClientFrame 的地方（socket.on('message', ...)）改为 void (async () => { ... })() 包装
  </behavior>
  <action>
读取 relay.ts 完整内容，确认：
1. syncToServer 函数的位置
2. handleClientFrame 函数声明位置
3. handleClientFrame 被调用的位置（socket.on 中）

**紧靠 syncToServer 之后新增 fetchSessionMetadata：**

```typescript
async function fetchSessionMetadata(sessionId: string): Promise<TrustedChatSessionMetadata | undefined> {
  if (!options.serverSyncUrl || !options.runtimeSyncSecret) {
    return undefined;
  }
  try {
    const response = await fetch(
      `${options.serverSyncUrl}/api/relay/gateway-sessions/${encodeURIComponent(sessionId)}/metadata`,
      {
        method: 'GET',
        headers: { 'x-tether-runtime-sync-secret': options.runtimeSyncSecret },
        signal: AbortSignal.timeout(3000)
      }
    );
    if (!response.ok) {
      console.warn(`[relay] fetchSessionMetadata failed: HTTP ${response.status} for ${sessionId}`);
      return undefined;
    }
    const json = await response.json() as { data?: unknown };
    const data = json.data as Record<string, unknown> | undefined;
    if (!data || typeof data.provider !== 'string' || typeof data.transport !== 'string') {
      return undefined;
    }
    return {
      id: String(data.id ?? sessionId),
      provider: String(data.provider),
      projectPath: String(data.projectPath ?? data.project_path ?? ''),
      agentSessionId: data.agentSessionId != null ? String(data.agentSessionId) : undefined,
      accountId: String(data.accountId ?? data.account_id ?? ''),
      userId: String(data.userId ?? data.user_id ?? ''),
      gatewayId: String(data.gatewayId ?? data.gateway_id ?? ''),
      transport: 'chat' as const
    };
  } catch (err) {
    console.warn('[relay] fetchSessionMetadata error:', String(err));
    return undefined;
  }
}
```

**将 `function handleClientFrame(...): void` 改为 `async function handleClientFrame(...): Promise<void>`**

**找到调用 handleClientFrame 的 socket.on('message', ...) 回调，改为：**

```typescript
socket.on('message', (raw: Buffer) => {
  void (async () => {
    // ... 现有的 JSON.parse 和 frame 校验逻辑 ...
    await handleClientFrame(clientId, frame);
  })();
});
```

注意：如果现有代码已经是 void 包装，只需在 handleClientFrame 调用前加 await。
  </action>
  <verify>
    <automated>grep -n "fetchSessionMetadata" /Users/dream/code/tether/apps/relay/src/relay.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "fetchSessionMetadata" apps/relay/src/relay.ts` 输出 >= 2（函数定义 + 调用处）
    - `grep -n "async function fetchSessionMetadata" apps/relay/src/relay.ts` 有输出
    - `grep -n "async function handleClientFrame" apps/relay/src/relay.ts` 有输出（或等效 async 形式）
    - `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>fetchSessionMetadata helper 已加入 relay.ts，handleClientFrame 已改为 async</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: 改造 case 'client.chat' — 已有 session 分支注入 metadata + 三项校验</name>
  <read_first>
    apps/relay/src/relay.ts
  </read_first>
  <files>apps/relay/src/relay.ts</files>
  <behavior>
    - sessionId === null（新建 chat）分支保持原有 forwardToGateway 逻辑不变
    - sessionId !== null（续聊）分支：先 fetchSessionMetadata，metadata 不存在返回 session_not_found 错误
    - metadata.accountId !== clientScope.accountId 或 metadata.userId !== clientScope.userId 返回 forbidden 错误
    - metadata.transport !== 'chat' 返回 wrong_transport 错误
    - gateways.get(metadata.gatewayId) 为 undefined 时调用 sendGatewayUnavailable
    - 三项校验全通过后，发送帧时包含 session: metadata（TrustedChatSessionMetadata）
    - 发送目标 Gateway 使用 metadata.gatewayId（不再使用 ensureClientGatewayId(clientId)）
  </behavior>
  <action>
将当前 `case 'client.chat':` 分支替换为：

```typescript
case 'client.chat': {
  if (frame.sessionId === null) {
    // 新建 chat：直接转发（Gateway 侧校验 provider/cwd 白名单）
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
  } else {
    // 已有 session 续聊：先从 Server DB 获取可信 metadata（D-03）
    const metadata = await fetchSessionMetadata(frame.sessionId);
    if (!metadata) {
      sendToClient(clientId, {
        type: 'error',
        sessionId: frame.sessionId,
        code: 'session_not_found',
        message: 'session metadata not found in server'
      });
      break;
    }
    // 权限校验（D-13）
    if (metadata.accountId !== clientScope.accountId || metadata.userId !== clientScope.userId) {
      sendToClient(clientId, {
        type: 'error',
        sessionId: frame.sessionId,
        code: 'forbidden',
        message: 'session is outside client scope'
      });
      break;
    }
    // Transport 校验（D-08）
    if (metadata.transport !== 'chat') {
      sendToClient(clientId, {
        type: 'error',
        sessionId: frame.sessionId,
        code: 'wrong_transport',
        message: 'session transport is not chat'
      });
      break;
    }
    // Gateway 在线校验（D-13）
    const targetGateway = gateways.get(metadata.gatewayId);
    if (!targetGateway) {
      sendGatewayUnavailable(clientId, frame.sessionId);
      break;
    }
    // 转发带可信 metadata（D-01）
    sendToSocket<RelayServerToGatewayFrame>(targetGateway.socket, {
      type: 'client.chat',
      clientId,
      sessionId: frame.sessionId,
      message: frame.message,
      model: frame.model,
      session: metadata
    });
  }
  break;
}
```

注意：
- `sendToSocket<RelayServerToGatewayFrame>` 是已有 helper；如不存在直接使用 `targetGateway.socket.send(JSON.stringify(...))`
- 确认 relay.ts 中现有 sendGatewayUnavailable 函数签名，按实际调用
  </action>
  <verify>
    <automated>grep -c "wrong_transport\|forbidden\|session_not_found\|fetchSessionMetadata" /Users/dream/code/tether/apps/relay/src/relay.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "wrong_transport" apps/relay/src/relay.ts` 在 case 'client.chat' 内
    - `grep -n "forbidden" apps/relay/src/relay.ts | grep "client.chat\|sessionId"` 有输出
    - `grep -n "session_not_found" apps/relay/src/relay.ts` 有输出
    - `grep -n "session: metadata" apps/relay/src/relay.ts` 在转发帧中
    - `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>case 'client.chat' 已有 session 分支实现 metadata 查询、三项校验、注入 session 字段转发</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: 新增 case 'gateway.chat-session-created' + 激活 relay 测试 T1/T2/A7</name>
  <read_first>
    apps/relay/src/relay.ts
    apps/relay/test/relay.test.ts
  </read_first>
  <files>
    apps/relay/src/relay.ts
    apps/relay/test/relay.test.ts
  </files>
  <behavior>
    - handleGatewayFrame 中新增 case 'gateway.chat-session-created'
    - 处理顺序（D-04、D-10）：await syncToServer upsert → 成功时更新 latestSessions + broadcastSessionList + 通知 Web → 失败时通知 Client 失败
    - syncToServer 失败（返回 false 或 throw）时发送 error { code: 'session_sync_failed' } 给 clientId
    - T1/T2/A7 测试桩从 skip 改为完整实现
  </behavior>
  <action>
**relay.ts — 找到 handleGatewayFrame 函数，新增 case：**

首先读取 handleGatewayFrame 中现有 gateway.session-created 的处理方式（参考模式），然后新增：

```typescript
case 'gateway.chat-session-created': {
  const { clientId, session } = frame;
  // D-10: await，失败时明确通知 Client
  let synced = false;
  try {
    const response = await fetch(
      `${options.serverSyncUrl}/api/relay/runtime-sync/gateway/sessions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tether-runtime-sync-secret': options.runtimeSyncSecret ?? ''
        },
        body: JSON.stringify({
          scope: { accountId: gatewayScope.accountId, gatewayId: gatewayScope.gatewayId },
          sessions: [{
            id: session.id,
            provider: session.provider,
            projectPath: session.projectPath,
            agentSessionId: session.agentSessionId,
            gatewayId: session.gatewayId,
            userId: session.userId,
            transport: 'chat',
            status: 'running',
            title: ''
          }]
        }),
        signal: AbortSignal.timeout(3000)
      }
    );
    synced = response.ok;
    if (!response.ok) {
      console.warn(`[relay] gateway.chat-session-created sync failed: HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn('[relay] gateway.chat-session-created sync error:', String(err));
  }

  if (!synced) {
    sendToClient(clientId, {
      type: 'error',
      sessionId: session.id,
      code: 'session_sync_failed',
      message: 'failed to sync chat session to server'
    });
    break;
  }

  // D-04: Server ack 成功后更新内存 + 广播 + 通知 Web
  latestSessions.set(session.id, {
    id: session.id,
    provider: session.provider,
    title: '',
    projectPath: session.projectPath,
    accountId: session.accountId,
    gatewayId: session.gatewayId,
    userId: session.userId,
    agentSessionId: session.agentSessionId,
    status: 'running',
    transport: 'chat',
    lastActiveAt: Date.now()
  });
  broadcastSessionList();
  sendToClient(clientId, { type: 'gateway.session-created', sessionId: session.id });
  break;
}
```

注意：
- 读取 relay.ts 确认 gatewayScope 变量在 handleGatewayFrame 中的实际名称（可能是 `scope` 或 `gatewayState.scope`）
- broadcastSessionList 是已有函数；sendToClient 是已有函数
- 如果 options.serverSyncUrl 未配置则直接通知 Client session-created（降级处理，非生产路径）

**relay.test.ts — 将 T1/T2/A7 三个 skip 测试改为完整实现：**

T1 测试要点：
- 创建 Relay（需要 createRelay 支持 serverSyncUrl/runtimeSyncSecret，或 mock fetchSessionMetadata）
- 在 latestSessions 中预存一个 chat session（transport='chat'，或 mock Server 返回）
- 发送 `{ type: 'client.chat', sessionId: 'tth_xxx', message: 'hi' }`
- 断言 Gateway 收到的帧包含 `session.provider`、`session.transport === 'chat'`

T2 测试要点（CLAUDE.md R4 多租户隔离测试模板）：
- 两个 Gateway 连接（B 先连）
- A 账号 Client 发续聊 B 账号 sessionId（mock Server 返回 accountId: 'account-B'）
- 断言 A 的 Client 收到 `{ type: 'error', code: 'forbidden' }`
- 断言 B 的 Gateway 没有收到任何 client.chat 帧

A7 测试要点：
- Server 返回 transport='pty-event-stream' 的 session
- 断言 Client 收到 `{ type: 'error', code: 'wrong_transport' }`

如果 relay.test.ts 中 createRelay helper 不支持 mock Server，可通过 latestSessions 预置数据（relay 暴露的 latestSessions 内存）或在 relay 选项中传入 mock syncServer。

优先使用以下方式测试（参考现有 relay.test.ts 的 createRelay 实现）：
- 如果现有 createRelay 接受 serverSyncUrl 参数，启动一个 minimal http.Server 返回 mock 响应
- 否则，直接测试 Relay 在 latestSessions 有数据时的转发行为（不经过 Server HTTP，测试权限逻辑）

读取 relay.test.ts 中 createRelay 的实际实现后再决定具体测试策略。
  </action>
  <verify>
    <automated>grep -n "gateway.chat-session-created" /Users/dream/code/tether/apps/relay/src/relay.ts && pnpm --filter @tether/relay test 2>&1 | grep -E "Phase15|passing|failing|skip" | head -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "case 'gateway.chat-session-created'" apps/relay/src/relay.ts` 有输出
    - `grep -n "session_sync_failed" apps/relay/src/relay.ts` 有输出（失败路径）
    - `grep -n "broadcastSessionList" apps/relay/src/relay.ts | grep -v "^.*\/\/"` 在 gateway.chat-session-created 处理中
    - Phase15-T1、Phase15-T2、Phase15-A7 三个测试从 skip 变为 passing
    - `pnpm --filter @tether/relay test` 全绿
    - `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` 无错误
  </acceptance_criteria>
  <done>gateway.chat-session-created 处理完整，T1/T2/A7 测试绿色通过，relay.ts typecheck 无错误</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Web → Relay client.chat | Relay 不信任 Web 携带的任何 metadata，只使用 Server DB 的可信数据 |
| Relay → Gateway client.chat | session 字段由 Relay 注入，Gateway 可信任 |
| Relay → Server gateway.chat-session-created | 使用 runtimeSyncSecret 内部 channel，非公开 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-15-P03-01 | Tampering | client.chat sessionId !== null | mitigate | Relay 从 Server DB 获取 metadata，不信任 Web 任何字段；Web 帧无 metadata 字段 |
| T-15-P03-02 | Elevation of Privilege | 跨账号 session 续聊 | mitigate | D-13：metadata.accountId !== clientScope.accountId 时返回 forbidden；T2 隔离测试覆盖（CLAUDE.md R4） |
| T-15-P03-03 | Tampering | PTY session 误发 client.chat | mitigate | D-08：metadata.transport !== 'chat' 返回 wrong_transport；A7 测试覆盖 |
| T-15-P03-04 | Information Disclosure | latestSessions 内存缓存丢失 | mitigate | D-03：已有 session 续聊不使用 latestSessions，始终从 Server DB 查询 |
</threat_model>

<verification>
```bash
# 验证关键实现点
grep -n "fetchSessionMetadata\|wrong_transport\|forbidden\|session_not_found" apps/relay/src/relay.ts
grep -n "gateway.chat-session-created" apps/relay/src/relay.ts

# Relay 测试
pnpm --filter @tether/relay test

# Relay typecheck
pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit
```
</verification>

<success_criteria>
- fetchSessionMetadata helper 实现完整
- case 'client.chat' 续聊分支：metadata 查询 → 三项校验 → 注入 session 转发
- case 'gateway.chat-session-created'：await syncToServer → 成功后通知 Web
- T1/T2/A7 三个测试绿色通过
- relay.ts typecheck 无错误
</success_criteria>

<output>
完成后创建 `.planning/phases/15-chat-remote-session-metadata/15-P03-SUMMARY.md`
</output>
