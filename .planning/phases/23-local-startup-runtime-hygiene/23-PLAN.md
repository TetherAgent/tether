---
phase: 23
plan: "01"
type: execute
wave: 1
depends_on:
  - phase-18-remove-local-sqlite
files_modified:
  - package.json
  - .env.local.example
  - .gitignore
  - .nvmrc
  - scripts/dev-local.sh
  - scripts/dev-pane.sh
  - scripts/dev-stop.sh
  - scripts/start-prod.sh
  - scripts/use-nvm.sh
  - apps/cli/src/auth/gateway-login.ts
  - apps/web/src/pages/gateway-auth-page.tsx
autonomous: true
requirements:
  - DEV-RUN-01
  - DEV-RUN-02
  - DEV-RUN-03
  - DEV-RUN-04
  - DEV-RUN-05
---

<objective>
Create a reproducible local developer runtime for Tether's Server, Relay, Web, and Gateway stack.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Add local Zellij startup</name>
  <files>scripts/dev-local.sh, scripts/dev-pane.sh, package.json</files>
  <action>
Add `pnpm dev:local` that installs/uses Zellij, creates a split-pane layout, starts each service in its own pane, attaches existing live sessions, and deletes dead sessions before recreating.
  </action>
</task>

<task type="auto">
  <name>Task 2: Add runtime stop command</name>
  <files>scripts/dev-stop.sh, package.json</files>
  <action>
Add `pnpm dev:stop` that deletes the local Zellij session and stops listeners on known local dev ports.
  </action>
</task>

<task type="auto">
  <name>Task 3: Isolate local config and Node version</name>
  <files>.env.local.example, .gitignore, .nvmrc, scripts/use-nvm.sh, scripts/dev-pane.sh, scripts/start-prod.sh</files>
  <action>
Prefer NVM Node 24, keep `.env.local` and `.tether-dev-home` out of git, and prevent local Gateway login/config from touching the user's real `~/.tether`.
  </action>
</task>

<task type="auto">
  <name>Task 4: Harden local auth and Server dev mode</name>
  <files>apps/cli/src/auth/gateway-login.ts, apps/web/src/pages/gateway-auth-page.tsx, scripts/dev-pane.sh</files>
  <action>
Increase Gateway auth callback timeout, use `127.0.0.1` consistently, and clean compiled Server `.js` artifacts before TypeScript dev startup.
  </action>
</task>

</tasks>
