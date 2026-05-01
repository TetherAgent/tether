---
phase: 01-personal-relay-mvp
verified: 2026-05-01T14:32:38Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed:
    - "Gateway outbound WSS URL normalization now preserves wss://, converts https:// to wss://, converts http:// to ws://, and avoids duplicate /gateway."
  gaps_remaining: []
  regressions: []
residual_risk:
  - "Real Node server E2E was not run because this environment has no deployed relay URL/secret; local automated relay/Gateway/Web frame-path checks passed."
---

# Phase 1: Personal Relay MVP Verification Report

**Phase Goal:** A solo user can run a self-hosted Relay, connect the local Gateway to it over outbound WSS, open the remote Web client, and control an existing PTY session through the relay without exposing the Gateway directly.
**Verified:** 2026-05-01T14:32:38Z
**Status:** passed
**Re-verification:** Yes - after Gateway outbound WSS URL gap closure.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | RELAY-01 is covered by Phase 1 | VERIFIED | `.planning/ROADMAP.md` maps Phase 1 to RELAY-01; `.planning/REQUIREMENTS.md` defines RELAY-01 as Gateway outbound WSS + remote Web relay control + relay safety boundaries. |
| 2 | `apps/relay` exists as a minimal Node/TypeScript service with owner secret auth | VERIFIED | `apps/relay/package.json` defines `@tether/relay`; `apps/relay/src/main.ts` requires `TETHER_RELAY_SECRET`; `apps/relay/src/relay.ts` exposes `/healthz`, `/gateway`, and `/client`. |
| 3 | Relay authenticates Gateway/client, forwards in memory, does not serve Web, and does not persist terminal plaintext | VERIFIED | Relay state is in `Map`s in `apps/relay/src/relay.ts`; auth rejects bad or missing secrets with 1008; no fs/database/static Web serving exists in `apps/relay`. |
| 4 | Relay never spawns commands and rejects provider command/args/env-shaped payloads | VERIFIED | Protocol has no process creation fields; `apps/relay/src/relay.ts` rejects `command`, `args`, `argv`, `env`, `providerCommand`; `rg "spawn\\(" apps/relay` has no matches. |
| 5 | Gateway relay client is optional and supports session register/replay/live/input/resize/detach | VERIFIED | `apps/gateway/src/daemon.ts` starts `startRelayClient()` only when `options.relay` exists; `apps/gateway/src/relay-client.ts` handles list, subscribe, replay, live events, input, resize, detach, and reconnect. |
| 6 | Gateway outbound relay URL handling satisfies WSS deployment requirements | VERIFIED | `apps/gateway/src/relay-client.ts` preserves `wss:`, converts `https:` to `wss:`, converts `http:` to `ws:`, rejects other schemes, strips query/hash, and avoids duplicate `/gateway`; spot-check and test both pass. |
| 7 | Web relay mode reuses the existing UI and keeps the secret out of URLs | VERIFIED | `apps/web/src/main.tsx` has direct/relay modes, password secret input, `client.auth/list/subscribe/input/resize/detach` frames, and `buildRelayClientUrl()` clears search/hash. Secret is sent only in auth frames. |
| 8 | nginx Chinese deployment docs and verification records are correct | VERIFIED | `docs/current/relay-mvp.md` documents nginx serving `apps/web`, Node `apps/relay` owning `/gateway` and `/client`, Gateway using bare `wss://relay.example.com`, Phase 4 auth caveat, local E2E, and server E2E not run. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/protocol/src/index.ts` | Shared relay protocol contract | VERIFIED | Directional frame unions exist; no `command:`, `args:`, or `env:` fields. |
| `apps/relay/src/relay.ts` | Standalone relay runtime | VERIFIED | Authenticated `/gateway` and `/client`, in-memory forwarding, no Web static serving, no persistence. |
| `apps/relay/src/relay.test.ts` | Relay behavior tests | VERIFIED | 7 tests cover auth rejection, forwarding, observe/unsubscribed rejection, invalid resize, and command-shaped rejection. |
| `apps/gateway/src/relay-client.ts` | Gateway outbound relay bridge | VERIFIED | Optional WSS client, session registration, replay/live event forwarding, write/resize/detach handling, bounded reconnect, corrected URL normalization. |
| `apps/gateway/src/relay-client.test.ts` | Gateway relay bridge tests | VERIFIED | Includes `gateway relay URL preserves wss and avoids duplicate gateway path` plus registration/replay/live/input/resize/observe/unsubscribed/invalid-resize tests. |
| `apps/gateway/src/daemon.ts` | Optional relay lifecycle wiring | VERIFIED | Relay starts only with relay config and closes with daemon. |
| `apps/cli/src/main.ts` | Relay CLI/env configuration | VERIFIED | Provider, `run`, and `gateway` commands expose `--relay-url`/`--relay-secret` with `TETHER_RELAY_URL`/`TETHER_RELAY_SECRET` fallback. |
| `apps/web/src/main.tsx` | Existing Web UI with relay mode | VERIFIED | Direct and relay modes share session list and PTY session view; relay frames are wired. |
| `docs/current/relay-mvp.md` | Chinese nginx + Node relay deployment doc | VERIFIED | Documents the correct service split and Gateway/Web URL shape without `/gateway` or `/client` duplication in examples. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| CLI | Gateway daemon relay config | `relayConfig()` passed to `startDaemon()` | VERIFIED | Flags/env are collected in `apps/cli/src/main.ts` and passed to provider, `run`, and `gateway` startup paths. |
| Gateway daemon | Relay client | `startRelayClient()` | VERIFIED | Optional lifecycle wiring in `apps/gateway/src/daemon.ts`. |
| Gateway relay client | Relay `/gateway` | `new WebSocket(relayGatewayUrl(options.url))` | VERIFIED | Spot-check: `wss://relay.example.com -> wss://relay.example.com/gateway`; already-suffixed `/gateway` is not duplicated. |
| Relay client frames | Existing PTY sessions | `store.listEvents()`, `ptySessions.subscribe/write/resize()` | VERIFIED | Tests verify replay, live output, `/bin/cat` input, resize, observe blocking, and unsubscribed blocking. |
| Web relay mode | Relay `/client` | `buildRelayClientUrl()` + `client.auth/list/subscribe/input/resize/detach` | VERIFIED | Secret is not added to query strings; relay WebSocket uses auth frames. |
| Relay | Web static serving | no route | VERIFIED | Relay exposes only `/healthz`, `/gateway`, and `/client`; docs assign static Web serving to nginx. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `apps/relay/src/relay.ts` | `latestSessions`, client subscriptions | `gateway.sessions`, `client.subscribe`, `gateway.event` frames | Yes | FLOWING - verified by relay tests. |
| `apps/gateway/src/relay-client.ts` | `RelaySession[]`, `RelayTerminalEvent[]` | `store.listSessions()`, `store.listEvents()`, `ptySessions.subscribe()` | Yes | FLOWING - gateway relay tests verify replay/live/output/input/resize. |
| `apps/web/src/main.tsx` | `sessions`, terminal events | direct `/api/*` or relay `sessions/event/replay.done` frames | Yes | FLOWING - frame wiring and typecheck verified; browser click-through remains residual manual risk. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full typecheck | `pnpm typecheck` | exited 0 | PASS |
| Full tests | `pnpm test` | relay 7/7 and gateway 19/19 tests passed | PASS |
| Gateway WSS URL normalization | `pnpm exec tsx -e "import { relayGatewayUrl } ..."` | `wss://relay.example.com -> wss://relay.example.com/gateway`; `wss://relay.example.com/gateway -> wss://relay.example.com/gateway`; `https://relay.example.com -> wss://relay.example.com/gateway`; `http://127.0.0.1:4889 -> ws://127.0.0.1:4889/gateway` | PASS |
| Code review status | Read `.planning/phases/01-personal-relay-mvp/01-REVIEW.md` | `status: clean`, 0 critical/warning/info findings | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| RELAY-01 | Plans 01-04 | Gateway outbound WSS to self-hosted Relay; remote Web list/attach/control; Relay forwards only authenticated protocol frames and stores no plaintext | SATISFIED | Protocol, Relay, Gateway bridge, Web mode, docs, and tests exist and are wired; previous WSS URL gap is closed. |

No orphaned Phase 1 requirements found: `.planning/REQUIREMENTS.md` maps only RELAY-01 to Phase 1.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| None | - | - | - | No blocker or warning anti-pattern found in Phase 1 relay/Gateway/Web/doc verification scope. |

### Human Verification / Residual Risk

1. Real Node server E2E remains unrun.

   **Test:** Deploy `apps/relay` behind the user's nginx/TLS setup, start Gateway with real `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`, then verify remote Web list/attach/output/input/resize/control.

   **Expected:** Browser can use relay mode through the public `wss://` URL and control an existing PTY session without direct Gateway exposure.

   **Why residual risk, not a blocker:** Code and local automated frame-path checks pass, including WSS URL normalization. The only missing input is a real server URL/secret in this environment; `docs/current/relay-mvp.md` records this as `server E2E not run`.

2. Browser click-through remains manual.

   **Test:** In nginx-served `apps/web`, choose Relay mode, enter relay URL/secret, attach to a live session, switch control/observe, type input, and resize the terminal.

   **Expected:** UI behaves consistently with the tested frame path and displays relay output/input/resize state correctly.

   **Why residual risk, not a blocker:** The repository has no browser automation dependency for this path; Web relay mode typechecks and the underlying relay/Gateway protocol behavior is covered by automated tests.

### Gaps Summary

No code or documentation gaps remain for Phase 1. The previous Gateway outbound WSS URL blocker is closed by `cd6837a fix(01): preserve relay wss urls`, verified in code, tests, docs, and a direct spot-check. Real Node server E2E is still a deployment residual risk, not an automatic verification blocker.

---

_Verified: 2026-05-01T14:32:38Z_
_Verifier: the agent (gsd-verifier)_
