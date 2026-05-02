---
phase: 05-web-first-account-setup-server-auth-runtime
plan: 02
subsystem: web-auth-shell
tags: [apps-web, shadcn, tailwind4, auth-shell, route-guard]
requires:
  - phase: 05-web-first-account-setup-server-auth-runtime
    plan: 01
    provides: Shared auth scope direction and server URL split for future auth APIs
provides:
  - Tailwind 4 + shadcn foundation in `apps/web`
  - Auth route shell for `/register`, `/login`, `/admin/register`, `/admin/login`
  - Session-shell gate that redirects unauthenticated users to `/login`
affects: [WEBUI-01, AUTH-01]
tech-stack:
  added: [tailwindcss, @tailwindcss/vite, react-router-dom, react-hook-form, zod, @hookform/resolvers, class-variance-authority, clsx, tailwind-merge, Radix slot/label]
  patterns: [route-shell over existing terminal UI, shadcn primitives only, auth placeholder state in localStorage]
key-files:
  created:
    - apps/web/components.json
    - apps/web/src/lib/utils.ts
    - apps/web/src/components/ui/button.tsx
    - apps/web/src/components/ui/input.tsx
    - apps/web/src/components/ui/label.tsx
    - apps/web/src/components/ui/card.tsx
    - apps/web/src/components/ui/form.tsx
    - .planning/phases/05-web-first-account-setup-server-auth-runtime/05-02-SUMMARY.md
  modified:
    - apps/web/package.json
    - apps/web/vite.config.ts
    - apps/web/src/main.tsx
    - apps/web/src/styles.css
    - pnpm-lock.yaml
key-decisions:
  - "Wave 1 only builds the auth shell and placeholders; real register/login forms stay for later plans."
  - "Existing terminal/session UI remains intact behind an auth gate instead of being redesigned."
  - "This execution created no git commits and leaves all changes uncommitted for later review."
patterns-established:
  - "shadcn primitives in this repo should use relative `.js` import specifiers because the web tsconfig inherits `NodeNext`."
  - "Auth routes can be layered around the existing session shell with `react-router-dom` rather than rewriting session internals."
requirements-completed: [WEBUI-01, AUTH-01]
duration: ~50min
completed: 2026-05-02
---

# Phase 5 Plan 02: Web shadcn Foundation and Auth Shell Summary

**Tailwind 4 + shadcn groundwork and an auth-aware route shell wrapped around the existing session UI**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-05-02
- **Tasks:** 2/2
- **Files modified:** 11 source/config files plus lockfile and this summary

## Accomplishments

- Added Tailwind 4 and `@tailwindcss/vite` to `apps/web`, and wired the plugin into Vite.
- Added `components.json`, `src/lib/utils.ts`, and the five shadcn primitives required by the UI contract: `button`, `input`, `form`, `card`, and `label`.
- Added route-shell coverage for `/register`, `/login`, `/admin/register`, `/admin/login`, `/admin`, and the authenticated session shell.
- Preserved the existing `SessionList` and `SessionView` runtime logic by wrapping them in a `RequireAuth` shell instead of rewriting them.
- Added dark-theme shadcn CSS variables and auth-shell layout classes in `styles.css`.
- Added the server/Gateway proxy split in `vite.config.ts` so future auth/admin routes can point at `127.0.0.1:4800` while session APIs keep using `127.0.0.1:4789`.
- Installed the new dependencies and refreshed `pnpm-lock.yaml`.

## Task Commits

No commits were created. This execution leaves all source, lockfile, SUMMARY, and planning-state changes uncommitted for later review.

1. **05-02-T01: Initialize Tailwind 4 and shadcn in apps/web** - not committed
2. **05-02-T02: Prepare the auth-aware shell without redesigning the session UI** - not committed

## Files Created/Modified

- `apps/web/package.json` - Tailwind/shadcn/router/form dependencies.
- `apps/web/vite.config.ts` - Tailwind Vite plugin and auth/server proxy split.
- `apps/web/components.json` - shadcn registry metadata.
- `apps/web/src/lib/utils.ts` - shared `cn()` helper.
- `apps/web/src/components/ui/button.tsx` - shadcn button primitive.
- `apps/web/src/components/ui/input.tsx` - shadcn input primitive.
- `apps/web/src/components/ui/label.tsx` - shadcn label primitive.
- `apps/web/src/components/ui/card.tsx` - shadcn card primitive.
- `apps/web/src/components/ui/form.tsx` - shadcn form primitive scaffold for later plans.
- `apps/web/src/main.tsx` - auth routes, `RequireAuth`, admin placeholder shell, and session-shell wrapper.
- `apps/web/src/styles.css` - Tailwind import, shadcn tokens, and auth-shell layout classes.
- `pnpm-lock.yaml` - Recorded the workspace dependency install.
- `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-02-SUMMARY.md` - This execution summary.

## Decisions Made

- Used placeholder auth cards in Wave 1 so the repo gets the route and layout shell now without faking the real server-backed register/login behavior too early.
- Kept the existing terminal/session surface mounted behind the auth gate instead of redesigning or moving it.
- Kept management realm isolated with its own routes and `/admin` placeholder rather than sending management auth into terminal control.

## Verification

- `pnpm --filter @tether/web build` - passed
- Build output warning: one JS chunk is `616.42 kB`, which is above Vite's `500 kB` warning threshold but does not fail the build
- `git diff --check` - not yet run at this plan boundary

## Deviations from Plan

### Auto-fixed Issues

**1. NodeNext import suffixes were required for shadcn files**
- **Found during:** `pnpm --filter @tether/web build`
- **Issue:** The repo's web tsconfig inherits `moduleResolution: NodeNext`, so relative imports inside the new shadcn primitives and `main.tsx` failed without explicit `.js` suffixes.
- **Fix:** Switched all new relative imports to `.js` specifiers.
- **Files modified:** `apps/web/src/main.tsx`, `apps/web/src/components/ui/*.tsx`
- **Verification:** `pnpm --filter @tether/web build` passed.

## Known Stubs

- The auth cards are placeholders for Wave 1. They intentionally do not submit real credentials yet.
- `apps/web/src/components/ui/form.tsx` is scaffolded for later use but is not yet wired into a live auth form.

## Threat Flags

None beyond the planned browser-route surface. This plan does not yet send real auth tokens to the backend.

## User Setup Required

None for the shell itself. Later auth plans will require `apps/server` to run on `127.0.0.1:4800`.

## Next Phase Readiness

Wave 2/3 can now plug real `/register`, `/login`, `/admin/register`, and `/admin/login` forms into an existing visual shell without reopening routing or theme setup.

## Uncommitted Change Policy

This run intentionally created no git commits. All modified files remain in the working tree for review and later commit selection.

## Self-Check: PASSED

- Summary file exists: `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-02-SUMMARY.md`
- `apps/web/package.json` contains Tailwind/shadcn/router dependencies.
- `apps/web/vite.config.ts` contains `@tailwindcss/vite` and the server/Gateway proxy split.
- `apps/web/src/main.tsx` contains `/register`, `/login`, `/admin/register`, `/admin/login`, and redirect-to-`/login` auth gating.
- `apps/web/src/styles.css` includes shadcn variables and auth-shell layout classes.
- `pnpm --filter @tether/web build` passed.

---
*Phase: 05-web-first-account-setup-server-auth-runtime*
*Completed: 2026-05-02*
