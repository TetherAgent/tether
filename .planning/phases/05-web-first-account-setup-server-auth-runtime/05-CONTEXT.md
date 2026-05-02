# Phase 05: Web-first Account Setup & Server Auth Runtime - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 implements the Phase 4 account/auth contract as runtime code. It adds `apps/server` as the remote source of truth, implements normal C-end registration/login, separate management-console registration/login, Gateway login and binding, Relay token authentication, authenticated Server notification WebSocket, and identity-bearing audit events.

This phase is the account/auth "door system". It must let a real deployment create accounts, log in, bind a Gateway, authorize Relay/Gateway/session access, and synchronize basic metadata across online devices. It must not build the full management console; workspace/member/device/Gateway administration UI remains Phase 6.

</domain>

<decisions>
## Implementation Decisions

### Server Storage and Configuration
- **D-01:** `apps/server` uses MySQL for Phase 5 runtime data.
- **D-02:** MySQL connection is configured through environment variables that the deployer fills in. Planning should define the exact variable names.
- **D-03:** Phase 5 does not build a schema migration framework. MySQL schema is created by manually executed SQL files.
- **D-03c:** Manual MySQL SQL files should live under `apps/server/sql/`, starting with a bootstrap file such as `apps/server/sql/001_init.sql` when table creation is requested.
- **D-03a:** `apps/server` uses Egg with TypeScript as the server framework. Do not default the new Server service to Hono, even though Gateway/Relay currently use smaller Node HTTP patterns.
- **D-03b:** `apps/server` should use the user's existing Egg plugin baseline where relevant: `egg-cors`, `egg-jwt`, `egg-redis`, `egg-socket.io`, `egg-mysql`, and `egg-bcrypt` are expected for Phase 5 auth/runtime work. `egg-console` may be enabled for operational tooling. `egg-apidoc2` is present but disabled. `egg-oss` may be configured as part of the standard plugin baseline, but Phase 5 must not expand into file upload/storage features unless a scoped use is required.

### C-end Registration and Setup
- **D-04:** Tether is treated as a C-end product. Normal users register through `/register` and log in through `/login`.
- **D-05:** `/setup?token=...` is removed from the Phase 5 required path. The setup-token model adds complexity and is not needed for the current product direction.
- **D-06:** First normal-user registration is not a special account type. It creates a normal Web/session user and the default account/workspace context needed by the runtime.
- **D-07:** Management-console identity remains separate: `/admin/register` and `/admin/login` are independent from normal C-end registration/login. The first management-console registration becomes `super_admin` per Phase 4.

### Web Token Transport
- **D-08:** Web tokens are temporarily stored in `localStorage`.
- **D-09:** Browser requests send tokens through the `Authorization` header.
- **D-10:** This is a v0.3 pragmatic/self-hosted choice, not the long-term security model. Later hardening may move browser auth to httpOnly cookies, CSRF protection, or a stronger storage strategy.

### Password and Account Security
- **D-11:** Phase 5 implements email/password registration and login.
- **D-12:** Passwords must be hashed before storage.
- **D-13:** Login success and failure must be recorded as audit events with safe failure reasons.
- **D-14:** Email verification, password reset, and 2FA are deferred. The planner may leave schema/API extension points but must not expand Phase 5 to fully implement them.
- **D-14a:** Registration is email-only. Phase 5 must not add phone-number registration, username-only registration, social login, or third-party OAuth registration.

### Token Lifetime and Validation
- **D-15:** Server-issued normal, management, and Gateway tokens use a 30-day validity window for Phase 5.
- **D-15a:** Access tokens and refresh tokens both use a 30-day validity window for Phase 5. This applies to normal, management, and Gateway token flows unless the planner identifies a narrower token class that should not have refresh semantics.
- **D-16:** Token classes remain separate as defined in Phase 4: normal client tokens, management tokens, Gateway tokens, refresh/device identity where applicable, and scoped WS tickets.
- **D-17:** Management tokens must not be accepted for terminal/session control.
- **D-18:** Revoked/invalid/cross-account/under-authorized tokens must be rejected by HTTP write endpoints, WS ticket issuance, Gateway publishing, and Relay routing.

### Relay Authentication Strategy
- **D-19:** Relay should validate Server-issued tokens without becoming the ownership source of truth.
- **D-20:** Recommended planning direction: Server signs tokens; Relay validates token class and account/workspace/Gateway/session scope before accepting `/gateway` and `/client` frames.
- **D-21:** Relay remains routing-only. It never accepts provider command/args/env, never starts sessions, never executes commands, and never persists terminal plaintext.
- **D-21a:** Existing shared-secret Relay auth may remain as an explicit development/bootstrap compatibility mode. It must not be the production/default auth path after Phase 5, and must require an obvious env/config opt-in so users do not confuse it with account-token auth.

### Gateway Login and Local Token Storage
- **D-22:** `tether gateway login` prompts for normal account credentials in CLI.
- **D-23:** Gateway login binds the local Gateway to the account/default workspace through `apps/server`.
- **D-24:** Gateway token/cache state is stored locally in `~/.tether/auth.json`.
- **D-25:** `~/.tether/auth.json` must be written with restrictive permissions, target `0600`. Future Keychain integration is deferred.
- **D-26:** If Gateway token refresh fails, expires, or is revoked, Gateway is treated as logged out and must tell the user to run `tether gateway login` again.

### Multi-device Sync
- **D-27:** Same-user multi-device sync uses authenticated Server notification WebSocket.
- **D-28:** Notification WS is metadata/invalidation only. It does not carry terminal output or user input.
- **D-29:** The notification channel should push lightweight events such as session started/stopped, session list refresh, Gateway online/offline, logout, token revoked, device revoked, and auth state changed.
- **D-30:** Clients should treat notifications as "state changed, refetch latest data" instead of relying on the notification payload as the full source of truth.
- **D-31:** Offline queueing, APNs/FCM push, background/sleep state, and complex delivery guarantees remain deferred.

### Web Page Boundary
- **D-32:** Phase 5 Web UI uses shadcn for new account/auth screens.
- **D-33:** Phase 5 includes `/register`, `/login`, `/admin/register`, `/admin/login`, authenticated session access, and Gateway binding/login prompts.
- **D-34:** Full management console pages for users, devices, Gateways, roles, audit browsing, and login analytics remain Phase 6.

### the agent's Discretion
- The planner may choose exact route names under the constraints above, but should prefer the user-facing route names already discussed: `/register`, `/login`, `/admin/register`, `/admin/login`.
- The planner may choose exact MySQL table names, token field names, and API response shapes, but they must preserve Phase 4 identity boundaries and Phase 5 decisions above. Table creation SQL should be placed under `apps/server/sql/`.
- The planner should mark localStorage token storage and 30-day token lifetime as pragmatic v0.3 choices with later hardening paths.
- The planner should not silently switch Phase 5 to short access tokens unless it first records that as a future hardening change; the current decision is access and refresh tokens both 30 days.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Rules
- `AGENTS.md` — Agent entry rules and project reading order.
- `CLAUDE.md` — Coding principles and safety constraints.
- `PROJECT.md` — Project-specific commands, package manager, validation gates, and security constraints.
- `AI_CONTEXT.md` — Architecture context, Gateway/Relay boundaries, and current runtime behavior.
- `docs/README.md` — Documentation governance and current/working doc locations.

### Planning Source of Truth
- `.planning/ROADMAP.md` — Phase 5 goal, dependencies, success criteria, and Phase 6 boundary.
- `.planning/REQUIREMENTS.md` — Requirement IDs: `SERVER-02`, `WEBUI-01`, `SETUP-02`, `AUTH-01` through `AUTH-07`, `RELAY-AUTH-01` through `RELAY-AUTH-03`, `AUDIT-01`, `AUDIT-02`.
- `.planning/PROJECT.md` — Active milestone summary and multi-account Relay Access scope.
- `.planning/STATE.md` — Current GSD phase state.

### Required Prior Phase Contract
- `.planning/phases/04-account-auth-contract/04-ACCOUNT-AUTH-SPEC.md` — Canonical account/auth contract. Must be followed unless this Phase 5 context explicitly supersedes a point.
- `.planning/phases/04-account-auth-contract/04-CONTEXT.md` — Prior discussion decisions for ownership graph, identity realms, token classes, Gateway binding, notification WS, and audit.

### Codebase Intelligence
- `.planning/codebase/STACK.md` — Current TypeScript/pnpm/Hono/React/Vite stack and lack of current shadcn setup.
- `.planning/codebase/ARCHITECTURE.md` — Existing Gateway/Web/Relay responsibilities and PTY event stream architecture.
- `.planning/codebase/INTEGRATIONS.md` — Existing HTTP/WS routes, Relay bootstrap auth, local storage paths, and integration points.
- `.planning/codebase/CONCERNS.md` — Existing auth/security gaps that Phase 5 must close or explicitly constrain.

### Current Feature Docs
- `docs/current/deploy-and-start.md` — Current deploy/start workflow for Relay/Web/Gateway.
- `docs/current/gateway-supervisor.md` — Persistent Gateway, launchd, CLI forwarding, and inline fallback behavior.
- `docs/current/relay-mvp.md` — Existing Personal Relay MVP and shared-secret bootstrap path to replace for production-facing auth.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/relay` already has `/gateway` and `/client` WebSocket surfaces using shared-secret bootstrap auth. Phase 5 should replace or wrap this with Server-issued token auth without making Relay an execution authority.
- Shared-secret Relay auth can remain for development/bootstrap compatibility, but production-facing Relay auth must use Server-issued account/Gateway/client tokens.
- `apps/gateway/src/relay-client.ts` already registers Gateway sessions with Relay and forwards Relay client frames to local PTY sessions. Phase 5 should add Gateway identity/token behavior around this bridge.
- `apps/gateway/src/daemon.ts` already issues one-time local WS tickets and owns HTTP write endpoints. Phase 5 must align ticket issuance and writes with normal client tokens.
- `packages/protocol` already contains Relay frame contracts. Phase 5 should extend shared protocol/types instead of adding ad hoc frame shapes.
- `apps/web` already has React/Vite/xterm session UI. Phase 5 should preserve the terminal surface and layer shadcn auth pages around it.

### Established Patterns
- Gateway owns local PTY sessions and process lifecycle.
- Relay routes frames only; it must not execute commands, accept provider command/args/env, or persist terminal plaintext.
- Browser session WS should use short-lived tickets scoped to a session/mode.
- Terminal output and stored user input must go through masking before being stored or shown externally.
- CLI and Gateway user-facing output should remain Chinese where practical.

### Integration Points
- New `apps/server` must be added to the pnpm workspace and should share types with existing packages.
- `apps/server` should be planned as an Egg + TypeScript service, while existing Gateway/Relay code can keep their current Hono/ws or Node HTTP patterns.
- The user provided an Egg plugin baseline for `apps/server`: `egg-cors`, `egg-jwt`, `egg-redis`, `egg-socket.io`, `egg-mysql`, `egg-bcrypt`, `egg-console`, disabled `egg-apidoc2`, and `egg-oss`. Planner should reuse this style instead of inventing a different server stack.
- `apps/web` talks to `apps/server` for registration/login/token/notification/audit-related APIs, and to Relay/Gateway for session access.
- `tether gateway login` in `apps/cli` talks to `apps/server`, stores Gateway auth state in `~/.tether/auth.json`, and restarts/reconnects Relay publishing as needed.
- `apps/relay` validates Gateway/client auth and routing boundaries using Server-issued or Server-validated identity.
- `apps/gateway` must include account/workspace/user/Gateway/session identity in metadata/audit without trusting client-supplied query fields.

</code_context>

<specifics>
## Specific Ideas

- User chose MySQL for `apps/server`, configured by environment variables.
- User chose Egg + TypeScript as the `apps/server` framework.
- User provided a preferred Egg plugin baseline including CORS, JWT, Redis, Socket.IO, MySQL, bcrypt, console, disabled apidoc, and OSS.
- User explicitly does not want Phase 5 to build migrations.
- User wants MySQL table creation handled by manually executed SQL files under `apps/server/sql/`, to be created later when requested.
- User chose temporary `localStorage` token storage and `Authorization` header transport.
- User accepted email/password with hash and login audit, while deferring email verification, password reset, and 2FA.
- User clarified that registration must be email-only.
- User chose a 30-day token validity window.
- User clarified that both access tokens and refresh tokens are temporarily 30 days.
- User accepted `~/.tether/auth.json` with restrictive permissions for Gateway token storage.
- User accepted the multi-device sync model: notification WebSocket pushes invalidation/metadata, clients refetch current state.
- User questioned `/setup?token=...` and decided it is unnecessary complexity for the C-end product. Use `/register` instead.
- User accepted keeping shared-secret Relay only as explicit development/bootstrap compatibility; production/default auth must use account tokens.

</specifics>

<deferred>
## Deferred Ideas

- httpOnly-cookie browser auth, CSRF hardening, or system secure storage for browser/native credentials.
- Email verification, password reset, and 2FA.
- macOS Keychain storage for Gateway tokens.
- Full management console pages for user/device/Gateway/audit/login analytics operations, tracked in Phase 6.
- Full multi-workspace product support, tracked in Phase 10.
- Session sharing/controller/observer product roles and control arbitration.
- Offline push through APNs/FCM and complex mobile sleep/background state handling.

</deferred>

---

*Phase: 05-Web-first Account Setup & Server Auth Runtime*
*Context gathered: 2026-05-02*
