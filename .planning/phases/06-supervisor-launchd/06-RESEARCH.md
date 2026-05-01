# Phase 6: Supervisor & launchd - Research

**Date:** 2026-05-01
**Status:** Complete

## Phase Goal

Make one persistent macOS Gateway the owner of all PTY-backed sessions. Daily provider commands should ask the persistent Gateway to create sessions, then attach as clients. Gateway lifecycle should be manageable through foreground, background, launchd, status, and local config commands with Chinese user-facing output.

## Key Findings

### Gateway Already Has the Core Session Owner Pieces

`apps/gateway/src/daemon.ts` already starts a Hono HTTP server, owns the `PtySessionManager`, writes a registry heartbeat, serves direct WS streams, and starts the Relay client when relay config is present. `PtySessionManager.create` already creates the correct `Session` row and owns the live `node-pty` handle.

The missing bridge is a Gateway-side session creation endpoint. The current CLI calls `PtySessionManager.create` before starting a Gateway. Phase 6 should invert that: the persistent Gateway owns `PtySessionManager`, and CLI sends a constrained create request.

### Session Creation Must Stay Whitelist-Only

This phase adds a potentially sensitive API. It must not become a remote shell execution surface.

Allowed request shape should be limited to:

- provider name from the existing `ProviderName` whitelist
- project path
- optional terminal cols/rows

It must not accept `command`, `args`, `argv`, `env`, `shell`, or provider-specific executable paths from clients. Provider command resolution should live in shared code that both CLI and Gateway can import.

User decision: the session creation API should be config-gated and default off. This creates a tension with CLI forwarding: plans should make the local CLI path either enable the feature through local config or use a local-only/internal authorization strategy while keeping remote/API creation disabled by default. The planner should spell out the exact behavior so execution does not silently expose session creation.

### Config Belongs in a Shared Package

`packages/config/src/index.ts` currently exports gateway defaults. It is the natural home for:

- `TetherConfig` type
- `configPath()` returning `~/.tether/config.json`
- `readTetherConfig()`
- `writeTetherConfig()`
- `resolveGatewayConfig(cli, env, file)`
- `resolveRelayConfig(cli, env, file)`

This avoids duplicating config parsing in CLI and Gateway. JSON parsing should be non-executable and tolerant of a missing file, but invalid JSON should produce a clear Chinese CLI error.

### launchd Should Be the Only Background Supervisor

The user wants `tether gateway start` to run in the background and may auto-create/update the plist. The simplest durable model:

- `tether gateway install`: write plist only; do not start.
- `tether gateway start`: ensure plist exists, then `launchctl bootstrap gui/<uid> <plist>` and/or `launchctl kickstart`.
- `tether gateway stop`: `launchctl bootout gui/<uid> <plist>`.
- `tether gateway restart`: stop then start.
- `tether gateway uninstall`: stop if running, remove plist.
- `tether gateway status`: combine plist existence, registry HTTP reachability, PID, URL, config, and relay status.

All `launchctl` calls must use `child_process.spawn(cmd, args[])`, never shell strings.

The plist must not depend on `pnpm tether`, current working directory, shell PATH, `$HOME` expansion, or a login shell. It should use absolute paths captured at install/start time. A robust first implementation can run:

```text
process.execPath
--import
tsx
/absolute/path/to/apps/cli/src/main.ts
gateway
```

or an absolute `bin/tether` path if it is known to work outside the repo cwd. The planner should include an explicit verification command for the chosen entry.

### CLI Forwarding Is a Controlled Compatibility Layer

Provider commands should support:

- default: probe persistent Gateway up to 3 times with 500 ms spacing
- success: ask Gateway to create session, then attach
- failure: print Chinese warning and fall back to current inline mode
- `--inline`: skip probing and use current inline mode

This preserves current development behavior while making the persistent Gateway path the normal one once background Gateway is running.

### Relay Status Needs a Small Runtime Hook

`startRelayClient` currently returns only `close()`. For precise `gateway status`, it can expose status like:

```ts
type RelayConnectionState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'auth_failed';
```

`RunningDaemon` can expose a status snapshot or `daemon.ts` can expose `/api/status`. If exact relay status becomes too broad, plans may still show config state, but the preferred Phase 6 target is precise connected/disconnected when low-cost.

## Suggested Implementation Shape

### Foundation

1. Upgrade `node-pty` from `1.2.0-beta.2` to `>=1.2.0-beta.12`.
2. Move provider command metadata into a shared importable location.
3. Add config read/write/resolve helpers.

### Gateway API

Add:

- `GET /api/status`
- `POST /api/sessions`

`POST /api/sessions` should:

- check the config switch before creating
- reject unknown provider
- reject forbidden keys recursively
- validate terminal size with `isValidTerminalSize`
- resolve command from provider whitelist
- call `PtySessionManager.create`
- return `{ session }`

### CLI

Refactor provider startup into:

- inline path (existing behavior)
- forwarded path (new)
- fallback path (probe failure -> inline warning)

### launchd

Add helpers for:

- plist path
- plist XML generation
- install/start/stop/restart/uninstall/status
- safe list-form launchctl execution

## Validation Architecture

### Automated Tests

- Config tests: missing file, JSON merge, precedence, default session creation switch off.
- Gateway tests: `POST /api/sessions` rejects when disabled, rejects unknown provider, rejects command-shaped payloads, creates `/bin/cat`-style test session when enabled if test provider strategy is available, and exposes `/api/status`.
- CLI/helper tests: plist generation contains absolute paths and no `pnpm tether`, `$HOME`, or shell strings.
- Relay status tests: relay client status moves through configured/connected/disconnected where practical.

### Manual E2E

Run locally on macOS:

1. `pnpm tether gateway config --relay-url ws://127.0.0.1:4889 --relay-secret dev-secret`
2. `pnpm tether gateway`
3. In another terminal, `pnpm tether codex`
4. Confirm session is created by persistent Gateway and remains visible after CLI detach.
5. `pnpm tether gateway install`
6. `pnpm tether gateway start`
7. `pnpm tether gateway status`
8. `pnpm tether gateway stop`
9. `pnpm tether gateway uninstall`

## Risks

- `POST /api/sessions` can become remote command execution if it accepts command/args/env. Plans must explicitly forbid this.
- Config switch default-off can conflict with local CLI forwarding if not designed carefully. Plans must define how the CLI local path is allowed without widening remote API exposure.
- launchd environment is sparse. Agent CLIs may not find `codex` if PATH is not explicit. Plans should verify and document the resulting behavior.
- Absolute repo source entry with `tsx` is acceptable for personal local install, but not a production distribution model. npm registry packaging is deferred.
- `launchctl` behavior differs across macOS versions. Keep commands minimal and verify on the user's Mac.

## RESEARCH COMPLETE

