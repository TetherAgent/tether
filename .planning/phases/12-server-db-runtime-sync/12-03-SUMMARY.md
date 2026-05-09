# 12-03 Summary

- Extended `RelayServerOptions` with `serverSyncUrl` and `runtimeSyncSecret`.
- Added `syncToServer(endpoint, body)` in `apps/relay/src/relay.ts` with a 3-second timeout and warning-only failure handling.
- Added non-blocking `void syncToServer(...)` calls after `gateway.sessions`, `gateway.conversation`, and eligible `gateway.event` frames.
- Added `RUNTIME_EVENT_WHITELIST` for relay-side runtime event filtering before sync.
- Wired `TETHER_RUNTIME_SYNC_SECRET` and `TETHER_SERVER_URL` through `apps/relay/src/main.ts`.
