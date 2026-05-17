# Phase 23 Spec: Local Startup and Runtime Hygiene

## Intent

Make Tether easy to run locally as a multi-process product while preserving production safety and developer machine isolation.

## In scope

- One-command local startup for Server, Relay, Web, and Gateway.
- Zellij split-pane layout with per-service logs.
- One-command local shutdown that kills the Zellij session and known dev port listeners.
- `.env.local` support with fallback to shared development `env.sh`.
- NVM Node 24 preference for all startup scripts.
- Isolated dev Gateway home under `.tether-dev-home`.
- Server cleanup before TypeScript dev mode to avoid `.js`/`.ts` duplicate Egg loader failures.
- Longer local Gateway authorization callback timeout.

## Out of scope

- Local MySQL provisioning.
- Production process supervision replacement.
- Killing arbitrary user processes unrelated to Tether's known local dev ports.

## Acceptance

1. `pnpm dev:local` opens or attaches a Zellij session named `tether-dev`.
2. Existing live sessions attach instead of failing; dead sessions are deleted and recreated.
3. `pnpm dev:stop` stops the Zellij session and listeners on ports 4800, 4889, 4790, and 4799.
4. Scripts use NVM Node 24 when available.
5. Local Gateway auth/config lives under `.tether-dev-home`.
6. Server dev startup removes compiled `.js` artifacts before Egg loads TypeScript files.
