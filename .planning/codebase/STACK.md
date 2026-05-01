# Technology Stack

**Analysis Date:** 2026-05-01

## Languages

**Primary:**
- TypeScript ^5.8.3 — Used across all `apps/*` and `packages/*` (Node services, CLI, web client, shared types)
- TSX/JSX (React) — Used in `apps/web/src/main.tsx` for the browser client

**Secondary:**
- HTML — Single Vite entry at `apps/web/index.html`
- CSS — `apps/web/src/styles.css` (no preprocessor, no Tailwind)

**Reserved (not yet active):**
- Dart (Flutter) — `native/flutter/` placeholder
- ArkTS (HarmonyOS) — `native/harmony/` placeholder
- See `native/README.md`

## Runtime

**Environment:**
- Node.js >= 20 LTS (declared in `package.json` `engines.node`)
- ES Modules only (`"type": "module"` in every `package.json`)
- Browser runtime for `apps/web` (modern evergreen, ES2022)

**Package Manager:**
- pnpm with workspaces (lockfileVersion 9.0)
- Lockfile: `pnpm-lock.yaml` present and committed
- Workspace config: `pnpm-workspace.yaml` includes `apps/*` and `packages/*`
- `package.json` `pnpm.onlyBuiltDependencies`: `better-sqlite3`, `esbuild`, `node-pty` (native modules requiring postinstall builds)

## Frameworks

**Core (server / gateway):**
- Hono ^4.7.11 — HTTP routing in `apps/gateway/src/daemon.ts`
- @hono/node-server ^1.14.4 — Node adapter that yields the underlying `http.Server` for WebSocket upgrade
- ws ^8.20.0 — WebSocket server (Gateway) and client (CLI attach)
- node-pty 1.2.0-beta.2 — PTY spawning for the event-stream transport in `apps/gateway/src/pty.ts`

**Core (CLI):**
- commander ^13.1.0 — CLI argument parsing in `apps/cli/src/main.ts`
- ws ^8.20.0 — WebSocket client for `tether attach` PTY streaming

**Core (web):**
- React ^19.1.0 / react-dom ^19.1.0 — `apps/web/src/main.tsx`
- @xterm/xterm ^6.0.0 — Browser terminal emulator
- @xterm/addon-fit ^0.11.0 — Terminal sizing addon

**Testing:**
- Node.js built-in test runner (`node --test` via `tsx --test`) — declared in `apps/gateway/package.json` script `test`
- `node:assert/strict` — assertion library used across `*.test.ts`
- No separate framework (no Jest / Vitest / Mocha)

**Build / Dev:**
- tsx ^4.19.4 — TypeScript-to-Node loader; project runs sources directly without `dist/`
- TypeScript ^5.8.3 — `tsc --noEmit` only, used purely for typechecking
- Vite ^7.1.5 — Web dev server and production bundler (`apps/web/vite.config.ts`)
- @vitejs/plugin-react ^5.0.2 — React Fast Refresh / JSX support

## Key Dependencies

**Critical (Gateway):**
- `better-sqlite3` ^11.10.0 — Synchronous SQLite client; backs `~/.tether/tether.db` in `apps/gateway/src/store.ts`
- `node-pty` 1.2.0-beta.2 — Native PTY bindings for the default `pty-event-stream` transport
- `hono` ^4.7.11 — All HTTP endpoints (`/api/sessions/*`, `/api/ws-ticket`, `/api/gateways`)
- `ws` ^8.20.0 — Gateway upgrades the Hono server to host `/api/sessions/:id/stream` WebSockets

**Critical (Web):**
- `@xterm/xterm` ^6.0.0 — Renders live terminal output in the PTY event-stream view
- `react` ^19.1.0 — UI

**Internal workspace packages:**
- `@tether/cli` (`apps/cli`) — Command-line entry, depends on `@tether/core` and `@tether/gateway`
- `@tether/gateway` (`apps/gateway`) — HTTP / WS server, PTY manager, SQLite store, tmux fallback
- `@tether/web` (`apps/web`) — Browser client (built into `apps/web/dist`, served by Gateway)
- `@tether/core` (`packages/core/src/index.ts`) — Shared scalar types (`ProviderName`, `Gateway`, `UISurfaceKind`, `WorkTargetRole`)
- `@tether/protocol` (`packages/protocol/src/index.ts`) — `RelayFrame` discriminated union (placeholder for future relay)
- `@tether/config` (`packages/config/src/index.ts`) — Constants (`DEFAULT_GATEWAY_PORT = 4789`, `DEFAULT_GATEWAY_HOST = '127.0.0.1'`)
- `@tether/ui` (`packages/ui/src/index.ts`) — Placeholder export only (`uiPackagePlaceholder = true`)

**Dev-only types:**
- `@types/node` ^22.15.29
- `@types/ws` ^8.18.1
- `@types/better-sqlite3` ^7.6.13
- `@types/react` ^19.1.13, `@types/react-dom` ^19.1.9

## Configuration

**TypeScript:**
- `tsconfig.base.json` — Shared settings: `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `esModuleInterop: true`, `types: ["node"]`
- `tsconfig.json` — Root project file; includes `apps/**/*.ts` and `packages/**/*.ts`
- Per-package `tsconfig.json` extends the base; `apps/web/tsconfig.json` overrides `jsx: react-jsx`, `lib: [ES2022, DOM, DOM.Iterable]`, `types: ["vite/client"]`
- `tsc -p tsconfig.json --noEmit` is the only TypeScript invocation; no emitted JS

**Workspace:**
- `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - "apps/*"
    - "packages/*"
  ```
- Root `package.json` declares dependencies on workspace packages via `workspace:*`

**Vite:**
- `apps/web/vite.config.ts` — Dev server proxies `/api` → `http://127.0.0.1:4789` with `ws: true` so the WebSocket upgrade also flows through Vite during development
- Dev server bound to `127.0.0.1:4790`; preview to `127.0.0.1:4791`

**Environment:**
- No `.env` files in repo (verified)
- The only `process.env` read in source is `apps/gateway/src/pty.ts` line 45 (`env: process.env`) — child PTY processes inherit the Gateway's environment unchanged
- Gateway port and host come from CLI flags (`--port`, `--host`); defaults exported from `@tether/config`

**Runtime data directory:**
- `~/.tether/tether.db` — SQLite database (sessions + append-only `session_events`)
- `~/.tether/gateways.json` — Live Gateway registry written by `apps/gateway/src/registry.ts`
- Both directories created on demand via `mkdir({ recursive: true })`

## Platform Requirements

**Development:**
- Node.js 20+ LTS
- pnpm
- Native build toolchain for `better-sqlite3` and `node-pty` (Xcode CLT on macOS, build-essential on Linux)
- tmux only required when explicitly using `--transport tmux` (the legacy fallback)

**Production:**
- Self-hosted: the user runs `tether gateway` or `tether <provider>` directly on the workstation
- No container, no deployment platform; binary entry is `bin/tether` (`#!/usr/bin/env -S node --import tsx`) which loads `apps/cli/src/main.ts`
- Web bundle must be built into `apps/web/dist` (via `pnpm web:build`) for the Gateway to serve `/`, `/remote`, `/remote/session/:id`; otherwise the Gateway returns HTTP 503 (`apps/gateway/src/daemon.ts` `serveWebApp`)

## Build & Run Commands

Defined in root `package.json`:

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies |
| `pnpm typecheck` | `pnpm -r --if-present run typecheck` (each package runs `tsc --noEmit`) |
| `pnpm test` | `pnpm -r --if-present run test` (only `@tether/gateway` defines tests) |
| `pnpm web:dev` | `vite` dev server on `127.0.0.1:4790` |
| `pnpm web:build` | `tsc --noEmit && vite build` to `apps/web/dist` |
| `pnpm dev` | `tsx apps/cli/src/main.ts codex --host 0.0.0.0` |
| `pnpm tether <args>` | `tsx apps/cli/src/main.ts <args>` |
| `bin/tether <args>` | Same entry, executable shim using `node --import tsx` |

---

*Stack analysis: 2026-05-01*
