---
phase: 22
plan: "01"
type: execute
wave: 1
depends_on:
  - phase-21-mobile-quick-actions-diagnostics
files_modified:
  - docs/current/*
  - native/flutter/*
  - apps/web/public/*
  - packages/protocol/*
autonomous: true
requirements:
  - APP-SHELL-01
  - APP-SHELL-02
  - APP-SHELL-03
  - APP-SHELL-04
  - APP-SHELL-05
  - APP-SHELL-06
---

<objective>
Create and start the unified app-shell architecture: Web/PWA canonical UI, Flutter mobile native path, and Tauri-first desktop shell strategy.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/phases/22-unified-app-shell-architecture/22-SPEC.md

Important current implementation points:
- `native/flutter/lib/main.dart` is currently only a demo shell.
- `native/flutter/pubspec.yaml` has minimal dependencies.
- `apps/web` is the mature UI and should remain canonical until app protocol parity is proven.
- `packages/protocol` is the TypeScript source of truth.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write app-shell contract</name>
  <files>docs/current/*</files>
  <action>
Create a contract mapping Web/PWA, Flutter, and desktop shell responsibilities. Include screen map, API map, protocol generation path, auth storage rules, diagnostics, security boundaries, and Electron fallback criteria.
  </action>
  <done>
    - Contract states Gateway remains execution owner.
    - Contract states clients cannot spawn arbitrary commands or own auth decisions.
  </done>
</task>

<task type="auto">
  <name>Task 2: Harden PWA shell</name>
  <files>apps/web/public/*</files>
  <action>
Review manifest/service worker/install behavior. Ensure sensitive API/session/terminal payloads are not cached incorrectly and mobile install UX is documented.
  </action>
  <done>
    - PWA install works.
    - Service worker cache rules avoid sensitive runtime payloads.
  </done>
</task>

<task type="auto">
  <name>Task 3: Rebuild Flutter foundation around current protocol</name>
  <files>native/flutter/*, packages/protocol/*</files>
  <action>
Add or document generated/derived Dart protocol types, secure token storage, HTTP client, refresh flow, and Relay WS state machine.
  </action>
  <done>
    - Flutter no longer uses a demo-only app shell.
    - Flutter protocol is derived from `packages/protocol` or an explicit bridge.
  </done>
</task>

<task type="auto">
  <name>Task 4: Add Flutter product screens</name>
  <files>native/flutter/lib/*</files>
  <action>
Implement Login, Gateway selector, Chats, Terminal, Approvals, and Settings/Diagnostics screens against Server/Relay APIs. Terminal may use a documented degraded renderer if full xterm parity is not yet possible.
  </action>
  <done>
    - User can log in, list sessions, open chat, open terminal, decide approval, and inspect diagnostics.
  </done>
</task>

<task type="manual">
  <name>Human UAT</name>
  <action>
Run the Flutter verification build on phone/emulator and open the same account/session as Web. Confirm chat, terminal, approvals, and diagnostics match Web behavior.
  </action>
</task>

</tasks>
