---
phase: 11-agent
plan: 02
subsystem: gateway-relay-chat
tags: [relay, gateway, websocket, conversation, api]
requires:
  - phase: 11-01
    provides: client.chat 协议类型与 conversation_turns 存储能力
provides:
  - Relay 端 client.chat 鉴权与转发链路
  - Gateway 共享 chat handler（返回 agent.typing SessionEvent）
  - Direct/Relay 双模式 agent.typing 推送与会话对话历史 API
affects: [apps/relay, apps/gateway, mobile-chat-runtime]
tech-stack:
  added: []
  patterns:
    - "relay.ts 复用 client.input 的控制权限守卫处理 client.chat"
    - "chat-handler.ts 作为 direct/relay 共享入口，统一写 turn + PTY + agent.typing"
key-files:
  created:
    - .planning/phases/11-agent/11-02-SUMMARY.md
    - apps/gateway/src/chat-handler.ts
  modified:
    - apps/relay/src/relay.ts
    - apps/relay/src/relay.test.ts
    - apps/gateway/src/relay-client.ts
    - apps/gateway/src/daemon.ts
key-decisions:
  - "handleChatMessage 返回 SessionEvent，由调用方决定向 direct socket 或 relay gateway.event 广播"
patterns-established:
  - "client.chat 在 relay/gateway 侧都先做会话存在性与控制权限前置校验"
  - "对话历史恢复统一走 GET /api/sessions/:id/conversation（不直接读 JSONL）"
requirements-completed: [AGENT-01]
duration: 7min
completed: 2026-05-05
---

# Phase 11 Plan 02: Relay/Gateway 聊天链路与会话历史 API Summary

**打通 client.chat 从 Relay 到 Gateway PTY 的完整路径，并在 direct/relay 双模式实时推送 agent.typing 与提供 conversation 历史恢复接口。**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-05T08:33:31Z
- **Completed:** 2026-05-05T08:40:56Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- 在 `apps/relay/src/relay.ts` 增加 `client.chat` 分支并复用 `client.input` 同级鉴权/订阅守卫。
- 在 Gateway 侧新增 `chat-handler.ts`，统一完成消息截断、user turn 写库、PTY 写入和 `agent.typing` 事件生成。
- 在 `relay-client.ts` 与 `daemon.ts` 分别接入 chat handler，确保 relay/direct 两条链路都能把 `agent.typing` 推给客户端；同时新增 `/api/sessions/:id/conversation`。

## Task Commits

1. **Task 1: Relay forwarding (relay.ts) + relay unit test**  
   - `425252c` (test)  
   - `94050cb` (feat)
2. **Task 2: chat-handler.ts + relay-client.ts case + daemon.ts chat case + conversation API**  
   - `b3270ec` (test)  
   - `f7bd55e` (feat)

_Note: TDD 任务按 RED → GREEN 提交。_

## Files Created/Modified

- `apps/relay/src/relay.ts` - 增加 `client.chat` 转发分支与控制权限检查。
- `apps/relay/src/relay.test.ts` - 新增 relay 转发 `client.chat` 的单测。
- `apps/gateway/src/chat-handler.ts` - 新增共享 chat 处理函数，返回 `Promise<SessionEvent>`。
- `apps/gateway/src/relay-client.ts` - 新增 `case 'client.chat'`，先 `getSession` 再调用 handler 并发送 `gateway.event`。
- `apps/gateway/src/daemon.ts` - 新增 direct-mode chat WS 处理与 `/api/sessions/:id/conversation` 路由。

## Verification Results

- `pnpm --filter @tether/relay typecheck` ✅
- `pnpm --filter @tether/relay test` ✅（17/17）
- `pnpm --filter @tether/gateway typecheck` ✅
- `grep -c "case 'client\.chat'" apps/relay/src/relay.ts` → `1` ✅
- `grep -c "case 'client\.chat'" apps/gateway/src/relay-client.ts` → `1` ✅
- `grep -c "frame\.type === 'chat'" apps/gateway/src/daemon.ts` → `1` ✅
- `grep -c "conversation" apps/gateway/src/daemon.ts` → `3` ✅
- `grep -c "slice(0, 4000)" apps/gateway/src/chat-handler.ts` → `1` ✅
- `grep -c "Promise<SessionEvent>" apps/gateway/src/chat-handler.ts` → `1` ✅
- `grep -c "type: 'event', event" apps/gateway/src/daemon.ts` → `5` ✅
- `grep -c "gateway\.event.*toRelayEvent" apps/gateway/src/relay-client.ts` → `3` ✅
- `grep -c "getSession(frame\.sessionId)" apps/gateway/src/relay-client.ts` → `1` ✅

## Decisions Made

- 复用单一 `handleChatMessage`，避免 direct/relay 两条路径出现行为漂移。

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 11-02 所需聊天转发与恢复 API 已就绪，可继续 11-03 的 JournalWatcher/agent.turn 接入。

## Self-Check: PASSED

- `FOUND: .planning/phases/11-agent/11-02-SUMMARY.md`
- `FOUND: 425252c`
- `FOUND: 94050cb`
- `FOUND: b3270ec`
- `FOUND: f7bd55e`
