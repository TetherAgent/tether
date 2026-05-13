# PTY Runner 健康检查与远程状态同步

状态：Working

日期：2026-05-13

## 背景

当前 `tether ls` 可能看到已经停止的 PTY session 仍然显示为 `running`。本地 Gateway 能通过 runner socket 判断 session 已不可达，但远程 Relay / Server 的状态不会在 runner 静默退出时立刻更新。

已确认的现状：

- `sendSessions()` 被触发时会通过 `SessionCatalog.listRelaySessions()` ping running PTY runner。
- ping 不通时会调用 `markSessionLost()`，把本地 session 标成 `lost`。
- `subscription-manager.ts` 和 `pty-handler.ts` 的订阅、resize、input、stop 失败路径已经调用 `markSessionLost()`。
- 目前没有后台低频 health check 定期扫描 running PTY runner。
- `spawnSessionRunnerProcess()` 使用 detached child process，当前 Gateway 只能监听本次创建的新 runner 的 `exit`；Gateway 重启后 restore 的旧 runner 不能靠 child `exit` 事件感知，只能靠 ping runner/socket。

## 目标

让 PTY runner 断开、退出、socket 消失或进程被 kill 后，Gateway 能在较短时间内把状态同步到 Relay / Server，避免远程列表长期显示假 `running`。

非目标：

- 不改 Relay / Server 协议。
- 不引入 ACK 协议。
- 不让 Relay 主动探测本机 runner。
- 不在没有 PTY session 时常驻无意义扫描。

## 设计定案

采用 Gateway 本地发现、本地标记、主动同步的方案：

1. `markSessionLost()` 真正把 running session 改成 `lost` 后，触发 `onSessionsChanged()`。
2. Relay client 把 `onSessionsChanged()` 接到 `sendSessions()`。
3. Relay client 内部维护低频 `ptyHealthTimer`。
4. 只有存在 running PTY session 时启动 health check。
5. 全部 PTY session 都不再是 running 后停止 health check。
6. 新建 runner 进程退出时，Gateway 尽快更新 session 状态并触发同步。
7. `completed` / `failed` 等 PTY 终态也要通过 `gateway.sessions` 上报一次，避免 Relay 缓存继续保留旧 `running`。

health check 频率建议先用 30 秒。这个频率足够让 UI 和远程状态及时收敛，同时不会明显增加本机资源消耗。

## 递归防护机制

`onSessionsChanged()` 会调用 `sendSessions()`，而 `sendSessions()` 会调用 `SessionCatalog.listRelaySessions()`。当 `listRelaySessions()` ping 到 dead runner 时，会再次调用 `markSessionLost()`。

这条链路的递归防护依赖 `markSessionLost()` 的幂等性截断：

```ts
if (session?.status !== 'running') {
  return;
}
```

第一次 `sendSessions()` 如果发现 N 个 running PTY session 已死亡，会触发 N 次 `onSessionsChanged()`，也就是最多产生 N 次额外 `sendSessions()`。这些额外同步再次进入 `markSessionLost()` 时，对应 session 已经不是 `running`，会被幂等保护截断，不会无限递归。

本设计接受一次扫描中最多 N+1 次同步调用，不额外引入 debounce。这样做的理由是逻辑更直接，且 dead runner 数量通常很小；如果未来出现大量 session 批量死亡，再单独评估批量同步优化。

## Health Check 定时策略

health check 使用链式 `setTimeout`，不使用 `setInterval`。

原因：

- `sendSessions()` 是 async。
- `setInterval` 可能在上一次 `sendSessions()` 未完成时启动下一次扫描，造成并发 ping 和并发同步。
- 链式 `setTimeout` 可以保证上一次扫描完成后，再等待 30 秒安排下一次扫描。

推荐结构：

```ts
const schedulePtyHealthCheck = () => {
  ptyHealthTimer = setTimeout(async () => {
    ptyHealthTimer = undefined;
    if (connectionState !== 'connected') {
      ensurePtyHealthCheck();
      return;
    }
    await sendSessions();
    ensurePtyHealthCheck();
  }, PTY_HEALTH_CHECK_INTERVAL_MS);
  ptyHealthTimer.unref();
};
```

实际实现时需要避免重复 schedule：已有 timer 时不再创建新的 timer；没有 running PTY session 时清掉 timer。`sendSessions()` 完成后需要重新调用 `ensurePtyHealthCheck()`，让下一次 timeout 在本轮扫描结束后再开始计时。

## TODO

- [x] `apps/gateway/src/relay/session-catalog.ts`
  - [x] 新增 `onSessionsChanged?: () => void` option。
  - [x] `markSessionLost()` 只有在 session 当前为 `running` 时才更新为 `lost`。
  - [x] `markSessionLost()` 成功更新后调用 `onSessionsChanged()`。
  - [x] 保持幂等：重复调用 `markSessionLost()` 不重复触发同步。
  - [x] PTY 终态 session 会进入同步列表，用于清理 Relay 侧旧 running 缓存。

- [x] `apps/gateway/src/relay-client.ts`
  - [x] 创建 `SessionCatalog` 时传入 `onSessionsChanged: () => { void sendSessions(); }`。
  - [x] 明确递归防护依赖 `markSessionLost()` 的幂等性截断。
  - [x] 接受一次扫描中 N 个 dead runner 造成最多 N+1 次 `sendSessions()`，暂不加 debounce。

- [x] `apps/gateway/src/relay-client.ts`
  - [x] 增加 `ptyHealthTimer`。
  - [x] 增加 `ensurePtyHealthCheck()`。
  - [x] 增加 `stopPtyHealthCheck()`。
  - [x] 使用链式 `setTimeout`，不要使用 `setInterval`。
  - [x] health check tick 时只在 Relay 连接状态下调用 `sendSessions()`。
  - [x] 上一次 `sendSessions()` 完成后，再安排下一次 timeout。

- [x] `apps/gateway/src/relay-client.ts`
  - [x] `sendSessions()` 完成后判断是否还有 running PTY session。
  - [x] 有 running PTY session 时启动 health check。
  - [x] 没有 running PTY session 时停止 health check。
  - [x] `RunningRelayClient.close()` 时清理 `ptyHealthTimer`。

- [x] `apps/gateway/src/pty/session-runner-spawn.ts`
  - [x] 给 `spawnSessionRunnerProcess()` 增加可选 `onExit` 回调。
  - [x] 回调参数包含 `sessionId`、`exitCode`、`signal`。
  - [x] 只覆盖本次 Gateway 创建的新 runner，不假设能监听 restore 回来的旧 runner。

- [x] `apps/gateway/src/daemon.ts`
  - [x] 调用 `spawnSessionRunnerProcess({ ..., onExit })`。
  - [x] `onExit` 中根据 exit code 更新 session 状态：`0 -> completed`，非 0 -> `failed`，signal 或无法确认 -> `lost`。
  - [x] 状态更新路径可以直接调用 `ptySessions.updateSessionStatus(sessionId, nextStatus)`。
  - [x] 状态更新后触发 Relay 同步。
  - [x] 如果当前状态映射无法可靠区分，先统一标 `lost`，后续再细化。

## 验收项目

### 自动化验收

- [x] `pnpm --filter @tether/gateway typecheck` 通过。
- [x] `node --import tsx --test apps/gateway/test/relay-client.test.ts` 通过。
- [x] 增加或更新测试：恢复来的 PTY session 如果 runner 不可达，会被标记为 `lost`，且元数据不丢。
- [x] 增加或更新测试：`markSessionLost()` 只在状态从 `running` 变为 `lost` 时触发一次 `onSessionsChanged()`。
- [x] 增加或更新测试：一次扫描中 N 个 dead runner 最多产生 N+1 次 `sendSessions()`，且不会无限递归。
- [x] 增加或更新测试：有 running PTY 时启动 health check，没有 running PTY 时停止 health check。
- [x] 增加或更新测试：health check 使用链式 timeout，不会并发执行 `sendSessions()`。
- [x] 增加或更新测试：`RunningRelayClient.close()` 会清理 health check timer。
- [x] 增加或更新测试：新建 runner child exit 后触发状态更新。
- [x] 增加或更新测试：PTY `completed` 终态会同步给 Relay，避免旧 running 缓存残留。

### 人工 UAT

- [ ] 启动 Gateway。
- [ ] 执行 `pnpm tether run codex` 创建 PTY session。
- [ ] 执行 `pnpm tether ls`，确认该 PTY session 显示 `running`。
- [ ] 手动 kill 对应 runner 或删除/断开 runner socket。
- [ ] 30 秒内再次执行 `pnpm tether ls`。
- [ ] 确认该 PTY session 不再显示为 `running`，应显示 `lost` 或从 running 列表中消失。
- [ ] 全部 PTY session 停止后，确认 health check 不再空转。
- [ ] 再次创建新 PTY session，确认 health check 会重新启动并能继续同步状态。

## 风险与边界

- health check 只负责 PTY runner，不处理 chat session。
- Relay 连接断开时不应反复尝试同步；等 Relay 重连后由现有 `onAuthOk -> sendSessions()` 收敛。
- `child.once('exit')` 只能覆盖当前 Gateway 进程创建的新 runner。
- restore 回来的旧 session 必须通过 ping runner/socket 识别存活状态。
- `sendSessions()` 内部会触发 `listRelaySessions()`，而 `listRelaySessions()` 可能调用 `markSessionLost()`；因此 `markSessionLost()` 必须保持幂等，避免重复同步。
