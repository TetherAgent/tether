# Phase 1: Personal Relay MVP - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 1-Personal Relay MVP
**Areas discussed:** Relay topology, Remote Web entry, MVP security boundary, Relay protocol contract

---

## Relay Topology

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway -> relay server -> client | Local Gateway connects outbound to a user-owned relay; remote clients also connect to that relay. | ✓ |
| Relay inside current Gateway | Fold relay behavior into current Gateway process and expose it directly. | |
| Planner decides | Only lock the product goal and leave process topology open. | |

**User's choice:** Gateway on the local computer connects to a middle server, and the middle server connects clients.
**Notes:** User has a Node.js server for production. Development may first simulate the relay locally as a second process. Relay must not affect LAN/local Gateway usage.

---

## Remote Web Entry

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing Web UI with relay mode | Keep one `apps/web`; add a connection-layer relay mode. | ✓ |
| Separate `/relay` page using shared components | Reuse some terminal/session components but maintain a separate route. | |
| Minimal relay-only Web page | Build a temporary simple page and merge later. | |

**User's choice:** Reuse the existing Web UI.
**Notes:** The same session list, xterm terminal, control/observe mode, resize, and replay behavior should be reused where possible.

---

## MVP Security Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Shared secret + control allowed | Relay, Gateway, and Web client authenticate with an owner secret; remote client can control sessions. | ✓ |
| Shared secret + observe only | Remote clients can view output but cannot send input until full device-token auth exists. | |
| Stricter temporary code | Add an extra one-time code or URL token on top of the shared secret. | |

**User's choice:** Shared secret with control allowed.
**Notes:** Phase 1 should use `TETHER_RELAY_SECRET` or equivalent for the relay server, have Gateway supply the secret on connection, and let Web prompt/store it for MVP. Full pairing/device-token auth remains Phase 4.

---

## Relay Protocol Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Formal contract + minimal implementation | Define Gateway/Client relay frames clearly and implement Phase 1 needs. | ✓ |
| Only current frames | Define only the exact frames needed immediately. | |
| Full future protocol | Design future E2EE/federation/push protocol up front. | |

**User's choice:** Formal contract + minimal implementation.
**Notes:** `packages/protocol` should become a real relay contract covering auth/register, session list, subscribe with cursor, event/replay, input, resize, control/observe, error, and reconnect/cursor continuation.

---

## the agent's Discretion

- Exact command and flag names.
- Exact relay mode selection mechanism in Web UI, as long as one `apps/web` is reused.
- Minimal reconnect policy details.

## Deferred Ideas

- Hosted relay service and multi-user accounts.
- End-to-end encrypted relay envelopes.
- Push notifications.
- Federation and multi-machine trust.
- Full device-token/pairing auth for relay-routed writes.
