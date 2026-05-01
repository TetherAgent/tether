# Coding Conventions

**Analysis Date:** 2026-05-01

## Language and Module System

**TypeScript everywhere.** All workspace packages declare `"type": "module"` and import with explicit `.js` extensions (NodeNext resolution). Source files use `.ts`/`.tsx`; there is no `dist` build for backend packages (run via `tsx`).

**Strict TS:** `tsconfig.base.json` enables `strict`, `esModuleInterop`, `skipLibCheck`, `forceConsistentCasingInFileNames`. Target `ES2022`, module `NodeNext`. Web app extends the base and adds `jsx: "react-jsx"` plus DOM libs.

**Workspace TS configs:**
- `apps/cli/tsconfig.json`, `apps/gateway/tsconfig.json`, `packages/*/tsconfig.json`: extend `tsconfig.base.json`, include `src/**/*.ts`.
- `apps/web/tsconfig.json`: extends base; adds `jsx: react-jsx`, `lib: [ES2022, DOM, DOM.Iterable]`, `types: [vite/client]`.

## Linting and Formatting

**No lint or formatter is configured.** No `.eslintrc*`, `.prettierrc*`, `biome.json`, or `eslint.config.*` exists in the repo. Style is enforced by convention (`pnpm typecheck`) and `CLAUDE.md`'s "match existing style" rule.

**Indent / quotes / semicolons (observed):**
- 2-space indentation everywhere.
- Single quotes for strings (e.g., `'node:fs/promises'`, `'127.0.0.1'`).
- Semicolons present at statement ends.
- Trailing commas inside multi-line object/array literals: typically omitted (e.g., `apps/gateway/src/store.ts`), occasionally present in CLI definitions (`apps/cli/src/main.ts:57`).
- Line width: long lines are allowed; no hard wrap rule.

When editing existing files, copy the exact style of the file you are editing. Do not introduce new formatting tools.

## Naming Patterns

**Files:**
- Source files: lowercase, single word. Examples: `daemon.ts`, `pty.ts`, `store.ts`, `tmux.ts`, `mask.ts`, `ids.ts`, `registry.ts`.
- Test files: `<unit>.test.ts` co-located beside the unit (`apps/gateway/src/store.test.ts`).
- React entry: `main.tsx` (`apps/web/src/main.tsx`). No per-component file split — one file holds all components.

**Functions and variables:** `camelCase`. Examples: `startDaemon`, `localLanAddress`, `parseClientFrame`, `consumeTicket`.

**Classes:** `PascalCase`. Examples: `Store` (`apps/gateway/src/store.ts`), `PtySessionManager` (`apps/gateway/src/pty.ts`), `TmuxError` (`apps/gateway/src/tmux.ts`).

**Types and type aliases:** `PascalCase`, declared with `type` (preferred over `interface`). Examples: `Session`, `SessionEvent`, `DaemonOptions`, `RunningDaemon`, `ClientInfo`, `LivePtySession`.

**React components:** `PascalCase` function components — `App`, `SessionList`, `SessionCard`, `SessionView`, `PtySessionView` in `apps/web/src/main.tsx`.

**Constants:** `SCREAMING_SNAKE_CASE` for top-level configuration constants — `DEFAULT_GATEWAY_PORT`, `DEFAULT_GATEWAY_HOST` (`packages/config/src/index.ts`), `WEB_TRANSPORT_KEY`, `WEB_CLIENT_MODE_KEY`, `MASK`, `PATTERNS`.

**Identifiers / IDs:** prefixed strings — `tth_<yyyymmdd>_<hex>` for sessions (`apps/gateway/src/ids.ts`), `gw_<pid>_<port>` for gateways (`apps/gateway/src/daemon.ts:365`), `cli_<uuid>` for clients.

**DB columns:** `snake_case` (e.g., `project_path`, `tmux_session_name`, `last_active_at`); mapped to `camelCase` fields via `fromRow` / `toRow` helpers in `apps/gateway/src/store.ts`.

## Module Organization

**Workspace layout:**
- `apps/*` — runnable surfaces (`cli`, `gateway`, `web`).
- `packages/*` — shared libs (`core`, `config`, `protocol`, `ui`).
- Workspace declared in `pnpm-workspace.yaml`.

**Package exports:** workspace packages publish via `"exports"` in their `package.json` pointing at `./src/*.ts` directly (no build step). Example: `apps/gateway/package.json` exports `.`, `./store`, `./tmux`.

**Barrel files:** `apps/gateway/src/index.ts` re-exports the public API used by the CLI. Internal modules import from each other directly (e.g., `pty.ts` imports `./store.js`, not `./index.js`). New cross-package consumers should import from the barrel; intra-package code should keep using direct relative imports.

**Internal vs public:** anything not re-exported from `apps/gateway/src/index.ts` is considered internal — do not import deep paths from outside the package.

## Imports

**Order (observed):**
1. Node built-ins with `node:` prefix — `import path from 'node:path'`, `import { randomUUID } from 'node:crypto'`.
2. Third-party packages — `import { Hono } from 'hono'`, `import WebSocket from 'ws'`.
3. Workspace packages — `import type { ProviderName } from '@tether/core'`.
4. Relative imports with `.js` extension — `import { Store } from './store.js'`.

Group ordering is loose and not enforced by tooling; keep new imports in a consistent group order.

**Type-only imports:** use `import type { ... }` for type-only references (`apps/gateway/src/daemon.ts:3,9,12`). Mixing `import type` with value imports is allowed when the runtime needs are separate.

**No path aliases.** Imports are either bare package specifiers or relative paths.

## Async Patterns

**`async`/`await` everywhere** — no raw `.then()` chains for control flow. Promise constructors are used only for low-level event-to-promise bridging:
- `apps/gateway/src/daemon.ts:386` — wrapping `server.close((error) => …)`.
- `apps/cli/src/main.ts:334`, `:361` — wrapping `WebSocket` lifecycle events.
- `apps/gateway/src/tmux.ts:26` — wrapping `child_process.spawn` lifecycle.

**Fire-and-forget cleanup** uses `.catch(() => undefined)` to silently swallow errors during shutdown — see `touchGateway(...).catch(() => undefined)` in `apps/gateway/src/daemon.ts:377`. Do not extend this pattern to operational code paths.

**Polling:** loops use `while (Date.now() - startedAt < timeoutMs)` with `await new Promise((resolve) => setTimeout(resolve, 25))` — see test helpers `waitFor` in `apps/gateway/src/pty.test.ts:49` and `apps/gateway/src/daemon.test.ts:126`.

## Error Handling

**Custom error class** lives in `apps/gateway/src/tmux.ts:3` — `TmuxError extends Error` with a `stderr` property. Use `formatTmuxError(error)` to get a user-facing string from any `unknown` error.

**Catch with `unknown`:** `catch (error: unknown)` is used at top-level CLI handler (`apps/cli/src/main.ts:303`) and async callbacks. Narrow with `error instanceof Error` before reading `.message`.

**JSON parse safety:** wrap `JSON.parse` in try/catch and return `undefined` on failure (`apps/gateway/src/daemon.ts:411`, `apps/gateway/src/registry.ts:101`).

**HTTP error responses:** Hono routes return `c.json({ error: '<message>' }, <status>)` with conventional codes:
- `400` invalid request body
- `404` resource not found
- `409` precondition violated (`session is not pty-backed`)
- `410` resource gone (tmux/PTY session no longer alive)
- `501` not implemented

**No global error middleware** — every route handles its own error shape.

**CLI errors:** throw `new Error(...)` and let `program.parseAsync().catch(...)` print and set `process.exitCode = 1` (`apps/cli/src/main.ts:303`).

## Logging

**No logger framework.** Use `console.log` for user-facing CLI output and `console.warn` / `console.error` for non-fatal/fatal diagnostics. Examples in `apps/cli/src/main.ts:73`, `:138`, `:304`.

Server-side observability lives in the event store (`session_events` table) — the daemon does not log per-request information to stdout.

## Function Design

**Small focused functions.** Module-level helpers are short and pure where possible (e.g., `parseIntegerQuery`, `consumeTicket`, `parseClientFrame` at the bottom of `apps/gateway/src/daemon.ts`).

**Options objects:** functions with three or more parameters take a single options object typed with a named `type`. Examples: `DaemonOptions`, `CreatePtySessionOptions`, `PtyInputOptions`. Keep this pattern when adding new APIs.

**Default arguments** at the parameter list, e.g., `touchSession(id: string, now = Date.now())` and `listEvents(sessionId, after = 0, limit = 1000)` (`apps/gateway/src/store.ts`).

**Return types:** explicit on exported functions (`Promise<RunningDaemon>`, `Promise<string>`). Inline lambdas omit return types and let inference work.

## TypeScript Usage

**Discriminated unions** for protocol frames — `RelayFrame` (`packages/protocol/src/index.ts`) and `StreamFrame` in `apps/web/src/main.tsx:278`. Use `frame.type === '...'` to narrow.

**Literal-union string types** instead of enums — `SessionStatus = 'running' | 'stopped' | …`, `ProviderName = 'codex' | 'claude' | 'opencode'`. Do not introduce TypeScript `enum`.

**`as const` and `satisfies`:** the providers map in `apps/cli/src/main.ts:34` uses `satisfies Record<ProviderName, Provider>` to keep the literal type narrow while validating shape.

**Generic constrained payloads** — `appendEvent<TPayload extends Record<string, unknown>>(...)` (`apps/gateway/src/store.ts:164`).

**Defensive parsing of external JSON:** treat `c.req.json<{ field?: unknown }>()` results as `unknown`-shaped and check each field's type before use (see `apps/gateway/src/daemon.ts:111`, `:169`).

**No `any`.** When a value is genuinely unknown, type it as `unknown` and narrow.

## Comments and Docs

**Sparse inline comments.** Comments only appear where intent is non-obvious (e.g., the ANSI strip regex note at `apps/gateway/src/daemon.ts:438`, the HTTP polling fallback note at `apps/web/src/main.tsx:471`).

**No JSDoc / TSDoc.** Public functions communicate via TypeScript signatures only. Do not introduce JSDoc unless asked.

**Chinese-language docs** are first-class — `CLAUDE.md`, `PROJECT.md`, `AGENTS.md`, `AI_CONTEXT.md` are in Chinese. Follow the existing language of the file when editing docs.

## React Conventions (web only)

**Single-file app:** `apps/web/src/main.tsx` holds all components. Do not pre-emptively split files unless a component grows large.

**Hooks:** `React.useState`, `React.useEffect`, `React.useCallback`, `React.useRef`, `React.useMemo` referenced via the `React.` namespace, not destructured. Match this style.

**Effect cleanup:** every effect that opens a resource returns a cleanup function. See the long PTY effect at `apps/web/src/main.tsx:367-564`.

**`<StrictMode>`** wraps the app at `apps/web/src/main.tsx:620`.

## Security Conventions (project-specific)

These are codified in `PROJECT.md` and must be followed:

- **Subprocess invocation:** always `spawn(cmd, args[])`. Never use `shell: true` or string concatenation. Reference: `apps/gateway/src/tmux.ts:27`.
- **Daemon binding:** default to `127.0.0.1`. Only bind LAN/`0.0.0.0` when the user explicitly passes `--host`.
- **WebSocket auth:** writes go through the one-time ticket flow. Issue at `POST /api/ws-ticket`, consume in the WS upgrade handler (`apps/gateway/src/daemon.ts:50`, `:254`).
- **Output masking:** terminal output and stored user input pass through `maskSensitiveOutput` (`apps/gateway/src/mask.ts`) before broadcast/persistence. See `apps/gateway/src/pty.ts:113`, `:197`.
- **No arbitrary command execution from clients.** Clients can only send keystrokes to existing PTY/tmux sessions.

## Database Conventions

**SQLite via `better-sqlite3`** in `apps/gateway/src/store.ts`. Patterns:

- Prepared statements built inline in each method, no statement caching.
- `journal_mode = WAL` set on init.
- Schema is created with `CREATE TABLE IF NOT EXISTS` and evolved by an idempotent `migrate()` method that uses `PRAGMA table_info` to add new columns. New columns must have defaults.
- Row shape (`SessionRow`) is `snake_case`; convert at the boundary with `fromRow` / `toRow`.
- Always provide an `ORDER BY` and `LIMIT` clause on event queries; cap the limit (`Math.min(Math.max(limit, 1), 5000)`).

When adding a new column:
1. Add the field to the domain type (`Session`).
2. Add it to `SessionRow` with a snake_case name.
3. Update `fromRow` and `toRow`.
4. Add an `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` branch in `migrate()`.

## File Path Style

**Use `node:` prefix** for built-ins: `node:fs/promises`, `node:path`, `node:crypto`, `node:os`, `node:url`, `node:child_process`, `node:assert/strict`, `node:test`. Do not import `'fs'` or `'path'` without the prefix.

**Relative imports always carry `.js`** (NodeNext requires this for ESM): `from './store.js'`, never `from './store'` or `from './store.ts'`.

---

*Convention analysis: 2026-05-01*
