# PTY Session 单控制端锁方案

状态：Working

## 背景

`tether run shell` 创建 PTY session 后会自动在本机 Terminal attach，模式是 `control`
（`apps/cli/src/commands/run.ts`）。同时，Web 端用户也可以对同一个 session 发起
`client.subscribe(mode: 'control')`。

Relay 没有跨 client 的 control 数量限制：每个 WebSocket 连接维护自己的
`subscriptions = new Map<string, RelayClientMode>()`，`client.subscribe` 时只
`subscriptions.set(sessionId, mode)`，不检查其他连接是否已经持有同一 session 的
control 权（`apps/relay/src/relay.ts:964`）。

结果：Web 和本机 Terminal 同时处于 control 状态，两路 `client.input` 都被转发到
同一个 PTY，字符在 shell 输入缓冲区里合并，出现输入叠字（`ls` 变成 `lls`）或乱序。

## 根因

| 层 | 当前代码 | 现状 |
|---|---|---|
| Relay `client.subscribe` | `relay.ts:964` `subscriptions.set(frame.sessionId, frame.mode)` | 只写当前 client 自己的 Map，不检查其他 client 是否已 control |
| Relay `client.input` | `relay.ts:993` | 只检查当前 client 的 `subscriptions.get(sessionId) === 'control'`，两端都能通过 |
| Gateway `pty-handler.ts:38` | `requireControlSession()` | 只检查 Gateway 侧订阅 Map，同上，不感知多端 control |
| Chat 路径 | `client.chat` 不经过 subscriptions 判断，走独立 `chatSessionSubscribers` | 不受影响 |

PTY 和 Chat 共用 `client.subscribe` 入口（都会写 `subscriptions.set(...)`），但
owner 锁只在 `session.transport === 'pty-event-stream' && mode === 'control'` 时
启用，chat session 的 subscribe 不进入这条分支，不受影响。

## 设计方案

在 Relay 增加全局 `ptyControlOwner: Map<string, string>`（sessionId → clientId），
记录每个 PTY session 当前的 control 持有者。新端请求 control 时，自动转移所有权并通知
旧持有者降级为 observe。

### 数据结构

```typescript
// relay.ts 第 180 行附近，与 latestSessions、gateways 同级
const ptyControlOwner = new Map<string, string>(); // sessionId → clientId
```

### 改动 1：`client.subscribe` 转移所有权

在 `relay.ts:964` `subscriptions.set(frame.sessionId, frame.mode)` 之后插入：

```typescript
if (session.transport === 'pty-event-stream' && frame.mode === 'control') {
  const prevOwner = ptyControlOwner.get(frame.sessionId);
  if (prevOwner && prevOwner !== clientId) {
    // 降级旧 owner 的本地 subscriptions，后续 input 被现有 observe_only 检查拦截
    clients.get(prevOwner)?.subscriptions.set(frame.sessionId, 'observe');
    // 通知旧 owner，前端可以据此更新 UI 提示（"控制权已被接管"）
    sendToClient(prevOwner, {
      type: 'error',
      sessionId: frame.sessionId,
      code: 'control_revoked',
      message: 'another client took control of this session'
    });
  }
  ptyControlOwner.set(frame.sessionId, clientId);
}
```

旧 owner 的 `subscriptions` 被改为 `'observe'` 后，其后续 `client.input` 会被
`relay.ts:993` 的现有检查以 `observe_only` 拒绝，**`client.input` / `client.resize` /
`client.stop` 无需额外改动**。

### 改动 2：client 断开时清理

在 `relay.ts` 第 892 行 cleanup 块（`chatSessionSubscribers` 清理之后）加：

```typescript
for (const [sessionId, owner] of ptyControlOwner) {
  if (owner === clientId) ptyControlOwner.delete(sessionId);
}
```

### 改动 3：`client.unsubscribe` 时清理

在 `relay.ts:1196` `client.unsubscribe` handler 中加：

```typescript
if (ptyControlOwner.get(frame.sessionId) === clientId) {
  ptyControlOwner.delete(frame.sessionId);
}
```

### 改动 4：`client.detach` 时清理

CLI 的 Ctrl-A 发的是 `client.detach` 而不是 `client.unsubscribe`。在
`client.detach` handler 中同样加：

```typescript
if (ptyControlOwner.get(frame.sessionId) === clientId) {
  ptyControlOwner.delete(frame.sessionId);
}
```

漏掉这里会导致 CLI detach 后 owner 残留，下一个 control subscribe 无法正确接管。

### 改动 5：owner 重新以 `observe` subscribe 时释放

当前 control owner 对同一 PTY session 重新发 `client.subscribe(mode: 'observe')` 时，
`subscriptions` 会变成 `'observe'`，输入会被 `observe_only` 拦住，但 `ptyControlOwner`
仍然指向它，导致 map 不一致、下一个 control subscribe 的接管逻辑判断错误。

在 `client.subscribe` 处理中，`mode === 'control'` 的 if 块之前加：

```typescript
if (
  session.transport === 'pty-event-stream' &&
  frame.mode === 'observe' &&
  ptyControlOwner.get(frame.sessionId) === clientId
) {
  ptyControlOwner.delete(frame.sessionId);
}
```

### 改动 6：Gateway 断线时清理

`dropSessionsForGateway(gatewayId)` 删除 session 时同步清理 `ptyControlOwner`。
在删除 `latestSessions` 的循环里加：

```typescript
ptyControlOwner.delete(sessionId);
```

Gateway 断线或 `gateway.sessions` 刷新导致 session 从 `latestSessions` 移除时，
如果不同步清理，owner map 会残留 stale 条目，影响后续同 sessionId 的控制权判断。

## 不需要改的地方

| 位置 | 原因 |
|---|---|
| Gateway `pty-handler.ts` / `subscription-manager.ts` | Relay 已拦截多余 input，Gateway 天然收到单路 |
| Protocol types (`packages/protocol`) | `error` frame 已有 `code` 字段，新增 `control_revoked` code 不需要新 frame 类型 |
| Chat 路径 | owner 锁仅在 `pty-event-stream + control` 分支触发，chat subscribe 不受影响 |
| `client.input` / `client.resize` / `client.stop` | 旧 owner 被降级为 observe 后，现有 `observe_only` 检查天然拦截 |

## 行为变化

| 场景 | 改前 | 改后 |
|---|---|---|
| Web 和本机 Terminal 同时 control 同一 PTY | 两路 input 合并进同一 shell，出现叠字 | 后 subscribe 的一端获得控制，前一端收到 `control_revoked` 并变为 observe-only |
| 新端主动以 `observe` subscribe | 只读订阅，不产生输入冲突 | 正常，只读，不影响控制权 |
| 控制端断开连接 | `ptyControlOwner` 不存在，下次 subscribe 正常取得 control | 同 |
| Chat session subscribe / input | 不走此路径 | 不变 |

## 客户端响应

**Web 端（可选，可独立迭代）：**

收到 `control_revoked` error frame 后，可以：
- 把 terminal 输入框置为 disabled，显示"控制权已转移到另一个终端"；
- 提供"重新接管"按钮，点击后重新发 `client.subscribe(mode: 'control')`。

**CLI 端（UX 债务，需记录）：**

`apps/cli/src/attach/pty-attach.ts` 目前只特殊处理 `session_lost`，普通 error
frame（包括 `control_revoked` / `observe_only`）不会明显提示用户。即使 Relay
已经阻止重复输入，旧 Terminal 端会表现成"打字没反应"，用户无法感知原因。

本方案 Relay 层改动后，建议后续把 `control_revoked` 打到 stderr，说明控制权
已被接管。这属于后续 UX 债务，不阻塞本方案合并，但需要作为跟进项显式记录。

## 改动范围

**首批必改：**

```
apps/relay/src/relay.ts
```

**后续 UX（不阻塞合并，作为跟进项）：**

```
apps/cli/src/attach/pty-attach.ts   ← control_revoked 打到 stderr
apps/web/...                         ← terminal UI 可选提示与重新接管按钮
```

影响测试：`apps/relay/test/relay.test.ts` 需补充多端 control 隔离用例（见验收项）。

## 验收项

- [ ] Web 和本机 Terminal 同时对同一 PTY session 发 `client.subscribe(mode: 'control')`，后者收到 `subscription.ack`，前者收到 `control_revoked` error frame
- [ ] 收到 `control_revoked` 的 client 后续发 `client.input` 返回 `observe_only` 错误
- [ ] 新 control owner 正常输入，PTY 只收到单路字符，不叠字
- [ ] 控制端断开后，下一个 subscribe 的 client 可以正常取得 control
- [ ] chat session 的 subscribe / input / chat 行为不受影响
- [ ] `relay.test.ts` 新增：两个 client 先后 control 同一 PTY session，验证旧 owner 降级为 observe、新 owner 可输入
- [ ] `client.detach` 后 owner 被释放，下一个 control subscribe 能正常接管
- [ ] Gateway 断开或 session 从 `gateway.sessions` 消失后，`ptyControlOwner` 对应条目被清理，不影响后续同 sessionId 的控制权
