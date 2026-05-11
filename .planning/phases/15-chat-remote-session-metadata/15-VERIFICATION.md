---
phase: 15
status: human_needed
verified_at: 2026-05-11T05:55:00Z
score: 6/7
---

# Phase 15 Verification

## Goal

Chat 链路不再依赖 Gateway 本地 SQLite：Relay 从 Server DB 补齐可信 metadata 后转发给 Gateway，Gateway 续聊直接用 `frame.session` 执行，不查本地 sessions；新建 chat 显式上报 metadata 到 Relay/Server。

## Automated Checks

| Check | Status | Evidence |
| --- | --- | --- |
| Protocol typecheck | passed | `pnpm --filter @tether/protocol exec tsc -p tsconfig.json --noEmit` |
| Gateway typecheck | passed | `pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit` |
| Relay typecheck | passed | `pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit` |
| Server typecheck | passed | `pnpm --filter @tether/server typecheck` |
| Gateway Phase15 tests | passed | `Phase15-T4`, `Phase15-T5`, `Phase15-A8` |
| Relay Phase15 tests | passed | `Phase15-T1`, `Phase15-T2`, `Phase15-A7` |
| Server Phase15 test | passed | `Phase15-T7` |
| A1-A5 grep checks | passed | No matches for local chat DB/history calls in target Gateway chat files |

## Must-Haves

| Requirement | Status | Evidence |
| --- | --- | --- |
| Gateway continuation does not call `store.getSession(sessionId)` | passed | `rg` returned no matches in `chat-session-runner.ts` / `relay-client.ts` target check |
| New chat does not call `store.insertSession()` | passed | `rg` returned no matches in `chat-session-runner.ts` |
| Chat runner does not call `touchSession()` / `updateAgentSessionId()` | passed | `rg` returned no matches in `chat-session-runner.ts` |
| Relay fetches Server metadata before continuation | passed | `fetchSessionMetadata` and Phase15-T1 |
| Relay rejects cross-account and wrong-transport continuation | passed | Phase15-T2 and Phase15-A7 |
| `agent_session_id` PATCH is scoped | passed | Phase15-T7 and Relay PATCH body scope |
| Live end-to-end chat continuation after Gateway restart | human_needed | Requires local Server + Relay + Gateway + Web UAT |

## Findings

- Code review warning recorded in `15-REVIEW.md`: possible race where `session.agent-id-updated` arrives before `gateway.chat-session-created` finishes Server sync.
- `pnpm --filter @tether/server run migrate:latest` cannot run because `apps/server/package.json` has no `migrate:latest` script.
- Full server/relay/gateway suites still have unrelated existing failures; Phase15-focused checks pass.

## Human Verification Required

1. Start Server, Relay, Gateway, and Web locally.
2. Create a new chat from Web.
3. Refresh Web and confirm history loads from Server DB.
4. Restart Gateway.
5. Continue the same chat and confirm provider resume works without a local Gateway session row.
6. Confirm Server DB has `gateway_sessions.agent_session_id` and `last_active_at` updated.
7. Confirm `~/.tether/tether.db` has no `transport='chat'` session row for the chat flow.

## Verdict

Automated implementation checks passed, but phase completion requires human UAT approval.
