# Phase 18: 去掉本地 SQLite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 18-去掉本地 SQLite
**Areas discussed:** Event ID 生成, CLI 删除边界, 分 plan 策略, 已有 SQLite 数据迁移

---

## Event ID 生成

| Option | Description | Selected |
|--------|-------------|----------|
| 对齐 chat，timestamp-based | `(Date.now() * 1000) + sequence`，跨进程安全，不需要共享计数器 | ✓ |
| gateway 进程内全局计数器 | 单进程内有序，但重启后从 0 开始会和历史 ID 冲突 | |

**User's choice:** 对齐 chat，timestamp-based

| Option | Description | Selected |
|--------|-------------|----------|
| 共用，提取到 packages/protocol 或公共工具 | 一个 createSessionEvent 函数，chat 和 PTY 都用 | ✓ |
| 各自独立实现 | PTY 在 pty.ts 里复用同样逻辑，不引入新依赖 | |

**User's choice:** 共用，提取到 packages/protocol 或公共工具

---

## CLI 删除边界

| Option | Description | Selected |
|--------|-------------|----------|
| 直接删除，不替换 | PTY 创建以后只在 web UI 操作 | |
| 改成调 WS，cli 连 relay 发帧 | 保留命令行入口但改用 WS | ✓ |

**User's choice:** tether run/claude/codex 改成连 relay 发 WS 帧

| Option | Description | Selected |
|--------|-------------|----------|
| 保留，改从 gateway HTTP 查 session | GET /api/sessions/:id 替换 SQLite 查 | |
| 删掉 tether attach，web 已覆盖 | attach 功能包含在 web 终端 tab 里 | ✓ |

**User's choice:** 删掉 tether attach，web 已覆盖

**Notes:** 用户先问了 tether attach 是干什么的（不了解其作用），说明后选择删除。tether codex --attach 参数支持同步移除。

---

## 分 plan 策略

| Option | Description | Selected |
|--------|-------------|----------|
| 5 个独立 plan | 一一对应 ①-⑤，每个都可独立验收 | |
| ①+② 合并，③+④ 合并，⑤ 独立 | 3 个 plan，①+② 都是删写入/改内存，③+④ 都是新协议帧 | ✓ |
| 1 个大 plan 一次删 | 风险更高 | |

**User's choice:** 3 个 plan（①+②, ③+④, ⑤）

| Option | Description | Selected |
|--------|-------------|----------|
| 只需代码层清除 | 删 store.ts、better-sqlite3、启动参数 | ✓ |
| 同时删用户磁盘上的 tether.db | gateway 启动时自动删除或提供 migration 命令 | |

**User's choice:** 只需代码层清除

---

## 已有 SQLite 数据迁移

| Option | Description | Selected |
|--------|-------------|----------|
| 忽略，不迁移 | MySQL 已有完整远端历史，本地 SQLite 是冗余缓存 | ✓ |
| 提供迁移脚本 | 一次性把本地 SQLite 事件导入 MySQL | |

**User's choice:** 忽略，不迁移

| Option | Description | Selected |
|--------|-------------|----------|
| 不需要，静默忽略 | 文件在就在，gateway 不读它就行，用户自行删 | ✓ |
| 启动时打一条 log 提示 | "Found legacy tether.db — no longer used" | |

**User's choice:** 不需要，静默忽略

---

## Claude's Discretion

无 — 用户对所有关键决策都给出了明确选择。

## Deferred Ideas

- 事件回放改 MySQL（`GET /api/sessions/:id/events`）— 后续阶段
- 快照接口改 MySQL（`/api/sessions/:id/snapshot`）— 后续阶段
- tether attach CLI 替代（连 relay WS）— 暂不做
