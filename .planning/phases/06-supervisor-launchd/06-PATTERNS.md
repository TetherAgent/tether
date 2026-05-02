# Phase 6: Supervisor & launchd - Patterns

**Date:** 2026-05-01

## New / Modified Files and Closest Analogs

| Target | Role | Closest Existing Analog | Pattern to Reuse |
|--------|------|-------------------------|------------------|
| `packages/config/src/index.ts` | Shared local config helpers | existing constants in same file | export literal defaults and pure helpers; no runtime side effects |
| `packages/core/src/index.ts` | Provider whitelist metadata | existing `ProviderName` union | keep provider names as literal unions; no dynamic command input |
| `apps/gateway/src/daemon.ts` | `POST /api/sessions`, `/api/status` | existing Hono routes and WS ticket route | manual JSON validation, explicit HTTP status codes |
| `apps/gateway/src/pty.ts` | live session creation | existing `PtySessionManager.create` | keep PTY ownership in Gateway process |
| `apps/gateway/src/relay-client.ts` | relay connection status | existing reconnect loop | expose a simple status snapshot without changing routing behavior |
| `apps/gateway/src/daemon.test.ts` | Gateway API tests | existing real server tests | temp DB, real local ports, `/bin/cat`, cleanup in `finally` |
| `apps/cli/src/main.ts` | CLI forwarding and gateway subcommands | existing commander commands | add options to current commands; keep one CLI entry |
| `apps/cli/src/launchd.ts` | launchd helpers | `apps/gateway/src/tmux.ts` process helpers | `spawn(cmd, args[])`, no `shell:true`, explicit error formatting |
| `apps/cli/src/launchd.test.ts` | plist/unit tests | gateway `*.test.ts` files | `node:test`, `assert/strict`, no external test framework |
| `apps/cli/package.json` | CLI tests | `apps/gateway/package.json` | add `test: "tsx --test src/*.test.ts"` if tests are added |
| `docs/current/gateway-supervisor.md` | current usage docs | `docs/current/relay-mvp.md` | Chinese deployment/verification doc for current feature |
| `docs/README.md` | docs index | existing current docs table | add the new current doc row |

## Concrete Code Patterns

### Hono Route Pattern

`daemon.ts` routes parse JSON manually and return `{ error: string }` with explicit status codes. New routes should follow the same style:

- `400` for malformed input
- `403` for config-disabled session creation
- `404` for unknown session/provider when applicable
- `409` for wrong transport or unavailable live PTY

### PTY Creation Pattern

`PtySessionManager.create` is already the canonical session creation path. Do not duplicate session insertion logic in `daemon.ts`; route code should validate and then call the manager.

### Process Spawn Pattern

`tmux.ts` is the closest model for launchd:

- call `spawn(command, args, options)`
- collect stderr
- wrap errors in a domain-specific error class
- never use shell strings

### Registry Pattern

`registry.ts` stores live Gateway records and prunes stale records. CLI probing should treat registry as a hint, then verify HTTP reachability before using the Gateway.

## Landmines

- Do not add `shell:true`.
- Do not accept arbitrary `command`, `args`, `argv`, `env`, `shell`, or `providerCommand` in `POST /api/sessions`.
- Do not make `gateway install` start the service; `gateway start` owns background start.
- Do not make launchd depend on `pnpm tether`, cwd, `$HOME`, or shell PATH.
- Do not make Relay disconnection block local Gateway session creation.
- Do not move Phase 4 auth or Phase 5 retention into this phase.

