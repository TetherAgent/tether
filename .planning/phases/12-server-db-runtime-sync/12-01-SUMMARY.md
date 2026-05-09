# 12-01 Summary

- Added `apps/server/sql/002_gateway_runtime_sync.sql` with `gateway_sessions`, `gateway_chat_messages`, `gateway_runtime_events`, and `gateway_sync_cursors`.
- Added idempotent unique keys for `(session_id, turn_index)`, `(session_id, event_id)`, and `(gateway_id, session_id)`.
- Updated `apps/server/app/service/db.ts` so `ensureSchema()` reads every `sql/*.sql` file in sorted order instead of hard-coding `001_init.sql`.
