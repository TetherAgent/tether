---
phase: 11
phase-slug: agent
date: 2026-05-05
---

# Phase 11: Agent 实时对话视图 - Validation Architecture

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in test runner (`node:test`) |
| Config file | none — invoked via `node --experimental-sqlite --no-warnings=ExperimentalWarning --import tsx --test src/*.test.ts` |
| Quick run command | `pnpm --filter @tether/gateway test` |
| Full suite command | `pnpm --filter @tether/gateway test && pnpm --filter @tether/relay test` |

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DB-01 | conversation_turns table: turn_index sequential, INSERT OR IGNORE idempotent, listConversationTurns ascending | unit | `pnpm --filter @tether/gateway test` (store.test.ts) | Wave 1 |
| DB-02 | insertConversationTurn transaction prevents duplicate turn_index under concurrent writes | unit | `pnpm --filter @tether/gateway test` | Wave 1 |
| RELAY-01 | Relay forwards client.chat frame to gateway with clientId, sessionId, message intact | unit | `pnpm --filter @tether/relay test` (relay.test.ts) | Wave 2 |
| WATCH-01 | JournalWatcher: processClaudeEntry/processCodexEntry call insertConversationTurn with correct role/content/tools | unit | `pnpm --filter @tether/gateway test` (journal-watcher.test.ts) | Wave 3 |
| SELECT-01 | agent.select regex detection matches ≥2 consecutive numbered lines; non-matching input produces no event | unit | `pnpm --filter @tether/gateway test` (agent-select.test.ts) | Wave 4 |
| GW-01 | Gateway handles client.chat: user turn in DB + pty.write + agent.typing emitted | manual | db query + pty echo + ws capture | — |
| API-01 | GET /api/sessions/:id/conversation returns turns in turn_index order | manual | curl after session | — |
| FE-01 | Frontend: history bubbles load, real-time turn appends, select chips render, reconnect restores | manual | mobile browser test | — |

## Sampling Rate

- **Per task commit:** `pnpm --filter @tether/gateway test && pnpm --filter @tether/gateway typecheck`
- **Per wave merge:** above + `pnpm --filter @tether/relay test && pnpm --filter @tether/web typecheck`
- **Phase gate:** Full suite green + manual 5-point mobile verification before `/gsd-verify-work`
