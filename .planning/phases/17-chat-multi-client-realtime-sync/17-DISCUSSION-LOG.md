# Phase 17: Chat Multi-client Realtime Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 17-chat-multi-client-realtime-sync
**Areas discussed:** Relay 订阅者索引, chatClientBindings 职责, in-flight 锁位置

---

## Relay 订阅者索引

| 选项 | 描述 | 选择 |
|------|------|------|
| 专用反向索引 | `chatSessionSubscribers: Map<string, Set<string>>`，O(1) 查找所有订阅者 | ✓ |
| 遍历 clients map | 保留 chatSessionOwners，广播时 O(n) 过滤 clients | |

**User's choice:** 专用反向索引 `chatSessionSubscribers`

**跟进问题 — 清理策略：**

| 选项 | 描述 | 选择 |
|------|------|------|
| Set.delete + 空时删 key | 防止内存泄漏，逻辑清晰 | ✓ |
| Set.delete，不删 key | 简单，但积累空 Set | |

**跟进问题 — catch-up 行为：**

| 选项 | 描述 | 选择 |
|------|------|------|
| 每个 subscriber 独立触发 catch-up | Phase 16 逻辑不变，各自维护 lastDeltaEventId | ✓ |
| 只对第一个 subscriber 触发 | 后加入者不补历史 delta | |

---

## chatClientBindings 职责

| 选项 | 描述 | 选择 |
|------|------|------|
| 保留，仅用于发起方追踪 | 错误回包、permission_request 点发用 | |
| 移除，用 frame.clientId | 减少状态，async runner 内 frame 已不在作用域 | ✓ |

**User's choice:** 移除 chatClientBindings

**Notes:** 用户询问"是不是其他也能回？"——确认 `agent.permission_request` 也应广播给所有订阅者，任意端均可响应。这使 chatClientBindings 完全失去存在价值。event payload 里的 clientId 字段保留用于日志追踪，但 Relay 不读它做路由。

---

## in-flight 锁位置

| 选项 | 描述 | 选择 |
|------|------|------|
| relay-client.ts 入口处 | client.chat case 最顶部检查，立即返回错误 | ✓ |
| chat-session-runner.ts 内部 | runner 自己感知全局状态，耦合度高 | |
| 两处都加 | 防御性，稍复杂 | |

**User's choice:** relay-client.ts 入口处，`chatInFlight: Set<string>`

**跟进问题 — 释放时机：**
确认三种情况：`agent.result` + `session.error` + 子进程 exit，第一版不加超时兜底。

---

## Claude's Discretion

- `sendChatEventToSubscribers` 辅助函数的具体签名（建议抽取以减少重复）
- `chat_in_progress` 错误码在 protocol 包的更新方式（取决于 error frame 类型约束）

## Deferred Ideas

- 消息排队
- 多端编辑草稿同步
- 在线状态 / presence
- in-flight 锁超时兜底
