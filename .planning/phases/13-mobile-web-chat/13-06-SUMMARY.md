# 13-06 Summary

- Added `ChatPanel` with HTTP history loading, Relay WebSocket auth/subscribe flow, optimistic composer updates, and new-session URL promotion.
- Wired provider/model/cwd selection into first-message chat creation and existing-session resume.
- Verified the new web chat surface with package typechecks, a production web build, gateway store tests, and the targeted Relay missing-runner regression test.
