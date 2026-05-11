---
status: partial
phase: 15-chat-remote-session-metadata
source: [15-VERIFICATION.md]
started: 2026-05-11T05:55:00Z
updated: 2026-05-11T05:55:00Z
---

## Current Test

Awaiting human live-environment verification.

## Tests

### 1. New chat syncs through Server DB
expected: Web can create a chat, receive an AI reply, and Server DB contains the chat session metadata.
result: pending

### 2. Chat history survives Web refresh
expected: Refreshing Web restores messages from Server DB, not Gateway local SQLite.
result: pending

### 3. Existing chat continues after Gateway restart
expected: After Gateway restart, continuing the same chat succeeds using Relay-injected metadata.
result: pending

### 4. Local SQLite has no chat session row
expected: `sqlite3 ~/.tether/tether.db "select id, transport from sessions where transport = 'chat';"` returns empty for the chat flow.
result: pending

### 5. Server metadata updates
expected: `agent_session_id` and `last_active_at` are populated/updated in Server DB after chat turns.
result: pending

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
