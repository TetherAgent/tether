---
phase: 20
plan: "01"
type: execute
wave: 1
depends_on:
  - phase-18-remove-local-sqlite
files_modified:
  - packages/protocol/src/index.ts
  - apps/server/sql/*
  - apps/server/app/router.ts
  - apps/server/app/controller/*
  - apps/server/app/service/*
  - apps/relay/src/relay.ts
  - apps/gateway/src/chat/chat-runtime.ts
  - apps/web/src/routes.tsx
  - apps/web/src/components/workbench/*
  - apps/web/src/pages/*
autonomous: true
requirements:
  - APPROVAL-01
  - APPROVAL-02
  - APPROVAL-03
  - APPROVAL-04
  - APPROVAL-05
  - APPROVAL-06
---

<objective>
Implement the first Tether-native approval workflow: protocol contract, durable Server state, Relay broadcast, Gateway permission-response bridge, and Web Approvals tab.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/phases/20-approvals-inbox-structured-action-gate/20-SPEC.md

Important current implementation points:
- `packages/protocol/src/index.ts` already has `agent.permission_request` and `client.permission_response`.
- `apps/web/src/routes.tsx` currently exposes `/chats` and `/terminal`.
- `apps/web/src/components/workbench/types.ts` currently defines `WorkbenchSidebarTab = 'chats' | 'terminal'`.
- `apps/web/src/components/chats/messages/permission-prompt.tsx` is the current inline prompt UI.
- Relay already forwards `agent.permission_request` and `client.permission_response`; this phase makes them durable and global.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add approval protocol contract</name>
  <files>packages/protocol/src/index.ts</files>
  <action>
Add shared `ApprovalRequest`, `ApprovalDecision`, `ApprovalStatus`, `ApprovalRisk`, and approval source types. Add Relay frames for approval created/updated broadcasts if direct Server HTTP polling is insufficient. Preserve existing chat frames.
  </action>
  <done>
    - Types compile.
    - Existing `agent.permission_request` and `client.permission_response` remain backward compatible.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add Server approval persistence and APIs</name>
  <files>apps/server/sql/*, apps/server/app/router.ts, apps/server/app/controller/*, apps/server/app/service/*</files>
  <action>
Add approval tables and APIs for list pending/history and decide approve/reject. Scope every read/write by account/workspace/gateway/session ownership. Write audit rows for create and decision. Never store raw tokens.
  </action>
  <done>
    - Pending requests survive refresh.
    - Decision endpoint is idempotent.
    - Cross-account reads/writes are rejected.
  </done>
</task>

<task type="auto">
  <name>Task 3: Bridge chat permission requests into approval lifecycle</name>
  <files>apps/gateway/src/chat/chat-runtime.ts, apps/relay/src/relay.ts</files>
  <action>
When a chat `agent.permission_request` is emitted, create/sync a Server approval request and broadcast it to authorized clients. When a decision is made, forward it back as `client.permission_response` to the owning Gateway.
  </action>
  <done>
    - Approve resumes the blocked provider action.
    - Reject denies the provider action.
    - Duplicate decisions do not send duplicate permission responses.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add Web Approvals tab</name>
  <files>apps/web/src/routes.tsx, apps/web/src/components/workbench/*, apps/web/src/pages/*</files>
  <action>
Add `/approvals`, extend workbench tab state, update sidebar switcher to Chats / Terminal / Approvals, and build pending/history approval cards.
  </action>
  <done>
    - `/approvals` is authenticated and uses WorkbenchLayout.
    - Mobile sidebar still works.
    - Pending approval cards can approve/reject.
  </done>
</task>

<task type="manual">
  <name>Human UAT</name>
  <action>
Run a chat provider action that emits a permission request. Open Approvals on another browser/device, approve and reject separate requests, and confirm provider behavior.
  </action>
</task>

</tasks>
