---
phase: 21
plan: "01"
type: execute
wave: 1
depends_on:
  - phase-20-approvals-inbox-structured-action-gate
files_modified:
  - apps/web/src/components/terminal/*
  - apps/web/src/components/chats/*
  - apps/web/src/components/workbench/*
  - apps/web/src/components/relay/*
  - apps/web/src/i18n/messages.ts
  - apps/cli/src/*
autonomous: true
requirements:
  - MOBILE-ACTION-01
  - MOBILE-ACTION-02
  - MOBILE-ACTION-03
  - MOBILE-DIAG-01
  - MOBILE-DIAG-02
---

<objective>
Add Tether-native mobile quick actions, guarded terminal shortcuts, session action drawer, keyboard-safe layout, and diagnostics.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/phases/21-mobile-quick-actions-diagnostics/21-SPEC.md

Important current implementation points:
- Terminal UI lives around `apps/web/src/components/terminal/terminal-pane.tsx`.
- Terminal launch shortcuts currently only choose providers.
- Chat slash commands already exist and can seed insert-only chat actions.
- RelayClientProvider already has useful connection state; expose it safely for diagnostics.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Define quick action contract</name>
  <files>apps/web/src/components/workbench/*, apps/web/src/components/terminal/*, apps/web/src/components/chats/*</files>
  <action>
Create a reusable quick action descriptor model with target surface, label, shortcut payload, safety level, and handler. Terminal handlers emit existing Relay frames; chat handlers insert text or navigate.
  </action>
  <done>
    - Shared action model exists.
    - Actions cannot execute unauthorized server-side work directly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add terminal mobile dock</name>
  <files>apps/web/src/components/terminal/*</files>
  <action>
Mount a mobile-friendly dock in the Terminal surface with Esc, Tab, arrows, Enter, Ctrl-C, guarded Ctrl-D, paste, resize/reflow, detach, stop, and observe/control.
  </action>
  <done>
    - Actions send the expected `client.input` or session control frames.
    - Ctrl-D requires confirmation.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add chat quick actions</name>
  <files>apps/web/src/components/chats/*</files>
  <action>
Add chat action chips/drawer that insert slash commands and common prompts. Add current-session approval shortcut if Phase 20 exposes pending approval state.
  </action>
  <done>
    - Chat actions insert text instead of hidden execution.
    - Pending approval shortcut navigates to the correct approval card.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add diagnostics panel</name>
  <files>apps/web/src/components/relay/*, apps/web/src/components/workbench/*</files>
  <action>
Expose a user-readable diagnostics panel showing auth, Relay, Gateway, selected Gateway, active controller, last event sequence, reconnect stage, history API status, and recent errors.
  </action>
  <done>
    - Offline Gateway and Relay disconnect are distinguishable.
    - No secrets/tokens are displayed.
  </done>
</task>

<task type="auto">
  <name>Task 5: Add pairing/debug command or screen</name>
  <files>apps/cli/src/*, apps/web/src/components/workbench/*</files>
  <action>
Add a Tether-native QR/deep-link pairing or debug matrix flow that uses short-lived device trust and checks Server, Relay WS, Gateway online, event resume, and route scope.
  </action>
  <done>
    - Pair/debug payloads expire.
    - Long-lived raw tokens are not exposed in URLs.
  </done>
</task>

<task type="manual">
  <name>Human UAT</name>
  <action>
Use a phone browser to operate a terminal session, open keyboard, send shortcuts, test guarded Ctrl-D, disconnect/reconnect Gateway or Relay, and confirm diagnostics explain the failure.
  </action>
</task>

</tasks>
