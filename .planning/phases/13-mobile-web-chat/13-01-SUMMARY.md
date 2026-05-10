# 13-01 Summary

- Extended `@tether/protocol` with chat transport and chat-specific Relay frame types.
- Added gateway chat event storage in `apps/gateway/src/store.ts` plus dedicated store coverage.
- Added `apps/server/sql/004_chat_messages.sql` to persist chat history rows on the server side.
