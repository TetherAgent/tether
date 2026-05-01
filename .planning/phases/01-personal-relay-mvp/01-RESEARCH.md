# Phase 1: Personal Relay MVP - Research

**Date:** 2026-05-01
**Status:** Complete

## Phase Goal

Deliver a personal relay path where a Mac Gateway connects outbound to a user-owned Node.js relay server, and a remote Web client connects to that relay to list and control existing PTY-backed sessions. The relay must only forward authenticated protocol frames and must not serve `apps/web` static files; the user's deployment serves `apps/web/dist` through nginx.

## Key Findings

### Existing Gateway Stream Is the Right Source of Truth

The direct Gateway stream in `apps/gateway/src/daemon.ts` already has the semantics Phase 1 needs:

- session list via `GET /api/sessions`
- event replay via `GET /api/sessions/:id/events?after=...`
- live stream frames via `/api/sessions/:id/stream`
- control/observe mode
- input and resize writes
- `client.attached`, `client.detached`, and `client.control_changed` audit events

Relay should bridge this model rather than inventing a parallel session state model. The Gateway remains the session owner; Relay forwards between Gateway and client.

### Relay Should Be a Workspace App, Not a Gateway Mode

`apps/*` is already included in `pnpm-workspace.yaml`, and services run via TypeScript/tsx. A new `apps/relay` can follow existing package patterns:

- `package.json` with `"type": "module"`
- `tsconfig.json` extending `../../tsconfig.base.json`
- `src/*.ts` source files
- `tsx --test src/*.test.ts` test script

Keeping Relay separate avoids changing direct Gateway binding behavior and keeps the public server from owning local PTY handles.

### Protocol Package Needs Real Directional Frames

`packages/protocol/src/index.ts` currently contains a placeholder `RelayFrame` union. Phase 1 should replace it with directional frame types:

- Gateway -> Relay: register, sessions update, event, replay response, error
- Relay -> Gateway: auth accepted/rejected, client subscribe, input, resize, disconnect
- Client -> Relay: auth, list sessions, subscribe, input, resize
- Relay -> Client: auth accepted/rejected, sessions, hello, replay events, live event, replay.done, error

The contract should remain JSON-serializable and use literal union string types, matching the codebase style.

### Web Should Reuse UI Through a Connection Adapter

`apps/web/src/main.tsx` currently fetches direct `/api/...` paths inline. Relay mode will be easier if the implementation introduces a small API/transport adapter that exposes the same operations to UI components:

- list active/history sessions
- load snapshot or replay events
- list attached clients
- send input
- open stream
- send resize

The visual UI should stay the same. Relay mode should be selected by environment/config/URL/localStorage, not by duplicating pages.

### Security Model for MVP

Phase 1 uses an owner shared secret:

- Relay reads `TETHER_RELAY_SECRET`
- Gateway connects with the secret
- Web prompts for the secret and can store it in localStorage
- Relay rejects unauthenticated sockets immediately

The relay must reject any frame that tries to provide a provider command, argv, env, or arbitrary process creation. It only forwards input/resize/control to existing Gateway-owned session IDs.

## Suggested Implementation Shape

### Protocol

Create explicit exported types such as:

- `RelayGatewayToServerFrame`
- `RelayServerToGatewayFrame`
- `RelayClientToServerFrame`
- `RelayServerToClientFrame`
- `RelaySession`
- `RelayStreamFrame`

Include type guards/parsers only if needed by implementation. Runtime validation can stay lightweight and manual for Phase 1, matching `daemon.ts`.

### Relay Service

Use Node `http.createServer` plus `ws.WebSocketServer`:

- path `/gateway` for Gateway sockets
- path `/client` for browser/client sockets
- optional `GET /healthz` returning 200 for nginx/process checks

Keep in-memory state only:

- authenticated Gateway socket
- authenticated client sockets
- latest session list from Gateway
- subscriptions: sessionId -> client sockets

No terminal plaintext persistence in Relay.

### Gateway Relay Client

Add a relay client module to `apps/gateway` that:

- connects outbound to configured relay URL
- sends register/auth frame
- publishes session list on connect and after relevant session changes where practical
- handles client list/subscribe/input/resize requests from Relay
- reuses `Store.listSessions`, `Store.listEvents`, `Store.latestEventId`, and `PtySessionManager.subscribe/write/resize`

Expose config through CLI flags and env:

- `--relay-url <url>` or `TETHER_RELAY_URL`
- `--relay-secret <secret>` or `TETHER_RELAY_SECRET`

### Web Relay Mode

Add relay mode without splitting UI:

- keep `/remote` and `/remote/session/:id`
- Web build served by nginx
- relay URL configurable by `VITE_TETHER_RELAY_URL`, query param, or localStorage
- secret prompt stored in localStorage for MVP
- relay mode uses the same terminal/session components through an adapter

## Validation Architecture

### Unit / Integration Tests

- Protocol typecheck covers exported frame names and payload shapes.
- Relay tests use real `ws` clients:
  - unauthenticated gateway/client rejected
  - authenticated gateway registers sessions
  - authenticated client lists sessions
  - subscribe forwards replay/live event frames
  - input/resize frames are forwarded only after authenticated subscription
  - frames containing command/args/env are rejected or ignored
- Gateway relay-client tests use a real local Relay server and `/bin/cat` PTY where possible.

### Manual E2E

Run locally:

1. Start relay on one local port with `TETHER_RELAY_SECRET`.
2. Start Gateway with `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`.
3. Start an agent session or `/bin/cat`-style deterministic session.
4. Serve Web through nginx/Vite configured for relay mode.
5. Open Web, enter secret, list sessions, attach, send input, resize, and observe output.

Then repeat with relay deployed on the user's Node server.

## Risks

- Direct Gateway path regression if relay code is mixed into existing stream handling.
- Web relay mode becoming a second UI instead of an adapter.
- Relay accidentally accepting process creation frames.
- Reconnect and cursor semantics dropping output after transient disconnects.
- Browser localStorage secret is acceptable for MVP but must not be documented as final security.

## RESEARCH COMPLETE
