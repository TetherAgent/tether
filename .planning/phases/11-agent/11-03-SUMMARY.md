---
phase: 11-agent
plan: 03
subsystem: gateway-journal-watcher
tags: [gateway, jsonl, claude, codex, conversation]
requires:
  - phase: 11-02
    provides: client.chat 写入会话与 conversation_turns 基础能力
provides:
  - JournalWatcher 增量读取 Claude/Codex JSONL 并产出 agent.turn
  - SessionRunner 生命周期内启动/停止 JournalWatcher
affects: [apps/gateway, mobile-chat-runtime]
tech-stack:
  added: []
  patterns:
    - "fs.watch + 2s poll fallback + 1s 文件存在轮询"
    - "assistant turn 的 turnIndex 直接使用 insertConversationTurn 返回值"
key-files:
  created:
    - .planning/phases/11-agent/11-03-SUMMARY.md
    - apps/gateway/src/journal-watcher.ts
    - apps/gateway/src/journal-watcher.test.ts
  modified:
    - apps/gateway/src/session-runner.ts
key-decisions:
  - "Codex task 完成同时兼容 task_completed 与 task_complete 事件名"
  - "processClaudeEntry/processCodexEntry 保持 public 以支持直接单测"
patterns-established:
  - "JSONL 增量读取采用 lastOffset + residual 残行拼接避免半行 JSON 解析错误"
requirements-completed: [AGENT-01]
duration: 4min
completed: 2026-05-05
---

# Phase 11 Plan 03: JournalWatcher 实时解析与 Runner 接线 Summary

**交付 JournalWatcher 以实时解析 Claude/Codex JSONL assistant turn，写入 conversation_turns 并发布 agent.turn 事件。**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-05T08:52:37Z
- **Completed:** 2026-05-05T08:57:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- 新增 `journal-watcher.ts`：实现路径解析、增量读取、残行缓冲、Claude/Codex turn 完成判定与事件发布。
- 新增 `journal-watcher.test.ts`：覆盖 5 个核心解析行为（Claude 文本/工具、Codex 周期/孤儿事件等）。
- 在 `session-runner.ts` 完成 JournalWatcher 生命周期接线：拿到 agentSessionId 后启动，exit/close 时停止。

## Task Commits

1. **Task 1: Create journal-watcher.ts with Claude + Codex JSONL parsing and unit tests** - `51cc730` (feat)
2. **Task 2: Wire JournalWatcher into SessionRunner lifecycle** - `c47452e` (feat)

## Files Created/Modified

- `apps/gateway/src/journal-watcher.ts` - JournalWatcher 主实现。
- `apps/gateway/src/journal-watcher.test.ts` - JSONL 解析行为单测。
- `apps/gateway/src/session-runner.ts` - SessionRunner 中集成 JournalWatcher 启停。

## Verification Results

- `pnpm --filter @tether/gateway typecheck` ✅
- `pnpm --filter @tether/gateway test` ✅
- `grep -c "JournalWatcher" apps/gateway/src/session-runner.ts` → `3` ✅
- `grep -c "journalWatcher?.stop" apps/gateway/src/session-runner.ts` → `2` ✅
- `grep -c "processClaudeEntry\\|processCodexEntry" apps/gateway/src/journal-watcher.ts` → `4` ✅
- `grep -c "residual" apps/gateway/src/journal-watcher.ts` → `3` ✅
- `grep -c "task_completed\\|task_complete" apps/gateway/src/journal-watcher.ts` → `1` ✅
- `grep -c "listConversationTurns" apps/gateway/src/journal-watcher.ts` → `0` ✅
- `grep -c "processClaudeEntry\\|processCodexEntry" apps/gateway/src/journal-watcher.test.ts` → `13` ✅

## Decisions Made

- 为兼容文档与实际样本差异，Codex 完成事件同时识别 `task_completed` 与 `task_complete`。
- `emitAssistantTurn` 直接使用 `insertConversationTurn` 返回的 `turnIndex`，避免二次查询导致竞态。

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- JournalWatcher 与 runner 生命周期已就绪，后续可继续前端 chat 视图事件消费与 UI 完整联调。

## Self-Check: PASSED

- `FOUND: .planning/phases/11-agent/11-03-SUMMARY.md`
- `FOUND: 51cc730`
- `FOUND: c47452e`
