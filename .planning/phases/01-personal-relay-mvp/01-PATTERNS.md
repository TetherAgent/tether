# Phase 1: Personal Relay MVP - Patterns

**Date:** 2026-05-01

## New / Modified Files and Closest Analogs

| Target | Role | Closest Existing Analog | Pattern to Reuse |
|--------|------|-------------------------|------------------|
| `packages/protocol/src/index.ts` | Shared frame contract | existing placeholder protocol file | Literal union types, no enums, exported TS types |
| `apps/relay/package.json` | Workspace app manifest | `apps/gateway/package.json`, `apps/cli/package.json` | private ESM package, workspace deps, `typecheck` and `test` scripts |
| `apps/relay/tsconfig.json` | TS config | `apps/gateway/tsconfig.json` | extend root base config, include `src/**/*.ts` |
| `apps/relay/src/main.ts` | Relay CLI entry | `apps/cli/src/main.ts` command setup style, `apps/gateway/src/daemon.ts` server startup | parse env/flags simply, start service, wait for shutdown |
| `apps/relay/src/relay.ts` | Relay runtime | `apps/gateway/src/daemon.ts` WS server | `ws.WebSocketServer`, manual JSON parsing, explicit close/error frames |
| `apps/relay/src/relay.test.ts` | Relay integration tests | `apps/gateway/src/daemon.test.ts` | temp server ports, real `WebSocket`, `node:test`, `assert/strict`, cleanup in `finally` |
| `apps/gateway/src/relay-client.ts` | Gateway outbound relay connector | `apps/gateway/src/daemon.ts` stream logic, `apps/cli/src/main.ts` WS client | real `ws` client, manual frame parsing, no shell calls |
| `apps/gateway/src/daemon.ts` | Relay client lifecycle hook | existing `startDaemon` lifecycle | extend `DaemonOptions`, start/close relay client without changing direct routes |
| `apps/gateway/src/index.ts` | public exports | existing barrel exports | export relay config/types only if CLI needs them |
| `apps/cli/src/main.ts` | user-facing relay flags | existing host/port options | add options to `gateway`, provider commands, and `run`; env fallback |
| `apps/web/src/main.tsx` | relay mode UI adapter | existing `PtySessionView` and `SessionList` | preserve single-file React style, `React.` namespace hooks, localStorage keys |
| `apps/web/src/styles.css` | secret/relay mode UI styling | existing form/status styles | restrained utility UI, no landing page |
| `docs/current/relay-mvp.md` | deployment notes | `docs/README.md` governance | current doc for nginx + relay deployment; update docs index |

## Concrete Code Patterns

### WebSocket Server Pattern

`apps/gateway/src/daemon.ts` creates one `WebSocketServer` attached to the HTTP server and validates path/query before accepting behavior. Relay should do the same with `/gateway` and `/client` paths, closing unsupported paths with code `1008`.

### Frame Parsing Pattern

`daemon.ts` uses a small parser:

```ts
function parseClientFrame(raw: string): { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown } | undefined {
  try {
    return JSON.parse(raw) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  } catch {
    return undefined;
  }
}
```

Relay should keep this style: parse unknown JSON, narrow fields manually, and reject unknown/unsafe frames.

### Test Pattern

`apps/gateway/src/daemon.test.ts` uses:

- real temp DB/session resources
- real server ports
- real `WebSocket` clients
- `try/finally` cleanup
- timeout-based `waitForMessage`

Relay tests should follow this pattern instead of adding a mock library.

### Web UI Pattern

`apps/web/src/main.tsx` keeps components in one file, uses `React.useState/useEffect/useCallback`, and stores mode preferences in localStorage. Relay mode should follow that style, likely adding localStorage keys for relay URL and relay secret.

## Landmines

- Do not add `shell:true` anywhere.
- Do not let Relay accept provider names, commands, argv, env, or project paths as spawn instructions.
- Do not make Relay persist terminal output.
- Do not break existing direct `/api` paths.
- Do not create a second Web app for relay mode.
- Do not make Phase 1 depend on Phase 4 device-token tables.
