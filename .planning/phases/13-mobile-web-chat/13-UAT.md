---
status: testing
phase: 13-mobile-web-chat
source: 13-01-SUMMARY.md, 13-02-SUMMARY.md, 13-03-SUMMARY.md, 13-04-SUMMARY.md, 13-05-SUMMARY.md, 13-06-SUMMARY.md
started: 2026-05-10T10:40:00Z
updated: 2026-05-10T10:40:00Z
---

## Current Test

number: 1
name: Open the chats shell
expected: |
  After signing in, opening `/chats` should show the new chat shell instead of redirecting back to `/sessions`.
  You should see the chat navigation layout with a session rail on the left (or hamburger drawer on mobile)
  and an empty-state chat panel on the right.
awaiting: user response

## Tests

### 1. Open the chats shell
expected: After signing in, `/chats` shows the new chat shell with the session rail or mobile drawer plus an empty-state chat panel.
result: [pending]

### 2. Load an existing chat session
expected: Selecting an existing chat session loads its HTTP-backed history into chat bubbles and keeps the chat shell layout visible.
result: [pending]

### 3. Start a new chat session
expected: From the empty state, choose a provider/model/cwd, send the first message, and the URL should change from `/chats` to `/chats/:sessionId`.
result: [pending]

### 4. Watch a streamed agent reply
expected: After sending a message, your user bubble appears immediately, the composer locks, the agent bubble streams in, and a result/usage card appears when the reply finishes.
result: [pending]

### 5. Reconnect to an in-flight session
expected: If you reload or reopen a session while a reply is still running, history should render first and the chat view should continue or recover the reply state instead of crashing.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

[none yet]
