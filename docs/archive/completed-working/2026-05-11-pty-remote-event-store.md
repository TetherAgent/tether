# PTY 远端 Event Store 方向

本文只记录 PTY / Terminal 链路未来迁远端的阶段边界。它不是当前 `chats` 去本地 DB 方案的一部分。

## 结论

PTY 可以逐步迁到远端历史事实源，但不能和 chat 去本地 DB 混在同一个阶段做。

Chat 迁远端处理的是：

```text
结构化消息 + session metadata
```

PTY 迁远端处理的是：

```text
高频 terminal event stream + replay cursor + resize/input/control 状态
```

两者风险等级不同。当前阶段只处理 chat。

## 边界

```text
┌──────────────────────────────┬──────────────────────────────┐
│ 当前 Chat 去本地 DB           │ 后续 PTY 去本地 DB            │
├──────────────────────────────┼──────────────────────────────┤
│ client.chat                   │ client.input / resize / stop  │
│ transport = chat              │ transport = pty-event-stream  │
│ 结构化 user/assistant 消息     │ terminal.output append-only    │
│ Server DB 作为历史事实源       │ Server DB 先做远端回放事实源   │
│ Gateway 不需要本地 chat session│ Gateway 仍持有真实 PTY runner  │
└──────────────────────────────┴──────────────────────────────┘
```

## 初步路线

```text
┌──────┬──────────────────────────────┬──────────────────────────────┐
│ 阶段 │ 目标                         │ 说明                         │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ 1    │ Chat 完全远端化               │ 先完成 chat 去本地 DB         │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ 2    │ PTY 远端只读回放              │ terminal.output 同步到 Server │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ 3    │ PTY cursor/replay 远端化       │ Web 刷新从 Server DB 回放     │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ 4    │ PTY 控制面远端化              │ input/resize/stop 仍经 Relay  │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ 5    │ 本地 PTY DB 降级为 outbox/cache│ Gateway 本地只做短期缓冲      │
└──────┴──────────────────────────────┴──────────────────────────────┘
```

## 关键原则

- Server 可以成为 PTY 历史事实源。
- Gateway 仍是 PTY 执行事实源。
- Server 不能替 Gateway 判断本机 runner 是否还活着。
- Server 不能直接执行 input / resize / stop。
- PTY 的本地 DB 迁移必须单独设计 replay cursor、事件顺序、断线补偿、数据量和脱敏策略。
- 当前 chat 去本地 DB 阶段不得改动 PTY 的 `sessions`、`session_events`、runner metadata 和 replay 逻辑。

## 后续需要单独展开的问题

```text
┌──────┬──────────────────────────────┬──────────────────────────────┐
│ 编号 │ 问题                         │ 说明                         │
├──────┼──────────────────────────────┼──────────────────────────────┤
│ P1   │ terminal.output 数据量        │ Server 存储、分页、清理策略   │
│ P2   │ replay cursor                 │ Direct / Relay / Server 三方一致│
│ P3   │ 脱敏策略                     │ 输出外发前和入库前如何脱敏   │
│ P4   │ outbox                        │ Relay/Server 断线时本地缓冲   │
│ P5   │ 状态一致性                   │ running/lost/exited 谁来判定  │
│ P6   │ 控制事件审计                 │ user.input/resize/stop 是否入库│
│ P7   │ 保留周期                     │ 长历史裁剪和用户删除          │
└──────┴──────────────────────────────┴──────────────────────────────┘
```
