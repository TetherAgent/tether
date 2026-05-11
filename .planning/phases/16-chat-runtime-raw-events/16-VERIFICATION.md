---
phase: 16-chat-runtime-raw-events
status: passed
verified_at: 2026-05-11T15:20:00Z
verifier: codex
automated: true
human_needed: false
---

# Phase 16 Verification

## Verdict

PASSED.

Phase 16 delivers the required raw chat runtime event path:

- Gateway emits stable chat delta event ids and includes `eventId` in `agent.delta`.
- Protocol supports `agent.delta.eventId` and `gateway.chat-catchup.lastEventId`.
- Relay syncs chat runtime events with `scope.transport = 'chat'`.
- Relay catch-up reads `/api/relay/chat-events/:sessionId?after=N` and returns `gateway.chat-catchup.lastEventId`.
- Server persists chat raw events to `gateway_runtime_chats_events`.
- Server derives `gateway_chat_messages.raw_json` while preserving message-row creation for `user.message` and `agent.result`.
- Web tracks the last chat event cursor and subscribes with `after`.

## Evidence

### Code Paths

- `apps/server/sql/005-chat-runtime-events.sql` defines `gateway_runtime_chats_events` and migrates `gateway_chat_messages.raw_json`.
- `apps/gateway/src/chat-session-runner.ts` allocates `deltaEventId` and exposes `lastDeltaEventId`.
- `apps/gateway/src/relay-client.ts` forwards chat delta ids and preserves PTY relay behavior.
- `apps/relay/src/relay.ts` syncs `agent.delta` with chat transport scope and performs chat catch-up.
- `apps/server/app/service/runtimeSyncRepository.ts` writes raw chat events and derived chat message rows atomically.
- `apps/server/app/service/chatEventsRepository.ts` serves delta events after a cursor.
- `apps/server/app/controller/chat-events.ts` exposes the relay catch-up endpoint.
- `apps/web/src/components/chats/chat-panel.tsx` stores and advances the chat runtime event cursor.

### Automated Checks

- `pnpm --filter @tether/protocol typecheck` passed.
- `pnpm --filter @tether/gateway typecheck` passed.
- `pnpm --filter @tether/gateway test` passed; 71 tests.
- `pnpm --filter @tether/server typecheck` passed.
- `pnpm --filter @tether/server clean && pnpm --filter @tether/server test` passed; 28 tests.
- `pnpm --filter @tether/relay typecheck` passed.
- `pnpm --filter @tether/relay test` passed; 39 tests.
- `pnpm --filter @tether/web typecheck` passed.
- `pnpm --filter @tether-labs/cli test` passed; 20 tests.
- `pnpm typecheck` passed.
- `pnpm --filter @tether/server clean && pnpm test` passed.
- `gsd-sdk query verify.schema-drift "16"` passed with `drift_detected: false`.
- `gsd-sdk query verify.key-links .planning/phases/16-chat-runtime-raw-events/16-03-PLAN.md` passed.

## Review Fixes Applied

1. The initial chat transport path inserted raw events but could miss derived `gateway_chat_messages` rows. Fixed by adding `upsertDerivedChatMessageRawJson` and regression coverage for `agent.result`.
2. The Phase 16 Relay catch-up isolation test now hydrates trusted session metadata via the Server metadata endpoint instead of manually seeding `gateway.sessions`.
3. Gateway relay-client PTY tests now create owner-scoped PTY sessions so they match Relay scope enforcement.
4. CLI gateway login callback timer/server remain refed while waiting for auth, and `finish()` closes the server after callback completion.

## Residual Risk

No live MySQL migration was executed in this run. The SQL and persistence paths are covered by static checks and mocked Server tests, but production/staging migration idempotency should still be exercised during deployment.
