# Phase 6: Supervisor & launchd - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase turns Tether Gateway into the persistent owner of PTY-backed agent sessions on the user's Mac. The target daily flow is: a background Gateway is installed or started once, `tether codex` / `tether run codex` asks that Gateway to create a session, and the CLI only attaches to the session. Closing the CLI must not kill the session or break Relay/Web access.

This phase also owns local Gateway configuration and macOS launchd lifecycle commands needed for personal daily use. It may absorb configuration items that would otherwise conflict with Phase 4/5, but it must not implement full device-token pairing/auth or retention/WAL cleanup.

</domain>

<decisions>
## Implementation Decisions

### CLI Forwarding
- **D-01:** `tether codex`, `tether claude`, `tether opencode`, and `tether run <provider>` should default to probing for a persistent Gateway first.
- **D-02:** When a persistent Gateway is found, the CLI should request session creation from that Gateway and then attach to the created session.
- **D-03:** When no persistent Gateway is found, the CLI should fall back to the current inline mode and print a clear Chinese warning, for example: `未检测到常驻 Gateway，正在为本次会话启动 inline Gateway。运行 tether gateway install 可让会话由后台 Gateway 常驻托管。`
- **D-04:** Add `--inline` to provider commands and `tether run` to force the old inline behavior for debugging.
- **D-05:** Gateway discovery should retry briefly before fallback: 3 attempts with 500 ms spacing.
- **D-06:** If the default port is occupied by a non-Tether process, report a Chinese error and do not silently switch ports.

### Gateway Commands and Lifecycle
- **D-07:** `tether gateway` remains the foreground Gateway command for development and manual verification.
- **D-08:** Add `tether gateway start` to start Gateway in the background.
- **D-09:** Add `tether gateway stop` to stop the background Gateway.
- **D-10:** Add `tether gateway restart` to restart the background Gateway.
- **D-11:** Add `tether gateway status` with Chinese user-facing output.
- **D-12:** Add `tether gateway install` to register macOS launchd login startup only; it must not automatically start Gateway immediately.
- **D-13:** Add `tether gateway uninstall` to remove the launchd registration. It should also stop the background Gateway when one is running; if no Gateway is running, it should still remove the plist cleanly.
- **D-14:** Prefer launchd for background start/stop/restart rather than CLI-owned daemonization/forking, so background run, login startup, and crash restart share one supervisor mechanism.
- **D-14a:** `tether gateway start` may automatically ensure the LaunchAgent plist exists before starting. This is treated as an implicit local install for user convenience; `gateway install` still means "register only, do not start".

### Configuration
- **D-15:** Use `~/.tether/config.json` as the local Gateway configuration file. Do not use executable `config.js`.
- **D-16:** Config should cover at least Gateway host/port and Relay URL/secret.
- **D-17:** Configuration precedence is: CLI flags > environment variables > `~/.tether/config.json` > defaults.
- **D-18:** Add a user-facing way to write config, expected as `tether gateway config --host ... --port ... --relay-url ... --relay-secret ...`.
- **D-19:** Phase 6 may move Gateway config concerns out of later Phase 4/5 plans if they conflict. Phase 4 should keep auth/pairing; Phase 5 should keep retention/storage health.
- **D-19a:** Add a config switch for remote/API session creation, default off. When off, `POST /api/sessions` must reject session creation. When on, it still only accepts provider names from the existing whitelist and must not accept arbitrary command/args/env.

### Launchd and Installation
- **D-20:** The launchd plist path is `~/Library/LaunchAgents/sh.tether.gateway.plist`.
- **D-21:** The plist should use absolute paths captured at install time. It must not depend on `$HOME` expansion or `pnpm tether` from a working directory.
- **D-22:** Phase 6 should support a local global `tether` command path for personal use. npm registry publishing is deferred; `pnpm link --global` or an equivalent local absolute entry is enough for this phase.
- **D-23:** The launchd program should run the real absolute entry, for example `node --import tsx /absolute/path/to/apps/cli/src/main.ts gateway`, or an equivalent absolute `bin/tether` path that works outside the repo cwd.
- **D-24:** `gateway install` registers only. If the user wants Gateway running immediately, they should run `tether gateway start` or foreground `tether gateway`.

### Status and Failure Semantics
- **D-25:** User-facing CLI output for Gateway lifecycle and fallback messages should be Chinese by default.
- **D-26:** `tether gateway status` should show at least: running/stopped, PID when available, URL, config file path, host/port, Relay configured yes/no, Relay connected yes/no when available, and LaunchAgent installed/not installed.
- **D-27:** Relay disconnect must not block local session creation. If low-cost to implement in Phase 6, `gateway status` should show precise Relay connected/disconnected state; otherwise it may show configured/unavailable as a fallback.
- **D-28:** If registry contains a Gateway record but the CLI cannot connect, the CLI should say in Chinese that Gateway may be restarting, retry, then fall back inline if still unreachable.

### Scope Boundary
- **D-29:** Full device-token / pairing authentication remains Phase 4 and is not implemented in this phase.
- **D-30:** Retention, WAL checkpoint scheduling, and event storage cleanup remain Phase 5 and are not implemented in this phase.
- **D-31:** tmux fallback removal remains Phase 3 and is not implemented in this phase.
- **D-32:** npm registry publishing is deferred; this phase only needs reliable local/global command behavior for the user's machine.
- **D-33:** The session creation API is a controlled Gateway feature, not a general remote execution API. Even when enabled by config, it must preserve the provider whitelist and reject arbitrary command execution shapes.

### the agent's Discretion
- Choose exact internal module boundaries for config loading, launchd plist generation, Gateway probing, and provider-session forwarding.
- Choose the exact Chinese wording for CLI messages as long as it is clear and actionable.
- Choose the exact config key name for enabling Gateway session creation, as long as the default is disabled and the whitelist-only boundary is explicit.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 6 goal, pulled-forward dependency, and success criteria.
- `.planning/REQUIREMENTS.md` — `GW-01` and `GW-02`, plus boundaries for auth, retention, and tests.
- `.planning/PROJECT.md` — milestone context, safety constraints, validated requirements, and active scope.
- `.planning/STATE.md` — current focus, prior decisions, and known blocker around Gateway restart probing.
- `.planning/phases/01-personal-relay-mvp/01-CONTEXT.md` — Relay topology and the decision that persistent Gateway should manage Relay rather than short-lived CLI processes.

### Project Rules and Current Docs
- `AGENTS.md` — repository collaboration rules, safety rules, and doc reading order.
- `CLAUDE.md` — coding principles: small scoped changes, explicit tradeoffs, verification.
- `PROJECT.md` — package manager, security gates, test expectations, and command conventions.
- `AI_CONTEXT.md` — current architecture, Gateway limitations, and long-term persistent Gateway direction.
- `docs/current/relay-mvp.md` — current Relay deployment and local verification model.

### Codebase Maps
- `.planning/codebase/STACK.md` — Node/TypeScript/pnpm stack, current `node-pty` version, bin/package state.
- `.planning/codebase/ARCHITECTURE.md` — current CLI-started Gateway process model and session ownership limits.
- `.planning/codebase/INTEGRATIONS.md` — registry, HTTP/WS API, storage, and launch/runtime integration points.

### Implementation Entry Points
- `apps/cli/src/main.ts` — provider commands, `gateway` command, inline session creation, attach logic, and CLI output.
- `apps/gateway/src/daemon.ts` — HTTP/WS Gateway runtime, registry heartbeat, Relay client startup, and missing `POST /api/sessions` creation endpoint.
- `apps/gateway/src/pty.ts` — `PtySessionManager.create`, live PTY ownership, write/resize/stop behavior.
- `apps/gateway/src/store.ts` — session/event persistence and `~/.tether/tether.db`.
- `apps/gateway/src/registry.ts` — `~/.tether/gateways.json` live Gateway registry.
- `bin/tether` — repo-root executable entry that can be used for local global command installation.
- `package.json` — root `bin` and `pnpm tether` scripts.
- `apps/cli/package.json` — CLI package bin metadata.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PtySessionManager.create` can already create Gateway-owned PTY sessions when called inside a persistent Gateway process.
- `Store` already persists sessions and append-only events under `~/.tether/tether.db`.
- `startDaemon` already accepts a shared `Store`, optional `PtySessionManager`, and optional Relay config.
- `registry.ts` already records live Gateways in `~/.tether/gateways.json`; it can be reused for discovery/status, but CLI probing must still verify HTTP connectivity.
- `bin/tether` already provides a root executable using `node --import tsx`; Phase 6 can make local/global invocation reliable without npm registry publication.

### Established Patterns
- Commands are implemented with `commander` in `apps/cli/src/main.ts`.
- Runtime code is TypeScript ESM run directly with `tsx`; there is no compiled `dist` for CLI/Gateway.
- Gateway defaults to `127.0.0.1`; non-loopback exposure must remain explicit.
- Subprocess calls must use list-form args and must not use `shell:true`.
- User-facing output currently has English strings; Phase 6 should localize new Gateway lifecycle/status output to Chinese.

### Integration Points
- Add Gateway-side `POST /api/sessions` or equivalent internal API so a persistent Gateway can create PTY sessions on behalf of CLI commands. This endpoint should be disabled by default via config and, when enabled, must accept only whitelisted provider names.
- Refactor CLI provider startup so it can either forward to a persistent Gateway or run inline via `--inline` / fallback.
- Add config read/write helpers around `~/.tether/config.json`.
- Add launchd helper code for plist install/uninstall/start/stop/restart/status.
- Extend status to combine launchd state, registry records, Gateway HTTP health, and Relay connectivity where available.

### Feasibility Notes
- The plan is feasible with existing architecture, but not purely wiring: a new session-create API is required because the current CLI creates PTY sessions before starting Gateway. The API must be config-gated by default and whitelist-only when enabled.
- Background mode should use launchd to avoid two supervisor systems. This keeps crash restart and login startup aligned.
- `gateway start` can automatically create/update the plist before starting, so the user does not need to run `gateway install` first.
- Relay status may need a small runtime health surface from `relay-client.ts`; if exact connection state is low-cost, implement precise connected/disconnected status in Phase 6.

</code_context>

<specifics>
## Specific Ideas

- Daily command model:
  - `tether gateway` — foreground Gateway for development/manual verification.
  - `tether gateway config ...` — write `~/.tether/config.json`.
  - `tether gateway install` — register login startup only.
  - `tether gateway start` — start Gateway in background.
  - `tether gateway stop` — stop background Gateway.
  - `tether gateway restart` — restart background Gateway.
  - `tether gateway status` — Chinese status output.
  - `tether codex` — normal daily session creation through persistent Gateway when available.
  - `tether codex --inline` — forced old inline mode for debugging.
- The user wants Gateway commands and status output in Chinese.
- The user wants local global command behavior to work on their Mac; npm registry publishing is not required now.

</specifics>

<deferred>
## Deferred Ideas

- npm registry publication and packaged distribution.
- Phase 4 device-token pairing, device management, and auth enforcement.
- Phase 5 retention, WAL checkpoint scheduling, and storage cleanup.
- Phase 3 tmux fallback deletion.
- Hosted Relay service, multi-user accounts, push, federation, and E2EE relay envelopes.

</deferred>

---

*Phase: 6-Supervisor & launchd*
*Context gathered: 2026-05-01*
