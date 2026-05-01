# Phase 1: Personal Relay MVP - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a personal self-hosted relay path for an existing Tether Gateway. A Mac Gateway connects outbound to a user-owned Node.js relay server, and a remote Web client connects to that relay server to list and attach to existing PTY-backed sessions. The relay is a frame forwarder only: it must not spawn commands, accept provider command/args/env, or persist terminal plaintext.

This phase must not break or replace the current LAN/localhost Gateway path. Direct Gateway access through the existing `/api` and `/api/sessions/:id/stream` paths remains valid.

</domain>

<decisions>
## Implementation Decisions

### Relay Topology
- **D-01:** Implement the relay as an independent service, expected to live under `apps/relay`.
- **D-02:** The production target for Phase 1 is the user's own Node.js server. Development may first run the relay locally as a second process to simulate Gateway -> Relay -> Web client.
- **D-03:** The Gateway must initiate an outbound WebSocket/WSS connection to the relay. Remote Web clients also connect to the relay. The relay sits in the middle and forwards frames between authenticated peers.
- **D-04:** The relay path must be additive. It must not disturb the current direct LAN/localhost Gateway behavior.

### Remote Web Entry
- **D-05:** Reuse the existing `apps/web` UI instead of creating a separate remote UI.
- **D-06:** Add a relay connection mode in the Web client's connection layer. The same session list, xterm terminal, control/observe mode, resize, and event replay concepts should work in both direct Gateway mode and relay mode.
- **D-07:** Avoid duplicating terminal UI behavior. Planning should focus on extracting/adapting the transport layer, not rebuilding the page.
- **D-08:** The public `apps/web` build is expected to be served by nginx, not by `apps/relay`. Relay should focus on authenticated relay API/WS/frame forwarding.

### MVP Security Boundary
- **D-09:** Phase 1 uses an owner-configured shared secret rather than the full device-token/pairing system.
- **D-10:** The relay server reads the secret from configuration, e.g. `TETHER_RELAY_SECRET`.
- **D-11:** The Gateway supplies the secret when connecting to the relay.
- **D-12:** The remote Web client prompts for the secret and may store it in browser `localStorage` for the MVP.
- **D-13:** The remote Web client is allowed to operate in control mode in Phase 1. It is not observe-only.
- **D-14:** Authentication failure must close/reject the relay connection. Do not silently downgrade to limited access.
- **D-15:** Full device-token auth and pairing remain Phase 4 work. Phase 1 should be designed so relay-routed writes can later reuse the same auth checks as direct writes.

### Relay Protocol Contract
- **D-16:** Upgrade `packages/protocol` from placeholder `RelayFrame` types into a formal relay contract.
- **D-17:** The contract should clearly separate Gateway<->Relay and Client<->Relay frame directions.
- **D-18:** The Phase 1 contract should cover auth/register, client auth, session list/metadata, subscribe with cursor, replay completion, terminal events, input, resize, control/observe mode, error frames, and reconnect/cursor continuation.
- **D-19:** Do not over-design future production features such as hosted accounts, federation, push, or end-to-end encrypted relay envelopes. Keep the protocol extensible but implement only the MVP frames needed for personal relay use.

### the agent's Discretion
- Choose exact command names, flag names, and internal module boundaries in sympathy with existing CLI/Gateway patterns.
- Choose whether relay mode is selected by URL, config, or a small UI prompt, as long as the same `apps/web` UI is reused and local Gateway mode remains unchanged.
- Choose the minimal reconnect behavior needed to survive transient relay disconnects without turning Phase 1 into a full high-availability relay system.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, and phase dependencies.
- `.planning/REQUIREMENTS.md` — `RELAY-01` requirement and explicit v0.3 out-of-scope boundaries.
- `.planning/PROJECT.md` — active milestone context, security constraints, and product positioning.
- `.planning/STATE.md` — current decisions and deferred items.
- `AI_CONTEXT.md` — long-term architecture context, relay safety constraints, and current implementation limits.

### Current Implementation References
- `.planning/codebase/STACK.md` — Node/TypeScript workspace, dependency constraints, and available packages.
- `.planning/codebase/ARCHITECTURE.md` — current Gateway, WebSocket stream, session_events replay, and Web client architecture.
- `.planning/codebase/INTEGRATIONS.md` — existing direct HTTP/WS integration points and the current placeholder relay note.
- `packages/protocol/src/index.ts` — current placeholder `RelayFrame` union to replace or expand into the formal contract.
- `apps/gateway/src/daemon.ts` — direct Gateway HTTP/WS session stream behavior to bridge through relay mode.
- `apps/web/src/main.tsx` — existing session list and xterm client behavior to reuse.
- `apps/cli/src/main.ts` — existing command/flag patterns for Gateway startup and provider sessions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/gateway/src/daemon.ts`: already implements one-shot WS tickets, session replay, live event forwarding, input, resize, and control/observe semantics for direct clients.
- `apps/gateway/src/pty.ts`: owns PTY input/output, masks persisted input/output, and publishes `SessionEvent` records to subscribers.
- `apps/web/src/main.tsx`: already contains session list, terminal attach, xterm rendering, cursor replay, WebSocket streaming, HTTP fallback, control/observe selection, and resize handling.
- `packages/protocol/src/index.ts`: provides the natural place for a formal relay frame contract.

### Established Patterns
- The repo is a pnpm workspace with TypeScript ESM packages and direct `tsx` execution.
- Runtime services are Node.js processes using `ws` and Hono-adjacent HTTP/WS patterns.
- Session history is append-only through `session_events`; late joiners replay by cursor before receiving live output.
- Security-critical behavior avoids arbitrary command execution. Clients may only send input to existing Gateway-owned sessions.
- Terminal output and stored user input must be masked before persistence/broadcast according to existing Gateway patterns.

### Integration Points
- Add `apps/relay` as a workspace app.
- Add Gateway relay-client logic without breaking direct Gateway HTTP/WS serving.
- Add Web relay mode in the connection layer while reusing terminal/session UI. The built Web app is served by nginx in the user's deployment.
- Expand `packages/protocol` into shared relay frame types consumed by Gateway, Relay, and Web.

</code_context>

<specifics>
## Specific Ideas

- The user has their own Node.js server and wants the relay deployable there.
- The user serves `apps/web` through nginx; `apps/relay` should not be planned as the static Web host.
- Local development may simulate the relay as a separate local process before deploying to the real server.
- The desired topology is: local computer/Gateway -> relay server -> remote client.
- The user wants a formal protocol contract, not an ad hoc one-off relay implementation.

</specifics>

<deferred>
## Deferred Ideas

- Hosted relay service, multi-user accounts, billing, control plane, and production operations.
- End-to-end encrypted relay envelopes.
- Push notifications.
- Federation and multi-machine trust.
- Full device-token/pairing auth integration for relay-routed writes, owned by Phase 4.

</deferred>

---

*Phase: 1-Personal Relay MVP*
*Context gathered: 2026-05-01*
