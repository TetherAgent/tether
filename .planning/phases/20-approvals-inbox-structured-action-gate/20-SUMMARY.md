# Phase 20 Summary: Approvals Inbox and Structured Action Gate

## Outcome

Automated implementation is complete. Tether now has a first-class Approvals route and workbench tab, durable Server approval storage, Relay approval broadcasts, and a decision path back to the Gateway permission flow.

## Delivered

- Added shared approval protocol types in `packages/protocol/src/index.ts`.
- Added Server approval persistence, SQL migration, controller routes, ownership-scoped repository methods, and runtime-sync whitelist coverage.
- Added Relay handling for approval created/updated/decision frames.
- Added Web `/approvals` route, sidebar tab, approval list/cards, approve/reject actions, and localized copy.
- Preserved the explicit scope boundary: this covers structured chat/provider permission requests, not generic raw PTY command interception.

## Verification

- `pnpm typecheck` passed after integration with latest `origin/main`.
- Relay tests cover approval routing behavior.
- Server runtime-sync whitelist test covers the approvals sync route.

## Remaining UAT

Human UAT is still needed with a real provider permission request: trigger an approval, decide from another browser/device, and confirm the provider resumes or rejects exactly once.
