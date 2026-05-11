---
phase: 16-chat-runtime-raw-events
status: clean
depth: standard
files_reviewed: 19
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
reviewed_at: 2026-05-11T15:20:00Z
---

# Phase 16 Code Review

## Scope

Reviewed the Phase 16 source changes:

- `apps/gateway/src/chat-session-runner.ts`
- `apps/gateway/src/relay-client.ts`
- `apps/relay/src/relay.ts`
- `apps/relay/test/relay.test.ts`
- `apps/server/app/controller/chat-events.ts`
- `apps/server/app/controller/chat.ts`
- `apps/server/app/controller/runtime-sync.ts`
- `apps/server/app/router.ts`
- `apps/server/app/service/chatEventsRepository.ts`
- `apps/server/app/service/chatRepository.ts`
- `apps/server/app/service/runtimeSyncRepository.ts`
- `apps/server/config/config.default.ts`
- `apps/server/sql/005-chat-runtime-events.sql`
- `apps/server/test/runtime-sync.test.ts`
- `apps/server/typings/app/controller/index.d.ts`
- `apps/server/typings/app/service/index.d.ts`
- `apps/web/src/components/chats/chat-data.ts`
- `apps/web/src/components/chats/chat-panel.tsx`
- `packages/protocol/src/index.ts`

## Findings

No open findings.

## Fixed During Review

### Missing Critical: chat transport branch must still create message rows

`runtime-sync` now routes `scope.transport === 'chat'` away from the old `upsertRuntimeEvent` path. The first implementation inserted raw chat events and only updated `gateway_chat_messages.raw_json`; if the final message row did not already exist, chat history would miss new `user.message` / `agent.result` rows.

Fixed in commit `8eff47f` by adding `upsertDerivedChatMessageRawJson`, which atomically upserts final message rows with `raw_json` for `user.message` and `agent.result`. Added a regression test for `agent.result` message persistence.

## Verification

- `pnpm --filter @tether/server typecheck` -> passed
- `pnpm --filter @tether/server clean && pnpm --filter @tether/server test` -> passed; 28 tests
- `pnpm --filter @tether/relay typecheck` -> passed
- `pnpm --filter @tether/relay test` -> passed; 39 tests
- `pnpm --filter @tether/web typecheck` -> passed
- `pnpm --filter @tether/gateway test` -> passed; 71 tests
- `pnpm --filter @tether-labs/cli test` -> passed; 20 tests
- `pnpm typecheck` -> passed
- `pnpm --filter @tether/server clean && pnpm test` -> passed

## Residual Risk

No automated MySQL integration test executed the SQL migration against a live MySQL instance in this run. The DDL is covered by static checks and Server typecheck/test, but live migration idempotency remains an environment-level verification item.
