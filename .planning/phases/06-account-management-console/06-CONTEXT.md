# Phase 6: Account Management Console - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 builds the first management console Web application for operating the Phase 5 auth model. It provides UI surfaces for viewing and administering users, devices, registered Gateways, and audit events — so operators do not need to hand-edit MySQL data or use CLI-only administration.

The console lives in a new `apps/admin-web` package (React + Vite + shadcn). All management API calls go to `apps/server`'s `/admin/api/*` endpoints, authenticated by a management token issued through the already-built `/admin/login` flow.

This phase does NOT build additional auth pages (Phase 5 built `/admin/login` and `/admin/register`), does NOT change Gateway/Relay runtime behavior, and does NOT implement multi-workspace support.

</domain>

<decisions>
## Implementation Decisions

### Code Location and Package Structure
- **D-01:** Management console Web code lives in `apps/admin-web` — a new pnpm monorepo package, NOT inside `apps/web`.
- **D-02:** `apps/admin-web` uses React + Vite + shadcn, same tech stack as `apps/web`.
- **D-03:** `apps/admin-web` shares types and protocol definitions from `packages/` (e.g., `@tether/core`, `@tether/protocol`). No hand-maintained duplicate type contracts.
- **D-04:** `apps/admin-web` calls `apps/server` `/admin/api/*` for all data. It has its own `lib/admin-api.ts` for these request wrappers.

### Server API Organization
- **D-05:** `apps/server` gains a new `/admin/api/*` route group for all Phase 6 management endpoints, authenticated via `app/middleware/admin-auth.ts` (validates management token).
- **D-06:** Server-side code layout: `app/controller/admin/` (users, devices, gateways, audit, admins), `app/service/admin/`, `app/middleware/admin-auth.ts`.
- **D-07:** Phase 6 management API covers: user list + login analytics, device list + revoke, Gateway list + unlink, audit log query + pagination, management user management (list/add/remove).

### Console Layout and Navigation
- **D-08:** Layout: left sidebar navigation + top header bar. Sidebar contains the 5 menu items; header shows current page title and logged-in admin account.
- **D-09:** Route structure: `/admin/*` prefix throughout — consistent with Phase 5's `/admin/login` and `/admin/register`.
- **D-10:** Five sidebar menu items: 概览 (`/admin/dashboard`), 用户 (`/admin/users`), 设备 (`/admin/devices`), Gateway (`/admin/gateways`), 审计 (`/admin/audit`).
- **D-11:** Layout is shared via React Router nested routes with a single `AdminLayout` wrapper component. Pages only render their content area; sidebar and header are provided by `AdminLayout`.
- **D-12:** `AdminLayout` includes a route-level auth guard: no valid management token → redirect to `/admin/login`.

### Role and Permission Model (v0.3 simplified)
- **D-13:** v0.3 uses a single management access level: anyone who can log in to the admin console has full access to all management features.
- **D-14:** The `super_admin` / `admin` role distinction is retained in the database and token payload but the UI does NOT differentiate — no hidden menus, no permission checks, no role indicator. Role-based UI differentiation is deferred.
- **D-15:** `admin` login uses the management token issued by Phase 5's `/admin/login` endpoint. The token is stored in `localStorage` (consistent with Phase 5 decisions).

### Device Management UX
- **D-16:** Device list columns: 设备名 / 类型 / 在线状态 / 最后在线时间 / 吊销按钮.
- **D-17:** Notification WebSocket online state is NOT displayed (data unreliable at this phase). Online state comes from the `devices` table in MySQL.
- **D-18:** Revoking a device requires a confirmation dialog ("确定吊销设备 X？此操作不可撤销") before the API call is made.
- **D-19:** After successful revoke: remove the row from the list in-place without full-page refresh.

### Gateway Management UX
- **D-20:** Gateway list columns: Gateway ID / 最后认证时间 / 在线状态 / 取消链接按钮.
- **D-21:** Online state and last-auth-time come from `apps/server` registration records only — no real-time health probe to the Gateway process (avoids latency and implementation complexity).
- **D-22:** Unlinking a Gateway requires a confirmation dialog before API call. Success → remove row from list in-place.

### Claude's Discretion
- Exact shadcn component choices for tables, dialogs, sidebar, and header (use whichever shadcn primitives fit best).
- Exact pagination size for device, Gateway, and audit lists.
- Exact Chinese wording for confirmation dialogs and status labels.
- Whether `apps/admin-web` shares a Vite/tsconfig template with `apps/web` or starts fresh.
- Exact field names and response shapes for `/admin/api/*` endpoints, as long as they satisfy the data requirements in D-07.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Source of Truth
- `.planning/ROADMAP.md` — Phase 6 goal, success criteria (8 items), and dependencies. Read the full Phase 6 section before planning.
- `.planning/REQUIREMENTS.md` — Requirement IDs: `WEBUI-01`, `MGMT-01` through `MGMT-06`.
- `.planning/PROJECT.md` — Active milestone context, monorepo structure, and constraints.
- `.planning/STATE.md` — Current phase state and last recorded decisions.

### Prior Phase Contracts
- `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-CONTEXT.md` — Token model (management tokens, localStorage, Authorization header), Egg plugin baseline, MySQL schema approach, `/admin/login` and `/admin/register` already built.
- `.planning/phases/04-account-auth-contract/04-ACCOUNT-AUTH-SPEC.md` — Canonical account/auth contract; defines management token class and super_admin/admin roles.

### Project Rules
- `AGENTS.md` — Repository collaboration rules and doc reading order.
- `CLAUDE.md` — Coding principles: scoped changes, no over-engineering.
- `AI_CONTEXT.md` — Current architecture, Gateway/Relay/Server boundaries.

### Codebase Intelligence
- `.planning/codebase/STACK.md` — Current pnpm workspace, TypeScript/tsx runtime, shadcn setup state.
- `.planning/codebase/ARCHITECTURE.md` — Existing apps/web, apps/gateway, apps/server structure and entry points.
- `.planning/codebase/INTEGRATIONS.md` — Existing API surfaces and auth integration points.

### Existing Web Code Reference
- `apps/web/src/pages/admin-login-page.tsx` — Already-built admin login page (Phase 5). Reference for shadcn auth patterns.
- `apps/web/src/components/ui/` — Existing shadcn components (card, label, button, input, form). `apps/admin-web` should mirror or reuse this setup.
- `apps/web/src/lib/api.ts` — Existing API client pattern. `apps/admin-web/src/lib/admin-api.ts` should follow the same convention.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 5 already built `/admin/login` and `/admin/register` in `apps/web`. `apps/admin-web` can redirect unauthenticated requests to the same login flow, or replicate a lightweight login form — planner decides.
- `apps/web/src/components/ui/` — card, label, button, input, form shadcn components available as reference patterns for `apps/admin-web`.
- `apps/server` Egg plugin baseline already includes `egg-jwt`, `egg-mysql`, `egg-redis`, `egg-socket.io`, `egg-cors`, `egg-bcrypt`. Admin auth middleware can reuse `egg-jwt` validation.

### Established Patterns
- Management token stored in `localStorage`, sent via `Authorization` header — consistent with Phase 5 normal user token.
- Egg controller/service/middleware layering is the `apps/server` pattern. Admin routes follow the same convention under `app/controller/admin/`.
- pnpm workspace package: add `apps/admin-web` to `pnpm-workspace.yaml`, add `package.json` with workspace dependencies.
- Subprocess/shell safety and provider whitelist constraints do NOT apply to `apps/admin-web` (it is a pure Web UI).

### Integration Points
- `apps/admin-web` → `apps/server /admin/api/*`: all data read/write for Phase 6 management UI.
- `apps/server app/middleware/admin-auth.ts` → validates management JWT issued by Phase 5 `/admin/login`.
- `apps/server` Phase 6 API must query: `users` table (list, login count, last login), `devices` table (per-user devices, online state, last seen, revoke), `gateways` table (list, last auth time, online state, unlink), `audit_events` table (filtered query, pagination), management `admins` table (list, add, remove).

</code_context>

<specifics>
## Specific Ideas

- 管理控制台是独立的 `apps/admin-web` 包，不合并进 `apps/web`，两者可独立部署。
- Server 端管理 API 全部挂载在 `/admin/api/*`，通过 `admin-auth` 中间件统一鉴权。
- v0.3 单一权限级别：登录即全权，无需在 UI 层做角色判断。
- 吊销设备和取消链接 Gateway 都需要确认对话框，避免误操作；成功后就地更新列表。
- Gateway 状态展示来自 Server 注册记录，不做实时 HTTP 探测。

</specifics>

<deferred>
## Deferred Ideas

- **super_admin vs admin UI 差异化** — 角色字段保留在数据库，但 UI 权限分层推后到后续版本。
- **通知 WebSocket 在线状态实时展示** — 设备 WS 连接状态展示推后，当前只展示数据库记录的在线/离线。
- **系统/安全设置页面** — ROADMAP 列为 super_admin 功能，v0.3 不实现，菜单中不展示。
- **Gateway 实时健康探测** — 直接 HTTP ping Gateway 展示实时响应状态，v0.3 只展示 Server 侧注册记录。
- **多工作区支持** — Phase 10 范围。

</deferred>

---

*Phase: 6-Account Management Console*
*Context gathered: 2026-05-03*
