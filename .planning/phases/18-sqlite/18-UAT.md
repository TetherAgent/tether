---
status: testing
phase: 18-sqlite
source:
  - 18-01-SUMMARY.md
  - 18-02-SUMMARY.md
  - 18-03-SUMMARY.md
started: 2026-05-12T16:31:00+08:00
updated: 2026-05-12T16:31:00+08:00
---

## Current Test

number: 1
name: Cold Start Smoke Test
expected: |
  Stop any running local Tether Gateway/relay process you normally use for this flow, then start the stack again from scratch with your normal phase-18 setup.

  What should happen:
  - Gateway/relay boot without SQLite-related errors.
  - `tether gateway status` (or your normal health check) shows the runtime is up.
  - A basic session read path still works after startup, such as loading the session list or opening the main session screen.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Stop the local Gateway/relay flow, start it from scratch, and confirm startup succeeds without SQLite-related failures while a basic session read path still works.
result: pending

### 2. Relay PTY Creation from CLI
expected: Starting a new provider session through `tether run ...` or `tether codex/claude ...` creates the PTY session through relay websocket flow without relying on local SQLite or the old gateway POST create path.
result: pending

### 3. Gateway Session Restore after Reconnect
expected: If you keep a PTY session running, then reconnect the Gateway/relay path, the session metadata is restored and becomes visible again instead of disappearing because local SQLite is gone.
result: pending

### 4. Gateway-Only Control Path
expected: Session control commands like list/stop rely on live Gateway state only. With Gateway available they work normally; with Gateway unavailable they fail clearly instead of silently reading stale local DB state.
result: pending

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0

## Gaps

none yet
