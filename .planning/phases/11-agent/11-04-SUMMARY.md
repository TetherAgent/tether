---
phase: 11-agent
plan: 04
subsystem: web-chat-runtime
tags: [gateway, relay, web, chat, agent-select]
requires:
  - phase: 11-03
    provides: JournalWatcher agent.turn 事件与会话对话链路
provides:
  - Gateway/Relay 双通道 agent.select 解析与转发
  - Web `/remote/session/:sessionId/chat` 对话页面与历史加载
  - Chat UI 对 `agent.turn`/`agent.typing`/`agent.select` 的实时消费
affects: [apps/gateway, apps/relay, apps/web, mobile-chat-runtime]
tech-stack:
  added: [react-markdown]
  patterns:
    - "terminal.output 300ms 防抖 + selectEmitted 锁防重复发射"
    - "REST 历史加载 + WS 增量事件拼接对话视图"
key-files:
  created:
    - .planning/phases/11-agent/11-04-SUMMARY.md
    - apps/gateway/src/agent-select-detect.ts
    - apps/gateway/src/agent-select.test.ts
  modified:
    - apps/gateway/src/daemon.ts
    - apps/gateway/src/relay-client.ts
    - apps/web/src/components/session/chat-session-surface.tsx
    - apps/web/src/routes.tsx
    - apps/web/src/main.tsx
    - apps/web/src/i18n/messages.ts
    - apps/web/CLAUDE.md
key-decisions:
  - "会话前端统一切到 /chat 路由，移除 /simple 入口"
  - "agent.select 检测在 daemon 与 relay-client 两侧独立执行，覆盖直连与中继模式"
patterns-established:
  - "agent.select 检测函数抽离为可复用纯函数并单测覆盖 6 条规则"
requirements-completed: [AGENT-01]
duration: 8min
completed: 2026-05-05
---

# Phase 11 Plan 04: Agent 对话视图落地 Summary

**交付 `/chat` 结构化对话页与 agent.select 端到端检测，让移动端/网页都能稳定消费 AI 对话与选项芯片。**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-05T09:38:00Z
- **Completed:** 2026-05-05T09:46:00Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- 在 `daemon.ts` 与 `relay-client.ts` 同步实现 agent.select（300ms 防抖 + 锁）并补齐检测单测。
- 前端移除 `/simple`，启用 `/chat`，完成历史加载、实时事件渲染、选项芯片回发与 30s fallback。
- 补齐 i18n 文案键与 `apps/web/CLAUDE.md` 路由文档，保证 UI 文案与路由表一致。

## Task Commits

1. **Task 1: agent.select detection in daemon.ts + relay-client.ts + i18n keys + unit tests** - `53ddde9` (feat)
2. **Task 2: Frontend — routes, page, and ChatSessionSurface rewrite** - `fe5add6` (feat)
3. **Task 3: checkpoint:human-verify** - 人工验证已通过（approved，无代码提交）

## Files Created/Modified

- `apps/gateway/src/agent-select-detect.ts` - 抽离编号选项检测函数。
- `apps/gateway/src/agent-select.test.ts` - 覆盖 6 个检测场景。
- `apps/gateway/src/daemon.ts` - 直连 WebSocket 路径的 agent.select 检测与发射。
- `apps/gateway/src/relay-client.ts` - Relay 订阅路径的 agent.select 检测与转发。
- `apps/web/src/components/session/chat-session-surface.tsx` - 聊天气泡 UI、历史加载、事件消费、发送逻辑。
- `apps/web/src/routes.tsx` / `apps/web/src/main.tsx` - 路由模式从 `simple` 切到 `chat`。
- `apps/web/src/i18n/messages.ts` - 新增 chat 相关文案键（zh/en）。
- `apps/web/CLAUDE.md` - 路由表更新为 `/chat`。

## Verification Results

- `pnpm --filter @tether/gateway typecheck` ✅
- `pnpm --filter @tether/gateway test` ✅
- `pnpm --filter @tether/relay test` ✅
- `pnpm --filter @tether/web typecheck` ✅
- `pnpm --filter @tether/web build` ✅
- 人工 checkpoint（mobile/chat 验证）✅ approved

## Decisions Made

- 继续沿用 Plan 01/02 的 conversation API 与事件模型，不新增协议分支。
- 选项检测逻辑做函数级复用，避免 daemon/relay 出现规则漂移。

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Auth Gates

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Agent 对话视图全链路已落地并通过人工验证，可进入后续体验优化与性能治理。

## Self-Check: PASSED

- `FOUND: .planning/phases/11-agent/11-04-SUMMARY.md`
- `FOUND: 53ddde9`
- `FOUND: fe5add6`
