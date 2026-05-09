# 12-06 Summary

- Removed the `conversation_turns` SQLite table and the old `insertConversationTurn` / `listConversationTurns` store APIs.
- Switched Gateway conversation reconstruction to `agent.turn` events via `listAgentTurns(...)`.
- `journal-watcher.ts` and `chat-handler.ts` now use `event.id` as the effective turn index.
- Relay and daemon conversation responses now read from reconstructed `agent.turn` history instead of a separate table.
