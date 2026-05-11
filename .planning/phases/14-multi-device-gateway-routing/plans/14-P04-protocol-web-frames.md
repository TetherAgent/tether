---
phase: 14-multi-device-gateway-routing
plan: 04
type: execute
wave: 3
depends_on: [14-P02]
files_modified:
  - packages/protocol/src/index.ts
  - apps/web/src/components/chats/chat-panel.tsx
autonomous: true
requirements: [GATEWAY-MULTI-04]
must_haves:
  truths:
    - "client.chat（sessionId: null）、client.list-providers、client.cwd-suggest 帧类型包含 gatewayId: string"
    - "client.chat（sessionId: string）续聊变体不含 gatewayId（或仅为可选），Phase 15 通过 DB metadata 路由，Web 不需要传"
    - "Web chat-panel 从 selectedGatewayId state 读取 gatewayId 并注入到新建/list-providers/cwd-suggest 三种 sendFrame 调用中"
    - "RelayServerToClientFrame 包含 gateway_required 和 gateway_unauthorized 错误码"
    - "Web 收到 gateway_required 时显示 Gateway 选择器提示"
  artifacts:
    - path: "packages/protocol/src/index.ts"
      provides: "RelayClientToServerFrame 按 H2 规则更新 gatewayId; error 帧加新 code"
    - path: "apps/web/src/components/chats/chat-panel.tsx"
      provides: "selectedGatewayId state + 三处 sendFrame 注入 gatewayId + gateway_required 处理"
  key_links:
    - from: "chat-panel.tsx sendMessage（新建分支）"
      to: "sendFrame({ type: 'client.chat', sessionId: null, ..., gatewayId: selectedGatewayId })"
      via: "selectedGatewayId state（来自 Gateway 选择器，Plan 06 完成前使用 relayGatewayId）"
    - from: "chat-panel.tsx sendMessage（续聊分支）"
      to: "sendFrame({ type: 'client.chat', sessionId: currentSessionId, ... })"
      via: "续聊不带 gatewayId，Relay 通过 Phase 15 的 DB metadata 路由，保持不变"
    - from: "chat-panel.tsx error handler"
      to: "frame.code === 'gateway_required'"
      via: "显示 Gateway 选择器提示（setShowGatewaySelector(true)）"
---

<objective>
更新 Protocol 类型和 Web chat-panel，使新建会话相关帧携带 gatewayId，但续聊帧保持不变（Phase 15 路由）。为新错误码添加 Web 处理。

**H2 修复：** `client.chat sessionId: string`（续聊变体）不得要求 gatewayId。续聊已通过 Phase 15 的 DB metadata.gatewayId 路由，Relay 不从帧中读取 gatewayId。

此 Plan 必须在 Plan 05（Relay 移除 fallback）之前完成，否则移除 fallback 后 Web 无法正常发送请求。

Purpose: 让 Relay 能从帧中读取 gatewayId 进行路由（D-10）；Web 处理 gateway_required 错误（D-11）。
Output: 更新的 protocol 类型 + 注入 gatewayId 的 chat-panel
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md

<interfaces>
<!-- packages/protocol/src/index.ts lines 100-105 — 当前 RelayClientToServerFrame 相关变体 -->
| { type: 'client.chat'; sessionId: null; provider: string; model: string; cwd: string; message: string }
| { type: 'client.chat'; sessionId: string; message: string; model?: string }
| { type: 'client.cwd-suggest'; cwd: string }
| { type: 'client.list-providers' }

<!-- packages/protocol/src/index.ts line 107+ — RelayServerToClientFrame -->
-- 当前 error 帧: { type: 'error'; code: string; message: string; sessionId?: string }
-- 需要 gateway_required 和 gateway_unauthorized 作为 code 值

<!-- chat-panel.tsx lines 264-266 — 当前 gateway state -->
const [activeSessionGatewayId, setActiveSessionGatewayId] = React.useState<string | undefined>(undefined);
const [relayGatewayId, setRelayGatewayId] = React.useState<string | undefined>(undefined);
-- relayGatewayId 在 hello/gateway.status 帧时更新（lines 518-530）

<!-- chat-panel.tsx line 514 — list-providers 无 gatewayId -->
relay.sendFrame({ type: 'client.list-providers' });

<!-- chat-panel.tsx lines 855-858 — cwd-suggest 无 gatewayId -->
sendFrame({ type: 'client.cwd-suggest', cwd });

<!-- chat-panel.tsx lines 893-906 — sendMessage 两种 client.chat 无 gatewayId -->
sendFrame({ type: 'client.chat', sessionId: currentSessionId, message: text, model: messageModel });
sendFrame({ type: 'client.chat', sessionId: null, provider, model, cwd, message: text });

<!-- chat-panel.tsx lines 792-811 — error handler，当前处理 gateway_unavailable/forbidden/wrong_ticket_scope -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 更新 Protocol 类型</name>
  <files>packages/protocol/src/index.ts</files>
  <action>
    **修改 RelayClientToServerFrame（lines 100-104）：**

    按 H2 修复规则，只有以下三种变体需要加 `gatewayId: string`（必填）：
    - `client.chat` 的 `sessionId: null` 变体（新建会话）
    - `client.list-providers`
    - `client.cwd-suggest`

    `client.chat` 的 `sessionId: string` 变体（续聊）**保持不变或最多加可选字段**。
    Phase 15 的 Relay 续聊分支已通过 DB metadata.gatewayId 路由，不使用帧中的 gatewayId。

    ```typescript
    | { type: 'client.chat'; sessionId: null; provider: string; model: string; cwd: string; message: string; gatewayId: string }
    | { type: 'client.chat'; sessionId: string; message: string; model?: string }
    | { type: 'client.cwd-suggest'; cwd: string; gatewayId: string }
    | { type: 'client.list-providers'; gatewayId: string }
    ```

    注意：`client.switch-model`、`client.subscribe`、`client.input`、`client.stop` 等帧类型不加 gatewayId（这些帧已通过 sessionId 路由，不需要 gatewayId）。

    **RelayServerToClientFrame 中 error 帧 code 扩展（line 107+ 附近的 error 变体）：**
    若当前 error 帧类型为 `{ type: 'error'; code: string; ... }`（code 为 string），无需改动类型——code 已是字符串，可接受任意值。
    若 code 为字符串联合类型，在联合中添加 `'gateway_required'` 和 `'gateway_unauthorized'`。
    （保持与现有 error 帧类型定义一致，不新引入类型复杂度）
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/protocol typecheck
    # 确认 relay.ts 和 gateway chat-session-runner 等消费方有无类型报错
    pnpm --filter @tether/relay typecheck
    pnpm --filter @tether/gateway typecheck
    ```
  </verify>
  <done>
    - client.chat（sessionId: null 变体）含 gatewayId: string
    - client.chat（sessionId: string 续聊变体）不含 gatewayId（保持原样）
    - client.cwd-suggest、client.list-providers 均含 gatewayId: string
    - protocol typecheck 通过
    - relay 和 gateway typecheck 通过
  </done>
</task>

<task type="auto">
  <name>Task 2: Web chat-panel — selectedGatewayId state + sendFrame 注入 + error 处理</name>
  <files>apps/web/src/components/chats/chat-panel.tsx</files>
  <action>
    **1. 新增 selectedGatewayId state（在 relayGatewayId state 声明附近，约 line 266）：**
    ```typescript
    // selectedGatewayId: 用户手动选择的 Gateway（Plan 06 的选择器会更新此值）
    // 在 Plan 06 前，用 relayGatewayId 作为初始值
    const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
    const [showGatewaySelector, setShowGatewaySelector] = React.useState(false);
    ```

    **2. 在 hello/gateway.status 帧处理时初始化 selectedGatewayId（line 518-530 附近）：**
    - `hello` 帧：若 selectedGatewayId 为 undefined 且 gatewayId 存在，则 setSelectedGatewayId(gatewayId)
    - `gateway.status` connected 帧：若 selectedGatewayId 为 undefined，则 setSelectedGatewayId(frame.gatewayId)
    （这是 Plan 06 Gateway 选择器未上线前的临时逻辑，确保单 Gateway 场景正常工作）

    **3. 在 client.auth.ok 帧处理时（line 511-515）：**
    修改 client.list-providers 发送，加入 gatewayId（若 selectedGatewayId 存在才发送）：
    ```typescript
    if (frame.type === 'client.auth.ok') {
      hasEverConnectedRef.current = true;
      setConnectionError(undefined);
      // list-providers 在 gateway.status 帧到达后再发（此时才有 selectedGatewayId）
      return;
    }
    ```
    在 gateway.status connected 帧处理（line 527-531），改为：
    ```typescript
    if (frame.status === 'connected') {
      setGatewayReady(true);
      const gId = frame.gatewayId;
      setRelayGatewayId(gId);
      if (!selectedGatewayId) setSelectedGatewayId(gId);
      setConnectionError((current) => current === t.gatewayNotConnected ? undefined : current);
      relay.sendFrame({ type: 'client.list-providers', gatewayId: gId });
      return;
    }
    ```

    **4. 修改 sendMessage 中两处 sendFrame（约 lines 893-906）：**

    续聊分支（sessionId 为 string）**保持不变**，不加 gatewayId：
    ```typescript
    if (currentSessionId) {
      // 续聊：Phase 15 通过 DB metadata.gatewayId 路由，帧不需要 gatewayId
      sendFrame({ type: 'client.chat', sessionId: currentSessionId, message: text, model: messageModel });
      return;
    }
    ```

    新建分支（sessionId: null）加入 gatewayId：
    ```typescript
    sendFrame({
      type: 'client.chat',
      sessionId: null,
      provider: selectedProvider,
      model: selectedModel,
      cwd,
      message: text,
      gatewayId: selectedGatewayId ?? ''
    });
    ```

    **5. 修改 cwd-suggest sendFrame（约 line 857）：**
    ```typescript
    sendFrame({ type: 'client.cwd-suggest', cwd, gatewayId: selectedGatewayId ?? '' });
    ```

    **6. 在 error 帧处理（约 line 792-811）加入 gateway_required 和 gateway_unauthorized：**
    ```typescript
    if (frame.code === 'gateway_required') {
      setShowGatewaySelector(true);
      setConnectionError('请先选择 Gateway');
      setIsInflight(false);
      currentAgentIdRef.current = null;
      return;
    }
    if (frame.code === 'gateway_unauthorized') {
      setConnectionError('Gateway 不属于当前账号');
      setIsInflight(false);
      currentAgentIdRef.current = null;
      return;
    }
    ```

    **7. showGatewaySelector 的展示**：
    在现有 connectionError 展示区域（搜索 `connectionError &&`），在其上方添加：
    ```tsx
    {showGatewaySelector && !selectedGatewayId && (
      <div className="text-sm text-foreground-tertiary px-4 py-2 border-b border-input">
        请选择 Gateway 后再发送消息
      </div>
    )}
    ```
    这是 Plan 06 Gateway 选择器的占位提示，Plan 06 完成后会替换为完整组件。

    **不需要添加 i18n key**（"请选择 Gateway" 是临时占位文本，Plan 06 会重写这部分 UI）。
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/web typecheck
    pnpm --filter @tether/web build
    ```
  </verify>
  <done>
    - selectedGatewayId state 存在
    - client.auth.ok 不再发送无 gatewayId 的 list-providers
    - gateway.status connected 帧发送含 gatewayId 的 list-providers
    - sendMessage 新建分支（sessionId: null）含 gatewayId；续聊分支不含 gatewayId（H2 修复）
    - client.cwd-suggest 含 gatewayId
    - gateway_required / gateway_unauthorized error 帧有处理逻辑
    - typecheck 和 build 通过
  </done>
</task>

</tasks>

<verification>
```bash
pnpm --filter @tether/protocol typecheck
pnpm --filter @tether/web typecheck
pnpm --filter @tether/web build
pnpm --filter @tether/relay typecheck
pnpm --filter @tether/gateway typecheck
```
</verification>

<success_criteria>
- Protocol 中 client.chat（sessionId: null 变体）、client.cwd-suggest、client.list-providers 均含 gatewayId: string
- Protocol 中 client.chat（sessionId: string 续聊变体）不含 gatewayId（H2 修复：保留 Phase 15 路由语义）
- chat-panel.tsx 新建分支、list-providers、cwd-suggest 的 sendFrame 调用均注入 selectedGatewayId
- chat-panel.tsx 续聊分支 sendFrame 保持不变（无 gatewayId）
- gateway_required 错误码有明确的 UI 处理（显示选择 Gateway 提示）
- 全部 typecheck 通过，build 无报错
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-04-SUMMARY.md`，记录：
- Protocol 类型变更（三种帧 + gatewayId；续聊变体保持不变）
- selectedGatewayId state 的初始化逻辑
- gateway_required 处理位置
- 续聊分支保持不变的说明（Phase 15 路由语义）
</output>
