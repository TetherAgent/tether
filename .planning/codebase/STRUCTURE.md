# Codebase Structure

**Analysis Date:** 2026-05-01

## Directory Layout

```
tether/
├── AGENTS.md                       # AI collaboration entry point
├── CLAUDE.md                       # Coding principles (highest precedence)
├── PROJECT.md                      # Project rules and security gates
├── AI_CONTEXT.md                   # Architecture context (facts only)
├── README.md / README.zh-CN.md     # Public-facing project docs
├── LICENSE
├── package.json                    # Workspace root, registers `tether` bin
├── pnpm-workspace.yaml             # Includes `apps/*` and `packages/*` only
├── pnpm-lock.yaml
├── tsconfig.base.json              # Shared TS compiler options (ES2022, strict)
├── tsconfig.json                   # Aggregates apps + packages for typecheck
├── bin/
│   └── tether                      # Shebang shim → apps/cli/src/main.ts (via tsx)
├── apps/
│   ├── cli/                        # @tether/cli — commander dispatcher
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/main.ts
│   ├── gateway/                    # @tether/gateway — HTTP + WS + PTY/tmux
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # Public barrel
│   │       ├── daemon.ts           # Hono app + WebSocketServer
│   │       ├── pty.ts              # PtySessionManager (node-pty)
│   │       ├── tmux.ts             # tmux fallback wrappers
│   │       ├── store.ts            # SQLite Store (sessions + session_events)
│   │       ├── registry.ts         # ~/.tether/gateways.json registry
│   │       ├── mask.ts             # Sensitive-output masking
│   │       ├── ids.ts              # Session id generator
│   │       ├── ui/                 # Reserved (currently empty)
│   │       ├── daemon.test.ts
│   │       ├── pty.test.ts
│   │       └── store.test.ts
│   └── web/                        # @tether/web — React 19 + xterm.js + Vite
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts          # Dev proxy /api → 127.0.0.1:4789
│       ├── index.html              # Vite entry
│       ├── src/
│       │   ├── main.tsx            # App + SessionList + SessionView + PtySessionView
│       │   └── styles.css
│       └── dist/                   # Built bundle served by Gateway
│           ├── index.html
│           └── assets/
├── packages/
│   ├── core/                       # @tether/core — shared types
│   │   └── src/index.ts
│   ├── protocol/                   # @tether/protocol — RelayFrame union (future)
│   │   └── src/index.ts
│   ├── config/                     # @tether/config — default host/port
│   │   └── src/index.ts
│   └── ui/                         # @tether/ui — placeholder
│       └── src/index.ts
├── native/                         # NOT in workspace; reserved for future clients
│   ├── README.md
│   ├── flutter/                    # Empty placeholder
│   └── harmony/                    # Empty placeholder
├── docs/
│   ├── README.md                   # Doc governance
│   ├── current/                    # Long-lived facts
│   ├── working/                    # Working drafts before GSD planning
│   │   ├── 2026-05-01-tether-agent-console.md
│   │   └── 2026-05-01-phase-2-pty-event-stream.md
│   └── gsd-usage.zh-CN.md
├── .planning/
│   └── codebase/                   # GSD codebase maps (this directory)
└── ~/.tether/                      # Runtime data (NOT in repo)
    ├── tether.db                   # SQLite: sessions + session_events
    └── gateways.json               # File registry of running gateways
```

## Directory Purposes

**`apps/cli/`:**
- Purpose: User-facing CLI. The only entry point shell users invoke directly.
- Contains: `src/main.ts` (commander program; all subcommands defined here).
- Key files: `apps/cli/src/main.ts`, `apps/cli/package.json`.

**`apps/gateway/`:**
- Purpose: Local HTTP API + WebSocket stream + PTY/tmux supervisor + persistence. Imported in-process by the CLI; also runnable standalone via `tether gateway`.
- Contains: All server runtime modules and their unit tests (co-located).
- Key files: `apps/gateway/src/daemon.ts`, `apps/gateway/src/pty.ts`, `apps/gateway/src/store.ts`, `apps/gateway/src/tmux.ts`, `apps/gateway/src/index.ts` (barrel).

**`apps/web/`:**
- Purpose: Browser PWA — session list and per-session terminal view.
- Contains: React entry, xterm.js terminal, Vite config, built output.
- Key files: `apps/web/src/main.tsx`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/dist/`.

**`packages/core/`:**
- Purpose: Shared TypeScript types with no runtime code.
- Key files: `packages/core/src/index.ts`.

**`packages/protocol/`:**
- Purpose: Wire-format types for the future Relay link. Not yet imported by runtime code.
- Key files: `packages/protocol/src/index.ts`.

**`packages/config/`:**
- Purpose: Default constants (`DEFAULT_GATEWAY_HOST`, `DEFAULT_GATEWAY_PORT`).
- Key files: `packages/config/src/index.ts`.

**`packages/ui/`:**
- Purpose: Placeholder for shared React/UI primitives. Not yet consumed.
- Key files: `packages/ui/src/index.ts`.

**`bin/`:**
- Purpose: Repo-level executable shim used as the npm `bin` entry.
- Key files: `bin/tether`.
- Note: The shim re-imports `../apps/cli/src/main.ts`, so it must be invoked from the repo root (or via `pnpm tether`). Direct symlink usage from elsewhere will not resolve.

**`native/`:**
- Purpose: Reserved space for future Flutter / HarmonyOS / iOS / Android clients. Excluded from the pnpm workspace, typecheck, and tests by design.
- Key files: `native/README.md` (rules of engagement).

**`docs/`:**
- Purpose: Project documentation. `current/` holds long-lived facts; `working/` holds drafts before they become GSD phase plans; root-level files in `docs/` cover topical guides.
- Key files: `docs/README.md`, `docs/working/2026-05-01-tether-agent-console.md`, `docs/working/2026-05-01-phase-2-pty-event-stream.md`.

**`.planning/codebase/`:**
- Purpose: Auto-generated codebase maps for GSD agents (this file lives here).
- Generated: Yes.
- Committed: Optional (per repo conventions).

**`~/.tether/` (runtime, not in repo):**
- Purpose: Local persistence. `tether.db` (SQLite), `gateways.json` (registry).
- Generated: Yes, by Gateway at first run.
- Committed: No.

## Key File Locations

**Entry Points:**
- `bin/tether`: `node --import tsx` shim that loads the CLI.
- `apps/cli/src/main.ts`: All CLI subcommands and dispatch logic.
- `apps/web/src/main.tsx`: Web SPA entry; mounts `<App />` and routes by URL path.
- `apps/web/index.html`: Vite HTML entry.

**Configuration:**
- `package.json` (root): Workspace scripts (`typecheck`, `test`, `tether`, `web:dev`, `web:build`), `tether` bin, pnpm `onlyBuiltDependencies` (`better-sqlite3`, `esbuild`, `node-pty`).
- `pnpm-workspace.yaml`: Workspace globs (`apps/*`, `packages/*`).
- `tsconfig.base.json`: ES2022, NodeNext, strict, `types: ["node"]`.
- `tsconfig.json`: Aggregates `apps/**/*.ts` + `packages/**/*.ts` for IDE/typecheck.
- `apps/web/vite.config.ts`: Vite + React plugin; dev `/api` proxy to Gateway.
- `apps/web/tsconfig.json`, `apps/cli/tsconfig.json`, `apps/gateway/tsconfig.json`, `packages/*/tsconfig.json`: Each extends `tsconfig.base.json` and limits include scope.
- `packages/config/src/index.ts`: Runtime defaults (`DEFAULT_GATEWAY_HOST = '127.0.0.1'`, `DEFAULT_GATEWAY_PORT = 4789`).

**Core Logic:**
- `apps/gateway/src/daemon.ts`: HTTP routes, WS upgrade, ticket auth, controller logic, gateway registration.
- `apps/gateway/src/pty.ts`: `node-pty` lifecycle, output buffering, event publication.
- `apps/gateway/src/store.ts`: SQLite schema, sessions and append-only events, transcript helper, lost-session reconciliation.
- `apps/gateway/src/tmux.ts`: List-form `child_process.spawn('tmux', ...)` wrappers (Phase-1 fallback).
- `apps/gateway/src/registry.ts`: `~/.tether/gateways.json` register/touch/list/unregister with stale pruning.
- `apps/gateway/src/mask.ts`: Regex masking for `sk-...`, GitHub PATs, key/token/secret/password assignments.
- `apps/gateway/src/ids.ts`: `tth_YYYYMMDD_<hex8>` session id format.
- `apps/gateway/src/index.ts`: Public package barrel re-exporting everything CLI/web need.

**Testing:**
- `apps/gateway/src/daemon.test.ts`: HTTP/WS integration tests against a real `startDaemon`.
- `apps/gateway/src/pty.test.ts`: PTY spawn + masking on `user.input`.
- `apps/gateway/src/store.test.ts`: SQLite event log invariants.
- Run via `pnpm test` (root) → `tsx --test src/*.test.ts` per workspace package.

## Naming Conventions

**Files:**
- TypeScript modules: lowercase, single-noun (e.g., `daemon.ts`, `pty.ts`, `store.ts`, `mask.ts`, `ids.ts`, `tmux.ts`, `registry.ts`).
- Tests: `<module>.test.ts` co-located with the module under test.
- React: `.tsx` only where JSX is used (`apps/web/src/main.tsx`).
- HTML/CSS: lowercase (`index.html`, `styles.css`).
- Documentation: dated drafts use `YYYY-MM-DD-<slug>.md` in `docs/working/`.

**Directories:**
- Workspace packages live under `apps/*` (deployable surfaces) or `packages/*` (libraries).
- `apps/<name>/src/` is always the source root; tests are co-located, not in a separate `__tests__/`.
- Native client placeholders use a single platform name (`native/flutter`, `native/harmony`).

**Workspace package names:**
- All under the `@tether/` scope: `@tether/cli`, `@tether/gateway`, `@tether/web`, `@tether/core`, `@tether/protocol`, `@tether/config`, `@tether/ui`.
- Cross-package imports use the `@tether/<name>` specifier and `workspace:*` in `package.json`.

**Identifiers:**
- Session ids: `tth_<YYYYMMDD>_<hex8>` (`apps/gateway/src/ids.ts`).
- tmux session names: `tether_<sessionId>` (`apps/gateway/src/tmux.ts`).
- Gateway registry ids: `gw_<pid>_<port>` (`apps/gateway/src/daemon.ts:365`).
- WS clientId: `cli_<uuid>` for new attaches (`apps/gateway/src/daemon.ts:259`).

**Scripts (root `package.json`):**
- `pnpm typecheck` — recursive; runs `tsc --noEmit` in every workspace package that defines `typecheck`.
- `pnpm test` — recursive; runs each package's `test` script (currently only Gateway).
- `pnpm tether <args>` — invokes the CLI via `tsx`.
- `pnpm dev` — `tsx apps/cli/src/main.ts codex --host 0.0.0.0` (dev shortcut).
- `pnpm web:dev` / `pnpm web:build` — Vite dev / production build.

## Where to Add New Code

**New CLI subcommand:**
- Add a `program.command(...)` block to `apps/cli/src/main.ts`.
- Reuse `parsePort` and `parseTransport` for option parsing.
- Talk to the Gateway either in-process (via `@tether/gateway` exports) or over HTTP if the action belongs to a remote Gateway.

**New HTTP route:**
- Add to `apps/gateway/src/daemon.ts`. Mount under `/api/...`.
- Validate body shape inline (see existing `c.req.json<{...}>().catch(...)` pattern).
- Return `{ error }` JSON with explicit status codes (404 unknown, 409 wrong transport, 410 session lost, 400 bad input).

**New WebSocket frame type:**
- Server side: handle in the `socket.on('message', ...)` switch in `apps/gateway/src/daemon.ts:308`.
- CLI side: extend the `frame.type === ...` reader in `apps/cli/src/main.ts:362`.
- Web side: extend `StreamFrame` and the `nextWs.addEventListener('message', ...)` switch in `apps/web/src/main.tsx`.

**New session event type:**
- Add the literal to `SessionEventType` in `apps/gateway/src/store.ts:27`.
- Persist with `Store.appendEvent(sessionId, '<type>', payload)` and publish via `PtySessionManager.publish` if it should fan out live.
- Update Web/CLI consumers if they need to act on it.

**Shared TypeScript types:**
- Cross-package types: `packages/core/src/index.ts`.
- Wire-format types tied to the relay: `packages/protocol/src/index.ts`.

**Default values / constants:**
- Use `packages/config/src/index.ts` so CLI, Gateway, and future relay agree.

**New web view / route:**
- Add a branch inside `App` in `apps/web/src/main.tsx`. The current routing is path-based (`/remote/session/:id`); keep the same shape rather than introducing a router unless needed.
- Styles in `apps/web/src/styles.css`.

**Tests for Gateway internals:**
- Co-located in `apps/gateway/src/<module>.test.ts` using `node:test` + `tsx --test`.
- Use `mkdtempSync` + `Store(path.join(dir, 'tether.db'))` to keep each test isolated.

**Documentation:**
- Drafts before commitment: `docs/working/YYYY-MM-DD-<slug>.md`.
- GSD planning and execution state: `.planning/`.
- Promoted long-lived facts: update `docs/current/`, `AGENTS.md`, `PROJECT.md`, `AI_CONTEXT.md`.

**Native client work:**
- Read `native/README.md` first. Do not duplicate Gateway logic. Generate or hand-write SDKs against `packages/protocol` only.

## Special Directories

**`apps/web/dist/`:**
- Purpose: Production bundle of the web client.
- Generated: Yes, by `pnpm web:build` (Vite + tsc check).
- Committed: Yes in this checkout (Gateway serves from here at runtime when not using Vite dev).

**`node_modules/` (root and per-package):**
- Purpose: pnpm-installed dependencies.
- Generated: Yes.
- Committed: No (`.gitignore`).

**`~/.tether/`:**
- Purpose: Runtime user data — SQLite DB, gateway registry, future device tokens.
- Generated: Yes, lazily on first Gateway start (`mkdirSync` in `Store` and `registry.ts`).
- Committed: No (lives in the user's home directory, not the repo).

**`apps/gateway/src/ui/`:**
- Purpose: Reserved subdirectory for future Gateway-side UI helpers.
- Currently empty. Do not place arbitrary modules here without a reason.

---

*Structure analysis: 2026-05-01*
