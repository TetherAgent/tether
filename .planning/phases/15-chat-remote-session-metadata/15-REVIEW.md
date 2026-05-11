---
phase: 15
status: warning
depth: inline-standard
reviewed_at: 2026-05-11T05:50:00Z
---

# Phase 15 Code Review

## Findings

### Warning: `session.agent-id-updated` can race ahead of `gateway.chat-session-created`

**Files:** `apps/gateway/src/chat-session-runner.ts`, `apps/gateway/src/relay-client.ts`, `apps/relay/src/relay.ts`

`ChatSessionRunner.createChatSession()` calls `onChatSessionCreated()` before spawning the provider, but there is no acknowledgement from Relay/Server before the provider starts. If a provider emits an agent session id very quickly, `relay-client` can send `session.agent-id-updated` before Relay has completed `gateway.chat-session-created` handling and populated `latestSessions`.

Relay currently builds PATCH scope with:

- `accountId`: `gatewayScope.accountId`
- `gatewayId`: `gatewayScope.gatewayId ?? frame.gatewayId`
- `userId`: `latestSessions.get(sessionId)?.userId ?? gatewayScope.userId ?? ''`

If `latestSessions` is not populated yet and the Gateway token scope has no `userId`, the first PATCH will use an empty `userId` and silently affect zero rows. A later result-path update may repair this for providers that emit agent id more than once, but that is provider-dependent.

**Suggested follow-up:** Include `userId` in the `session.agent-id-updated` event payload from Gateway when known, or queue agent id updates until `gateway.chat-session-created` has been acknowledged.

## Checks

- Protocol/server/gateway/relay typechecks passed.
- Phase15-focused Gateway tests passed.
- Phase15-focused Relay tests passed.

## Residual Test Risk

Full suites still have unrelated pre-existing failures recorded in `15-P05-SUMMARY.md`; those should be addressed before treating the whole milestone as regression-clean.
