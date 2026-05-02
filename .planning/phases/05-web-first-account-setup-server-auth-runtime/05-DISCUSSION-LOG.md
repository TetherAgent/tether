# Phase 05: Web-first Account Setup & Server Auth Runtime - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 05-web-first-account-setup-server-auth-runtime
**Areas discussed:** Server storage, Web token transport, password/login boundary, token lifetime, Gateway token storage, multi-device sync, setup/register boundary

---

## Server Storage

| Option | Description | Selected |
|--------|-------------|----------|
| MySQL via env vars | `apps/server` uses MySQL and reads connection settings from environment variables. | ✓ |
| SQLite | Simpler local bootstrap but weaker fit for hosted server deployment. | |
| Postgres | Strong production default but not chosen for this project right now. | |

**User's choice:** Use MySQL. Create environment variables for the user to fill later. Do not build migrations in Phase 5. MySQL tables should be created by manually executed SQL files.
**Notes:** Planner should define exact environment variable names. User later clarified `apps/server` should use Egg + TypeScript and provided an Egg plugin baseline: `egg-cors`, `egg-jwt`, `egg-redis`, `egg-socket.io`, `egg-mysql`, `egg-bcrypt`, `egg-console`, disabled `egg-apidoc2`, and `egg-oss`. Put SQL under `apps/server/sql/`, starting with `apps/server/sql/001_init.sql` when table creation is requested.

---

## Web Token Transport

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage + Authorization header | Fastest to implement and easy to debug for early self-hosted use. | ✓ |
| httpOnly cookies | Safer browser model, but requires CSRF/session-cookie design now. | |

**User's choice:** Temporarily use `localStorage`; send token through request headers.
**Notes:** Record as a pragmatic v0.3 choice, not the final security model.

---

## Password and Login Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Email/password baseline | Hash passwords, record login success/failure audit, defer email verification/reset/2FA. | ✓ |
| Full account security suite | Include email verification, password reset, and 2FA immediately. | |

**User's choice:** Use the recommended baseline.
**Notes:** The planner may leave extension points, but should not expand Phase 5 scope. User later clarified registration must be email-only; do not add phone-number, username-only, social login, or third-party OAuth registration.

---

## Token Lifetime

| Option | Description | Selected |
|--------|-------------|----------|
| 30-day token validity | Easier early user experience and fewer relogins. | ✓ |
| Short access tokens + refresh rotation | Stronger security posture but more moving parts in Phase 5. | |

**User's choice:** Sign tokens for 30 days. User later clarified access tokens and refresh tokens are both temporarily 30 days.
**Notes:** This should still preserve token class separation and revoke checks. Short access token + long refresh token can be a later hardening change.

---

## Gateway Token Storage

| Option | Description | Selected |
|--------|-------------|----------|
| `~/.tether/auth.json` with `0600` permissions | Simple and consistent with current local config files. | ✓ |
| macOS Keychain | Stronger local secret storage but more platform-specific work. | |

**User's choice:** Use the recommended local auth file first.
**Notes:** Future Keychain integration is deferred.

---

## Relay Compatibility Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Keep shared-secret as dev/bootstrap mode | Existing `relaySecret` path remains available only with explicit opt-in for development or bootstrap compatibility. | ✓ |
| Remove shared-secret immediately | Force every Relay connection through account/Gateway/client token auth after Phase 5. | |

**User's choice:** Keep shared-secret Relay only as explicit development/bootstrap compatibility.
**Notes:** Production/default auth path must use Server-issued account/Gateway/client tokens after Phase 5.

---

## Multi-device Sync

| Option | Description | Selected |
|--------|-------------|----------|
| Notification WS + client refetch | Server tells online devices that state changed; clients pull latest state. | ✓ |
| Full event queue/delta stream | More precise but more complex, including replay/offline delivery questions. | |

**User's choice:** Use lightweight notification and refetch.
**Notes:** User asked for explanation. Clarified that Server notification WS does not carry terminal bytes; it only pushes metadata/invalidation such as session/gateway/auth/device state changes.

---

## Setup vs Register

| Option | Description | Selected |
|--------|-------------|----------|
| `/setup?token=...` | Protected first-registration flow for empty deployments. | |
| `/register` as normal C-end registration | Simpler C-end model; first user is just a normal user, not a separate setup identity. | ✓ |

**User's choice:** Remove `/setup?token=...` from the Phase 5 required path because it adds unnecessary complexity.
**Notes:** Management-console registration remains separate. `/admin/register` creates the first management `super_admin`; `/login` and `/register` are for normal C-end users.

---

## the agent's Discretion

- Define exact MySQL environment variable names.
- Choose exact MySQL table names and startup/bootstrap SQL shape.
- Choose exact route grouping as long as user-facing routes preserve `/register`, `/login`, `/admin/register`, and `/admin/login`.
- Choose exact token/JWT implementation details while preserving Phase 4 token classes and Phase 5 30-day validity decision.

## Deferred Ideas

- Browser httpOnly cookie auth and CSRF hardening.
- Email verification, password reset, and 2FA.
- macOS Keychain for Gateway token storage.
- Full management console pages in Phase 6.
- Full multi-workspace and session-sharing features in later phases.
