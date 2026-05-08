---
phase: 11-agent
plan: 01
subsystem: gateway-protocol
tags: [protocol, sqlite, gateway, relay, tests]
dependency_graph:
  requires: []
  provides:
    - Relay client.chat frame contracts in both client→server and server→gateway directions
    - Gateway conversation_turns persistence with transactional turn index allocation
    - Store tests for sequential turn indexing, idempotent insert, and ordered reads
  affects: [apps/relay, apps/gateway, apps/web]
tech_stack:
  added: []
  patterns:
    - "DatabaseSync transaction with BEGIN/COMMIT/ROLLBACK for turn index allocation"
    - "conversation_turns read model uses snake_case row mapping to camelCase DTO"
key_files:
  created:
    - .planning/phases/11-agent/11-01-SUMMARY.md
  modified:
    - packages/protocol/src/index.ts
    - apps/gateway/src/store.ts
    - apps/gateway/src/store.test.ts
decisions:
  - "insertConversationTurn returns allocated turn_index directly to avoid follow-up query in callers"
metrics:
  duration: "6 min"
  completed_date: "2026-05-05"
  tasks_completed: 2
  files_created: 1
requirements-completed: [AGENT-01]
---

# Phase 11 Plan 01: Protocol + conversation_turns 基础契约 Summary

**交付 client.chat 协议帧与 conversation_turns 存储层（含事务分配 turn_index 与单测），为后续 JournalWatcher/聊天 UI 提供统一契约。**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-05T07:41:05Z
- **Completed:** 2026-05-05T07:47:41Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- 在协议层新增 `client.chat` 两个方向的 union frame 类型。
- 在 Store 中新增 `conversation_turns` 表、`insertConversationTurn`、`listConversationTurns`，并扩展 `SessionEventType`。
- 新增 3 条 `conversation_turns` 单测覆盖顺序分配、幂等插入、升序读取。

## Task Commits

1. **Task 1: Add client.chat + Store table/methods** - `d624d16` (feat)
2. **Task 2: Write Store unit tests for conversation_turns** - `7818771` (test)

## Files Created/Modified

- `packages/protocol/src/index.ts` - 新增 `client.chat` frame union。
- `apps/gateway/src/store.ts` - 新增 conversation turn 类型、表结构、读写方法与事件类型。
- `apps/gateway/src/store.test.ts` - 新增 3 个 conversation_turns 行为测试。

## Verification Results

- `pnpm --filter @tether/protocol typecheck` ✅
- `pnpm --filter @tether/gateway typecheck` ✅
- `pnpm --filter @tether/gateway test` ✅（54/54 通过，含 3 个新增对话 turn 测试）
- `grep -c "client\.chat" packages/protocol/src/index.ts` → `2` ✅
- `grep -c "conversation_turns" apps/gateway/src/store.ts` → `4` ✅
- `grep -v '^[[:space:]]*//' apps/gateway/src/store.ts | grep -c "agent\.typing\|agent\.turn\|agent\.select"` → `3` ✅
- `grep -c "): number {" apps/gateway/src/store.ts` → `2` ✅

## Decisions Made

- `insertConversationTurn` 直接返回分配的 `turn_index`，避免调用方再查一次 DB。

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-01 依赖契约已就绪，可继续执行 11-02（relay/gateway chat 转发与 watcher 接入）。

## Self-Check: PASSED

- `FOUND: .planning/phases/11-agent/11-01-SUMMARY.md`
- `FOUND: d624d16`
- `FOUND: 7818771`
