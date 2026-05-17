# Phase 20 Spec: Approvals Inbox and Structured Action Gate

## Intent

Merge the useful approval workflow from Mission Control into Tether itself. The feature should feel like a simple Tether tab next to Chats and Terminal, not a separate team platform.

## Source projects

- Mission Control contributes the approval inbox product shape: pending cards, risk badges, command/tool preview, approve/reject/revise, policy verdicts, and audit trail.
- Tether contributes the correct runtime boundary: Gateway owns execution, Relay routes authenticated frames, Server persists state, Web/App are attach surfaces.

## Core decision

MVP approvals are structured-action approvals, not raw terminal text interception. Existing chat `agent.permission_request` is the first reliable signal. Raw PTY sessions can show approval cards only when a provider-specific structured signal is available later.

## In scope

- `/approvals` route in `apps/web`.
- Workbench sidebar tab model extended from `chats | terminal` to include `approvals`.
- Shared protocol types for approval requests, decisions, source, status, and risk.
- Server persistence and ownership-scoped HTTP APIs.
- Relay broadcasts for approval create/update.
- Gateway decision bridge back to provider permission flow.
- Audit rows for create, approve, reject, expire, and block.
- Mobile-friendly cards and actions.

## Out of scope

- Full Mission Control team gateway.
- Company fleet/RBAC matrix.
- Billing, dogfood metrics, boss pitch, commercial gate.
- Native push notifications.
- Generic raw PTY command approval.

## Data model

`ApprovalRequest` should include:

- `id`
- `accountId`, `workspaceId`, `gatewayId`, `sessionId`, `userId`
- `source`: `chat_permission | provider_action | diff | handoff`
- `status`: `pending | approved | rejected | expired | blocked`
- `risk`: `low | medium | high | critical`
- `title`, `summary`, `reason`
- `toolName`
- `inputPreview`
- `inputHash`
- `createdAt`, `updatedAt`, `expiresAt`
- `decidedBy`, `decidedAt`

## UX contract

Approvals tab has:

- Pending list first.
- History list below or behind a filter.
- Cards showing provider/session/cwd, risk, reason, preview, and decision buttons.
- Empty state: "No approvals need your attention."
- Decision state updates optimistically but reconciles with Server result.

## Acceptance

1. A chat permission request appears in Approvals without opening that chat.
2. Approve resumes the provider action.
3. Reject denies the provider action.
4. Refreshing the browser preserves pending requests.
5. A second client sees the same pending request.
6. Duplicate decisions do not resume or reject twice.
7. Cross-account access is rejected.
8. Audit rows contain identity and request metadata but no raw tokens.
