# Phase 16: Chat Runtime Raw Events - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 16-chat-runtime-raw-events
**Areas discussed:** 旧表 gateway_runtime_events 的定位, agent.delta event id 生成策略, Relay 同步 delta 的代码路径, Server 写路径 — 新方法 vs 扩展现有

---

## 旧表 gateway_runtime_events 的定位

| Option | Description | Selected |
|--------|-------------|----------|
| 双写，后续再迁移 | Phase 16 同时写两张表，保持 backward compat，后续单独决策是否停旧表 | |
| 只写新表 | chat events 直接切到 gateway_runtime_chats_events，同一次完成 | ✓ |

**User's choice:** 只写新表，Phase 16 同一次完成切换

**Notes:** 历史存量数据保留在 gateway_runtime_events，不做迁移脚本。gateway_runtime_events 表本身不删除，只是 Phase 16 后不再往里写 chat events。

---

## agent.delta event id 生成策略

| Option | Description | Selected |
|--------|-------------|----------|
| per-session 递增计数器 | ChatSessionRunner 内维护从 1 开始的独立计数器 | ✓ |
| timestamp-ms | 用 Unix 毫秒时间戳，不保证唯一 | |
| 与 PTY event 共用全局计数器 | gateway 层跨 session 统一序列 | |

**User's choice:** per-session 递增计数器，从 1 开始，局限于 delta events，与 PTY event id 序列独立

**Notes:** 计数器在 ChatSessionRunner 内部属性（nextDeltaId）维护，随实例生命周期。

---

## Relay 同步 delta 的代码路径

| Option | Description | Selected |
|--------|-------------|----------|
| break 前插入 syncToServer | 在现有 delta handler 内部 break 之前调用 syncToServer | ✓ |
| 加入 RUNTIME_EVENT_WHITELIST | 删除 delta 特殊分支，让它走通用事件路径 | |

**User's choice:** break 前插入 syncToServer，用现有 /api/relay/runtime-sync/gateway/event 端点

**Notes:** 传完整 frame.event（不只是 text），scope 里补 transport: 'chat' 字段供 Server 判断写路径。

---

## Server 写路径 — 新方法 vs 扩展现有

| Option | Description | Selected |
|--------|-------------|----------|
| 新建独立方法 upsertChatRuntimeEvent | 与 upsertRuntimeEvent 完全解耦，两路径独立 | ✓ |
| 扩展现有 upsertRuntimeEvent | 加 transport='chat' 分支，共享部分逻辑 | |

**User's choice:** 新建 upsertChatRuntimeEvent，同一 MySQL transaction 同时写 gateway_runtime_chats_events 和更新 gateway_chat_messages.raw_json

**Notes:** Server 通过 body.scope.transport 判断分发路径（chat → 新方法，否则 → 旧方法）。

---

## Claude's Discretion

无。所有区域均有明确用户决策。

## Deferred Ideas

- delta buffer / 100-200ms batch insert（设计文档已标记为首版不做）
- 历史数据迁移脚本（按需单独决策）
- PTY terminal events 的 raw_json 入库（独立需求）
