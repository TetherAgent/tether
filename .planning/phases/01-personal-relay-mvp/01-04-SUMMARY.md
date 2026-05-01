---
phase: 01-personal-relay-mvp
plan: 04
subsystem: ui
tags: [react, vite, relay, websocket, nginx]
requires:
  - phase: 01-personal-relay-mvp
    provides: Relay protocol, apps/relay, and Gateway relay client from Wave 1-3
provides:
  - Web relay mode in the existing apps/web UI
  - nginx plus Node relay deployment documentation
  - recorded local relay E2E verification
affects: [apps-web, relay-mvp, deployment-docs]
tech-stack:
  added: []
  patterns:
    - Existing Web UI uses a ConnectionMode setting to switch between direct Gateway and relay transports.
    - Relay browser secret is stored only in localStorage/password input and sent by client.auth frame.
key-files:
  created:
    - docs/current/relay-mvp.md
  modified:
    - apps/web/src/main.tsx
    - apps/web/src/styles.css
    - docs/README.md
    - docs/current/relay-mvp.md
key-decisions:
  - "Reused the existing SessionList/PtySessionView UI and only swapped transport behavior for relay mode."
  - "Documented apps/web as nginx-served static UI and apps/relay as Node relay only."
patterns-established:
  - "Relay URL is normalized to /client in code; relay secret never enters URL construction."
  - "Verification notes live in docs/current/relay-mvp.md under ## Verification."
requirements-completed: [RELAY-01]
duration: 5m54s
completed: 2026-05-01
---

# Phase 1 Plan 04: Web Relay Mode and End-to-End Verification Summary

**Existing React/Vite Web UI now supports direct and relay modes with documented nginx static hosting and Node relay runtime responsibilities.**

## Performance

- **Duration:** 5m54s
- **Started:** 2026-05-01T13:57:51Z
- **Completed:** 2026-05-01T14:03:45Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `ConnectionMode = 'direct' | 'relay'` to `apps/web` without creating a second UI.
- Added relay mode settings using `tether:connectionMode`, `tether:relayUrl`, and `tether:relaySecret`.
- Implemented browser relay frames for `client.auth`, `client.list`, `client.subscribe`, `client.input`, `client.resize`, and detach.
- Documented the Phase 1 deployment split: nginx serves `apps/web`; `apps/relay` runs as a Node relay service.
- Recorded local E2E smoke and server E2E skip reason in `docs/current/relay-mvp.md`.

## Task Commits

1. **Task 1: Add Web relay connection mode without duplicating UI** - `bcc2120` (feat)
2. **Task 2: Document nginx Web deployment and relay runtime** - `48093f7` (docs)
3. **Task 3: Run local and server end-to-end verification** - `a1dae18` (docs)

## Files Created/Modified

- `apps/web/src/main.tsx` - Adds direct/relay settings and relay WebSocket transport behavior.
- `apps/web/src/styles.css` - Adds compact header controls for relay URL and password secret input.
- `docs/current/relay-mvp.md` - Documents deployment, security boundary, and verification results in Chinese.
- `docs/README.md` - Adds `current/relay-mvp.md` to current docs.

## Verification Results

- `pnpm --filter @tether/protocol typecheck` - passed.
- `pnpm --filter @tether/relay test` - passed, 4 tests.
- `pnpm --filter @tether/gateway test` - passed, 9 tests.
- `pnpm --filter @tether/web typecheck` - passed.
- `pnpm typecheck` - passed.
- `pnpm test` - passed.
- Local E2E smoke - passed: Web dev server served the app; local Relay + Gateway relay client + remote WebSocket client verified auth, list, subscribe, output, input, and resize.
- Server E2E - not run because this environment did not provide real `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`.

## Decisions Made

- Kept direct mode behavior in place and added relay mode as a transport branch inside the same Web components.
- Used a password input and localStorage for the MVP relay secret, matching the Phase 1 security boundary.
- Treated real server E2E as unavailable without credentials rather than inventing a placeholder endpoint.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

- The first ad hoc smoke command used top-level await with `tsx --eval`, which outputs CommonJS for eval. Re-ran the same smoke inside an async `main()` and it passed.
- No browser automation dependency exists in this repo. The local E2E smoke verified Web dev serving plus the relay frame path programmatically; no manual browser click-through was performed.

## Known Stubs

None. Placeholder strings found in `apps/web/src/main.tsx` are input placeholder labels, not data stubs.

## Threat Flags

None. New relay browser surface matches the plan threat model; the secret is not used in URL construction.

## User Setup Required

Real server E2E requires the user's Node relay URL and shared secret via `TETHER_RELAY_URL` and `TETHER_RELAY_SECRET`.

## Next Phase Readiness

Relay Web mode is wired into the existing UI and documented for the personal nginx plus Node relay deployment. Future auth work can replace the Phase 1 shared secret with device-token pairing without changing the UI split.

## Self-Check: PASSED

- Found expected files: `apps/web/src/main.tsx`, `apps/web/src/styles.css`, `docs/README.md`, `docs/current/relay-mvp.md`, `.planning/phases/01-personal-relay-mvp/01-04-SUMMARY.md`.
- Found task commits: `bcc2120`, `48093f7`, `a1dae18`.

---
*Phase: 01-personal-relay-mvp*
*Completed: 2026-05-01*
