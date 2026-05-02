# Phase 05: Web-first Account Setup & Server Auth Runtime - Research

**Researched:** 2026-05-02
**Domain:** Auth runtime — Egg.js server, MySQL, JWT, shadcn/ui, Relay token auth, Gateway CLI login
**Confidence:** HIGH (codebase), MEDIUM (Egg.js ecosystem patterns)

---

## Summary

Phase 5 builds the "door system" for Tether's multi-account Relay Access milestone. It introduces `apps/server` as a brand-new Egg + TypeScript service (MySQL-backed, never existed before), wires shadcn/ui into the existing React/Vite `apps/web` (no Tailwind today), adds `tether gateway login` to `apps/cli`, replaces shared-secret auth in `apps/relay` with token validation, and adds token checks to `apps/gateway` HTTP/WS endpoints.

The Phase 4 `04-ACCOUNT-AUTH-SPEC.md` is the authoritative contract. Every implementation decision not already locked in `05-CONTEXT.md` must follow the spec. The five-service integration surface (server, relay, gateway, web, cli) is the main complexity — getting token formats, scope fields, and auth middleware consistent across all five is the primary coordination risk.

Key findings: Egg.js 3.x has stable TypeScript + Controller/Service/Middleware/Router patterns with the exact plugin set the user selected. shadcn/ui 4.x uses `npx shadcn@latest init -t vite` for Vite projects and requires Tailwind CSS 4 in apps/web (not currently installed). The Relay auth upgrade is a surgical addition: a new token-validation function wraps the existing `handleGateway`/`handleClient` paths. `apps/server` does not exist — it is a full greenfield bootstrap including pnpm workspace registration, tsconfig, Egg boot files, and SQL schema under `apps/server/sql/`.

**Primary recommendation:** Bootstrap `apps/server` as a standalone pnpm workspace package with the Egg + TypeScript scaffold first, because all other components depend on the token format it issues. Then add shadcn/ui to `apps/web`. Then upgrade Relay auth. Then upgrade Gateway and CLI.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Server Storage and Configuration**
- D-01: `apps/server` uses MySQL for Phase 5 runtime data.
- D-02: MySQL connection is configured through environment variables.
- D-03: Phase 5 does not build a schema migration framework. MySQL schema is created by manually executed SQL files.
- D-03c: Manual MySQL SQL files live under `apps/server/sql/`, starting with `apps/server/sql/001_init.sql`.
- D-03a: `apps/server` uses Egg with TypeScript. Do not default the new Server service to Hono.
- D-03b: Egg plugin baseline: `egg-cors`, `egg-jwt`, `egg-redis`, `egg-socket.io`, `egg-mysql`, `egg-bcrypt`, `egg-console`. `egg-apidoc2` present but disabled. `egg-oss` configured but Phase 5 must not expand into file upload/storage.

**C-end Registration**
- D-04: Tether is a C-end product. Normal users register at `/register` and log in at `/login`.
- D-05: `/setup?token=...` is removed from Phase 5. Use `/register` instead.
- D-06: First normal-user registration creates a normal Web/session user and the default account/workspace context.
- D-07: Management console has separate `/admin/register` and `/admin/login` flows. First management-console registration becomes `super_admin`.

**Web Token Transport**
- D-08: Web tokens temporarily stored in `localStorage`.
- D-09: Browser requests send tokens through the `Authorization` header.
- D-10: v0.3 pragmatic choice; later hardening may move to httpOnly cookies.

**Password and Account Security**
- D-11: Phase 5 implements email/password registration and login.
- D-12: Passwords must be hashed before storage.
- D-13: Login success and failure must be recorded as audit events with safe failure reasons.
- D-14: Email verification, password reset, and 2FA are deferred.
- D-14a: Registration is email-only. No phone, username-only, social, or OAuth registration.

**Token Lifetime and Validation**
- D-15: Server-issued normal, management, and Gateway tokens use 30-day validity.
- D-15a: Access tokens and refresh tokens both use 30-day validity.
- D-16: Token classes remain separate per Phase 4 contract.
- D-17: Management tokens must not be accepted for terminal/session control.
- D-18: Revoked/invalid/cross-account/under-authorized tokens must be rejected by HTTP write endpoints, WS ticket issuance, Gateway publishing, and Relay routing.

**Relay Authentication Strategy**
- D-19: Relay validates Server-issued tokens without becoming the ownership source of truth.
- D-20: Server signs tokens; Relay validates token class and account/workspace/Gateway/session scope.
- D-21: Relay remains routing-only.
- D-21a: Existing shared-secret Relay auth may remain as explicit development/bootstrap compatibility. Must require obvious env/config opt-in. Must not be the production/default path.

**Gateway Login and Local Token Storage**
- D-22: `tether gateway login` prompts for normal account credentials in CLI.
- D-23: Gateway login binds the local Gateway to the account/default workspace through `apps/server`.
- D-24: Gateway token/cache state stored locally in `~/.tether/auth.json`.
- D-25: `~/.tether/auth.json` written with permissions `0600`. Future Keychain integration deferred.
- D-26: Gateway token refresh failure, expiry, or revocation means logged out; user must run `tether gateway login` again.

**Multi-device Sync**
- D-27: Same-user multi-device sync uses authenticated Server notification WebSocket.
- D-28: Notification WS is metadata/invalidation only.
- D-29: Notification channel pushes session started/stopped, session list refresh, Gateway online/offline, logout, token revoked, device revoked, and auth state changed.
- D-30: Clients treat notifications as "state changed, refetch latest data".
- D-31: Offline queueing, APNs/FCM push, background/sleep state deferred.

**Web Page Boundary**
- D-32: Phase 5 Web UI uses shadcn for new account/auth screens.
- D-33: Phase 5 includes `/register`, `/login`, `/admin/register`, `/admin/login`, authenticated session access, and Gateway binding/login prompts.
- D-34: Full management console pages remain Phase 6.

### Claude's Discretion
- Exact route names under the constraints above; prefer `/register`, `/login`, `/admin/register`, `/admin/login`.
- Exact MySQL table names, token field names, and API response shapes (must preserve Phase 4 identity boundaries).
- `localStorage` token storage and 30-day token lifetime should be marked as pragmatic v0.3 choices with later hardening paths.
- Must not silently switch Phase 5 to short access tokens.

### Deferred Ideas (OUT OF SCOPE)
- httpOnly-cookie browser auth, CSRF hardening, or system secure storage for browser/native credentials.
- Email verification, password reset, and 2FA.
- macOS Keychain storage for Gateway tokens.
- Full management console pages for user/device/Gateway/audit/login analytics (Phase 6).
- Full multi-workspace product support (Phase 10).
- Session sharing/controller/observer product roles and control arbitration.
- Offline push through APNs/FCM and complex mobile sleep/background state handling.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SERVER-01 | Introduce dedicated remote `apps/server` service boundary owning account, user, workspace, device, Gateway registration, token issuance/refresh/revoke, authorization checks, and audit ingestion | Egg 3.x + TypeScript scaffold pattern documented; plugin baseline verified via npm |
| SERVER-02 | Keep service responsibilities separate: relay authenticates and routes only; gateway owns local sessions; web hosts setup/login/session/admin UI | Architectural boundary analysis in codebase confirms separation is feasible |
| WEBUI-01 | `apps/web` uses shadcn as the standard component system for setup, login, authenticated session access | shadcn 4.x Vite init pattern verified; Tailwind CSS 4 required in apps/web |
| SETUP-02 | Setup closes once an owner exists; normal access uses `/login` and issued client tokens; CLI bootstrap is emergency/admin recovery only | Egg controller pattern documented; first-user detection query is simple |
| SETUP-03 | Management console has its own registration and login flow separate from normal users; first management-console account registered becomes `super_admin` | Separate `/admin/register` + `/admin/login` routes in Egg documented |
| AUTH-01 | External Web/native clients log in to remote Server through shadcn-based Web login flow; receive short-lived access token plus refresh token; management login is separate | JWT issuance via `egg-jwt` documented |
| AUTH-02 | `tether gateway login` authenticates to remote Server via CLI prompts; binds Gateway to account/workspace; receives or refreshes Gateway token; treats token expiry as logged out | `readline` prompt in CLI; `~/.tether/auth.json` with 0600 permissions |
| AUTH-03 | All session endpoints reject requests without valid normal client token for owning user/session | Egg middleware pattern for token validation documented |
| AUTH-04 | Browser WebSocket connections use HTTP token auth to obtain short-lived, single-use WS ticket scoped to account/workspace/Gateway/session/mode | Existing ticket pattern in `daemon.ts` to extend with scope fields |
| AUTH-05 | Token revoke, device revoke, logout, management logout, and Gateway unlink enforced | MySQL revoke table pattern; Relay closes connections on next auth check |
| AUTH-06 | v0.3 normal Web/session access is single-user ownership; multi-user session sharing deferred | Single-owner check is straightforward scope comparison |
| AUTH-07 | Multi-device sync uses authenticated Server notification WebSocket after login; pushes lightweight account/device/session state changes | `egg-socket.io` provides authenticated WS with room-based push |
| RELAY-AUTH-01 | Relay Gateway WS (`/gateway`) and Client WS (`/client`) require valid tokens; Relay validates token class and scope | Relay `handleGateway`/`handleClient` identified as injection points |
| RELAY-AUTH-02 | Relay routes frames only within authorized account/workspace/Gateway/session boundary | Relay needs per-connection scope state; current code has `gatewayId` but no `accountId` |
| RELAY-AUTH-03 | Relay remains non-executing infrastructure | Already enforced by existing `FORBIDDEN_KEYS` and routing-only architecture |
| AUDIT-01 | Identity-bearing audit events for login, logout, refresh, device/Gateway, client attach/detach, input, resize, session, management actions, and Relay auth failures | Audit service in `apps/server` writes to MySQL `audit_events` table |
| AUDIT-02 | Stored and streamed events continue to mask secrets/API keys; identity metadata must not include raw tokens | Existing `maskSensitiveOutput` in Gateway maintained; audit payloads filter token fields |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Account/user registration and login | API (apps/server) | Web (apps/web — UI form) | Server is source of truth per D-01 through D-03; Web renders the form |
| Management console registration and login | API (apps/server) | Web (apps/web — UI form) | Separate realm from normal users per D-07 |
| JWT token issuance, refresh, revoke | API (apps/server) | — | Server owns all tokens; no other tier issues tokens |
| Gateway binding and registration | API (apps/server) | CLI (apps/cli — initiates login) | Server records the binding; CLI drives the flow |
| Gateway token storage | CLI / local (~/.tether/auth.json) | — | D-24/D-25; local file with 0600 permissions |
| Relay WebSocket authentication | Relay (apps/relay) | API (apps/server — validates token or provides public key) | Relay validates on connect; Server is authority but Relay does the check locally |
| Session ownership authorization | Gateway (apps/gateway) | API (apps/server — provides revoke list) | Gateway checks token scope for direct mode; Relay checks for relay-routed mode |
| WS ticket issuance | Gateway (apps/gateway) | — | Existing pattern in daemon.ts; extend to include scope fields |
| Server notification WebSocket | API (apps/server) | — | `egg-socket.io`-backed push channel owned by Server |
| Audit event ingestion | API (apps/server) | Gateway (apps/gateway — sends audit calls) | Server stores to MySQL; Gateway emits identity-bearing events |
| shadcn-based auth UI pages | Frontend (apps/web) | — | React/Vite; shadcn components added to existing app |
| Password hashing | API (apps/server) | — | `egg-bcrypt` plugin; never hash in browser |
| MySQL schema definition | SQL files (apps/server/sql/) | — | D-03c; no ORM migration framework |

---

## Standard Stack

### Core — apps/server
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| egg | 3.34.0 | HTTP framework, plugin system, process management | User-specified D-03a; established TypeScript support |
| egg-jwt | 3.1.7 | JWT middleware and signing | User-specified in plugin baseline |
| egg-mysql | 5.0.0 | MySQL connection pool | User-specified; wraps mysql2 |
| egg-redis | 2.6.1 | Redis for refresh-token revocation, rate limiting | User-specified |
| egg-bcrypt | 1.1.0 | Password hashing/verify | User-specified |
| egg-socket.io | 4.1.6 | Notification WebSocket channel | User-specified |
| egg-cors | 3.0.1 | CORS for Web → Server calls | User-specified |
| egg-console | 2.0.1 | Operational tooling | User-specified |
| jsonwebtoken | (transitive via egg-jwt) | JWT sign/verify | Used internally by egg-jwt |
| typescript | ^5.8.3 | Type safety | Matches monorepo standard |

### Core — apps/web additions
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tailwindcss | 4.2.4 | Required by shadcn/ui v4 | shadcn 4.x depends on Tailwind 4 |
| @tailwindcss/vite | (bundled with tailwindcss 4) | Vite plugin for Tailwind 4 | Replaces postcss-based Tailwind config |
| shadcn (CLI) | 4.6.0 | Component scaffolding CLI | `npx shadcn@latest init -t vite --monorepo` |
| react-hook-form | (added by shadcn) | Form state management | shadcn form pattern |
| zod | (added by shadcn) | Schema validation | shadcn form pattern |
| @hookform/resolvers | (added by shadcn) | zod resolver bridge | shadcn form pattern |
| class-variance-authority | (added by shadcn) | Component variant styling | shadcn internal |
| clsx / tailwind-merge | (added by shadcn) | className utilities | shadcn internal |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tether/protocol | workspace:* | Extend Relay frame types for auth | When adding token fields to Relay frames |
| @tether/core | workspace:* | Shared scalar types | When apps/server needs ProviderName or similar |
| mysql2 | (transitive via egg-mysql) | MySQL protocol driver | Not used directly; through ctx.mysql |
| ioredis | (transitive via egg-redis) | Redis client | Not used directly; through ctx.redis |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| egg | hono (existing stack) | User explicitly rejected Hono for apps/server (D-03a); Egg provides plugin system matching user's baseline |
| egg-jwt | jsonwebtoken directly | egg-jwt wraps jsonwebtoken and integrates with Egg middleware pipeline cleanly |
| egg-mysql | Prisma/Drizzle ORM | User rejected migration frameworks (D-03); raw SQL with egg-mysql matches the decision |
| localStorage tokens | httpOnly cookies | D-10 explicitly defers cookie/CSRF hardening |
| shadcn 4.x | shadcn 3.x (older) | 4.x is latest stable with Vite support; use latest |

**Installation:**
```bash
# apps/server bootstrap
cd apps/server
pnpm add egg egg-jwt egg-redis egg-socket.io egg-mysql egg-bcrypt egg-cors egg-console
pnpm add -D typescript @types/node tsx

# apps/web shadcn initialization (run from apps/web directory)
pnpm add tailwindcss @tailwindcss/vite
npx shadcn@latest init -t vite
# then add components as needed:
npx shadcn@latest add button input form card label
```

**Version verification:** [VERIFIED: npm registry]
- egg: 3.34.0
- egg-jwt: 3.1.7
- egg-mysql: 5.0.0
- egg-redis: 2.6.1
- egg-bcrypt: 1.1.0
- egg-socket.io: 4.1.6
- egg-cors: 3.0.1
- egg-console: 2.0.1
- shadcn (CLI): 4.6.0
- tailwindcss: 4.2.4

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (apps/web)
  ├── /register, /login          → POST apps/server /api/auth/register, /api/auth/login
  ├── /admin/register, /admin/login → POST apps/server /api/admin/auth/register, /api/admin/auth/login
  ├── Authorization: Bearer <token> header on all API calls
  ├── Notification WS             → apps/server /notifications (egg-socket.io, authenticated)
  └── Session WS (existing)      → apps/gateway /api/sessions/:id/stream (ticket-gated, unchanged)

CLI (apps/cli)
  └── tether gateway login
        ├── prompt email/password
        ├── POST apps/server /api/gateway/bind  → receive gatewayToken + gatewayRefreshToken
        └── write ~/.tether/auth.json (mode 0600)

Gateway (apps/gateway) daemon.ts
  ├── POST /api/ws-ticket         → NOW validates Authorization: Bearer <normal_client_access_token>
  ├── POST /api/sessions/:id/input → NOW validates token scope (accountId, sessionId ownership)
  ├── POST /api/sessions/:id/stop → NOW validates token scope
  └── relay-client.ts             → reads ~/.tether/auth.json, uses gatewayToken for Relay auth

Relay (apps/relay)
  ├── /gateway WS                 → validates gateway.auth frame carries gatewayToken (not secret)
  │                                 fallback: shared secret if TETHER_RELAY_ALLOW_LEGACY_SECRET=1
  ├── /client WS                  → validates client.auth frame carries normal_client_access_token
  └── routes frames only within same accountId/workspaceId/gatewayId/sessionId boundary

apps/server (NEW — Egg + TypeScript)
  ├── POST /api/auth/register        → create account+workspace+user+device, issue tokens
  ├── POST /api/auth/login           → verify password, issue tokens, record audit
  ├── POST /api/auth/refresh         → refresh normal client access token
  ├── POST /api/auth/logout          → invalidate refresh token, record audit
  ├── POST /api/admin/auth/register  → create management user (first = super_admin)
  ├── POST /api/admin/auth/login     → management login, management-scoped tokens
  ├── POST /api/admin/auth/logout    → invalidate management refresh token
  ├── POST /api/gateway/bind         → bind Gateway, issue gatewayToken + gatewayRefreshToken
  ├── POST /api/gateway/refresh      → refresh gatewayToken
  ├── POST /api/token/validate       → used by Relay to validate tokens (or Relay uses JWT public key directly)
  ├── POST /api/token/revoke         → revoke token (adds jti to Redis blocklist)
  ├── POST /api/audit                → ingest audit events
  ├── GET  /api/auth/me              → current user identity
  └── /notifications (egg-socket.io) → authenticated push channel
```

### Recommended Project Structure

```
apps/server/
├── package.json              # @tether/server, "type": "commonjs" (Egg requires CJS)
├── tsconfig.json             # extends ../../tsconfig.base.json, target: ES2020
├── app.ts                    # Egg application bootstrap
├── agent.ts                  # Egg agent process (optional)
├── config/
│   ├── config.default.ts     # default config, reads process.env
│   └── plugin.ts             # enables egg-cors, egg-jwt, egg-redis, egg-mysql, etc.
├── app/
│   ├── router.ts             # all routes
│   ├── controller/
│   │   ├── auth.ts           # /api/auth/* normal user endpoints
│   │   ├── admin_auth.ts     # /api/admin/auth/* management endpoints
│   │   ├── gateway.ts        # /api/gateway/* Gateway binding
│   │   ├── token.ts          # /api/token/validate, /api/token/revoke
│   │   └── audit.ts          # /api/audit
│   ├── service/
│   │   ├── user.ts           # user creation, lookup
│   │   ├── auth.ts           # login, token issuance, refresh, revoke
│   │   ├── admin_auth.ts     # management user login/token
│   │   ├── gateway.ts        # Gateway binding, token
│   │   ├── notification.ts   # push notification WS events
│   │   └── audit.ts          # audit event ingestion
│   ├── middleware/
│   │   └── auth.ts           # JWT verification middleware, token class check
│   └── extend/
│       └── application.ts    # app-level helpers
└── sql/
    └── 001_init.sql          # schema: accounts, workspaces, users, admin_users, devices,
                              #         gateways, refresh_tokens, gateway_tokens, audit_events

apps/web/src/
├── main.tsx                  # existing — add router and auth context
├── components/ui/            # shadcn generated components
├── pages/
│   ├── RegisterPage.tsx      # /register — email/password form
│   ├── LoginPage.tsx         # /login — email/password form
│   ├── AdminRegisterPage.tsx # /admin/register
│   └── AdminLoginPage.tsx    # /admin/login
├── contexts/
│   └── AuthContext.tsx       # localStorage token storage, Authorization header
└── hooks/
    └── useAuth.ts            # login/logout/refresh helpers
```

### Pattern 1: Egg TypeScript Controller with JWT Middleware

**What:** Egg controller class with auth middleware enforcing token class
**When to use:** All apps/server endpoints that require authentication

```typescript
// Source: https://github.com/eggjs/egg/blob/next/site/docs/tutorials/typescript.md
// app/controller/auth.ts
import { Controller } from 'egg';

export default class AuthController extends Controller {
  public async login() {
    const { ctx, service } = this;
    const { email, password } = ctx.request.body as { email: string; password: string };
    const result = await service.auth.login(email, password);
    if (!result.ok) {
      ctx.status = 401;
      ctx.body = { error: 'invalid_credentials' };
      return;
    }
    ctx.body = { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }
}
```

### Pattern 2: Egg JWT Middleware — Token Class Guard

**What:** Middleware that verifies JWT and rejects wrong token class
**When to use:** Route-level auth; separate middleware for normal_client vs management_access vs gateway tokens

```typescript
// app/middleware/auth.ts
import { Application, Context } from 'egg';

export default function authMiddleware(options: { tokenClass: string }, app: Application) {
  return async function auth(ctx: Context, next: () => Promise<void>) {
    const header = ctx.get('Authorization');
    if (!header.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'missing_token' };
      return;
    }
    const token = header.slice(7);
    try {
      const payload = app.jwt.verify(token, app.config.jwt.secret) as Record<string, unknown>;
      if (payload.tokenClass !== options.tokenClass) {
        ctx.status = 403;
        ctx.body = { error: 'wrong_token_class' };
        return;
      }
      // Check jti blocklist in Redis
      const revoked = await ctx.redis.get(`revoked:${payload.jti as string}`);
      if (revoked) {
        ctx.status = 401;
        ctx.body = { error: 'token_revoked' };
        return;
      }
      ctx.state.tokenPayload = payload;
      await next();
    } catch {
      ctx.status = 401;
      ctx.body = { error: 'invalid_token' };
    }
  };
}
```

### Pattern 3: Egg Configuration from Environment Variables

**What:** `config/config.default.ts` reading env vars for MySQL, Redis, JWT secret
**When to use:** All apps/server runtime configuration — no hardcoded values

```typescript
// Source: https://github.com/eggjs/egg/blob/next/site/docs/tutorials/typescript.md
// config/config.default.ts
import { EggAppConfig, PowerPartial } from 'egg';

export default (): PowerPartial<EggAppConfig> => ({
  mysql: {
    client: {
      host:     process.env.TETHER_SERVER_MYSQL_HOST     ?? '127.0.0.1',
      port:     Number(process.env.TETHER_SERVER_MYSQL_PORT ?? '3306'),
      user:     process.env.TETHER_SERVER_MYSQL_USER     ?? 'tether',
      password: process.env.TETHER_SERVER_MYSQL_PASSWORD ?? '',
      database: process.env.TETHER_SERVER_MYSQL_DATABASE ?? 'tether',
    },
    app: true,
    agent: false,
  },
  redis: {
    client: {
      host:     process.env.TETHER_SERVER_REDIS_HOST ?? '127.0.0.1',
      port:     Number(process.env.TETHER_SERVER_REDIS_PORT ?? '6379'),
      password: process.env.TETHER_SERVER_REDIS_PASSWORD ?? '',
      db:       0,
    },
  },
  jwt: {
    secret: process.env.TETHER_SERVER_JWT_SECRET ?? '',
    // 30 days in seconds
    expiresIn: '30d',
  },
});
```

### Pattern 4: shadcn/ui Vite + React Form with Zod Validation

**What:** Login form using shadcn Button, Input, Form primitives with react-hook-form + zod
**When to use:** All auth pages in apps/web

```tsx
// Source: https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/forms/react-hook-form.mdx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export function LoginPage() {
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(data: z.infer<typeof loginSchema>) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const body = await res.json()
    if (!res.ok) { form.setError('root', { message: body.error }); return; }
    localStorage.setItem('tether_access_token', body.accessToken)
    localStorage.setItem('tether_refresh_token', body.refreshToken)
    // redirect to /
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        {/* password field similar */}
        <Button type="submit">Login</Button>
      </form>
    </Form>
  )
}
```

### Pattern 5: Relay Token Validation Injection

**What:** Add token validation at the start of `handleGateway` and `handleClient` in relay.ts
**When to use:** The only modification needed to apps/relay for RELAY-AUTH-01/02

```typescript
// Source: verified from apps/relay/src/relay.ts existing patterns
// relay.ts — inside handleGateway, replace secret check:

if (!authenticated) {
  if (parsed.type !== 'gateway.auth') {
    socket.close(POLICY_VIOLATION, 'authentication failed');
    return;
  }
  // Production path: validate JWT gateway token
  if (!options.legacySecretEnabled) {
    const payload = verifyGatewayToken(parsed.token, options.jwtSecret);
    if (!payload) {
      socket.close(POLICY_VIOLATION, 'authentication failed');
      return;
    }
    gatewayId = payload.gatewayId;
    gatewayAccountId = payload.accountId;
    gatewayWorkspaceId = payload.workspaceId;
  } else {
    // Legacy development path
    if (parsed.secret !== options.secret) {
      socket.close(POLICY_VIOLATION, 'authentication failed');
      return;
    }
    gatewayId = parsed.gatewayId;
  }
  // ...
}
```

### Pattern 6: Gateway CLI Login with `readline`

**What:** `tether gateway login` prompts for credentials, calls apps/server, writes auth.json
**When to use:** New CLI subcommand under the existing `gatewayCommand`

```typescript
// apps/cli/src/main.ts — new subcommand
import { createInterface } from 'node:readline';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

gatewayCommand
  .command('login')
  .description('authenticate Gateway with Tether Server')
  .option('--server-url <url>', 'Tether Server URL')
  .action(async (options: { serverUrl?: string }) => {
    const serverUrl = options.serverUrl ?? process.env.TETHER_SERVER_URL;
    if (!serverUrl) {
      console.error('TETHER_SERVER_URL 未配置。使用 --server-url 指定。');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const email = await new Promise<string>(resolve => rl.question('邮箱: ', resolve));
    const password = await new Promise<string>(resolve => {
      // suppress echo for password
      process.stderr.write('密码: ');
      process.stdin.once('data', (data) => {
        process.stderr.write('\n');
        resolve(data.toString().trimEnd());
      });
    });
    rl.close();
    const res = await fetch(`${serverUrl}/api/gateway/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, gatewayId: /* read/generate */ '' }),
    });
    if (!res.ok) {
      console.error('登录失败。请检查邮箱和密码。');
      process.exit(1);
    }
    const body = await res.json();
    const authPath = path.join(os.homedir(), '.tether', 'auth.json');
    await mkdir(path.dirname(authPath), { recursive: true });
    await writeFile(authPath, JSON.stringify(body, null, 2), { mode: 0o600 });
    console.log('Gateway 已登录并绑定账号。');
  });
```

### Anti-Patterns to Avoid

- **Issuing tokens outside apps/server:** Relay and Gateway must never sign tokens. Only apps/server signs JWTs with the shared secret. Relay verifies only.
- **Using management tokens for session control:** D-17 is absolute — management token class must be checked and rejected in Gateway auth middleware and Relay client auth.
- **Trusting client-supplied accountId/workspaceId query fields:** Token payload is the only trusted source for scope. Never use `?accountId=` from query string for authorization.
- **Putting the setup token flow in Phase 5:** D-05 explicitly removes `/setup?token=...`. Use `/register` directly.
- **Storing raw passwords or tokens in audit events:** Audit service must strip all token fields and password fields before writing to MySQL.
- **Using `egg` 3.x with `"type": "module"`:** Egg 3.x requires CommonJS (`"type": "commonjs"` in apps/server/package.json). The rest of the monorepo uses ESM, but apps/server must be CJS for Egg compatibility. [VERIFIED: Egg docs]
- **Forgetting Tailwind 4 @tailwindcss/vite plugin:** shadcn 4.x requires Tailwind 4; Tailwind 4 uses a Vite plugin instead of postcss. `vite.config.ts` in apps/web must add `tailwindcss()` as a Vite plugin.
- **Shared-secret relay path as default:** D-21a requires an explicit env var opt-in (`TETHER_RELAY_ALLOW_LEGACY_SECRET=1` or equivalent). Default must reject shared-secret auth.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | bcrypt implementation | `egg-bcrypt` plugin (`ctx.genHash`, `ctx.compare`) | bcrypt has known timing-attack risks if implemented manually; work factor tuning required |
| JWT signing and verification | Custom HMAC token format | `egg-jwt` + `jsonwebtoken` | Handles expiry, jti, standard claims, verification errors correctly |
| Redis connection pooling | Manual ioredis client | `egg-redis` plugin (`ctx.redis`) | egg-redis manages lifecycle and reconnect automatically |
| MySQL connection pooling | Manual mysql2 client | `egg-mysql` plugin (`ctx.mysql`) | egg-mysql manages pool and reconnect; query escaping is built in |
| WebSocket push channel | Custom WS broadcast in Egg | `egg-socket.io` with rooms | socket.io handles reconnect, room-based broadcast, authenticated namespace cleanly |
| CORS headers | Manual `Access-Control-Allow-*` headers | `egg-cors` plugin | CORS edge cases (preflight, credentials, origin allowlist) are well-tested in the plugin |
| Form validation | Custom validation functions | `zod` + `react-hook-form` (shadcn pattern) | Type-safe, reusable schema; error messages are automatic |
| Token revocation state | File-based blocklist | Redis via `egg-redis` | Redis TTL-based expiry aligns with token lifetime; fast reads on every request |

**Key insight:** In the Egg plugin ecosystem, each plugin owns its lifecycle (startup health check, graceful shutdown, pool management). Hand-rolling any of these loses those guarantees silently.

---

## Common Pitfalls

### Pitfall 1: Egg 3.x CJS vs Monorepo ESM conflict

**What goes wrong:** `apps/server/package.json` inherits `"type": "module"` convention from the rest of the monorepo; Egg 3.x fails to load because it uses `require()` internally.

**Why it happens:** Every other app and package in this monorepo declares `"type": "module"`. Egg 3.x predates full ESM support and relies on CJS loader conventions.

**How to avoid:** `apps/server/package.json` must declare `"type": "commonjs"` explicitly. TypeScript target should be `ES2020`, not `ESNext`. Module resolution in tsconfig must be `node16` or `commonjs`, not `NodeNext`.

**Warning signs:** `Error [ERR_REQUIRE_ESM]: require() of ES Module` on Egg startup.

### Pitfall 2: shadcn Tailwind 4 requires Vite plugin, not postcss config

**What goes wrong:** Developer follows Tailwind 3 docs and adds `tailwind.config.js` + postcss; shadcn 4.x components don't render styles.

**Why it happens:** shadcn 4.x uses Tailwind CSS 4, which ships as a Vite plugin (`@tailwindcss/vite`) instead of a postcss plugin. The `tailwind.config.js` file is not used in Tailwind 4.

**How to avoid:** `apps/web/vite.config.ts` must import and use `tailwindcss()` from `@tailwindcss/vite`. No `tailwind.config.js` or `postcss.config.js` is needed. Run `npx shadcn@latest init -t vite` from inside `apps/web/`.

**Warning signs:** All shadcn components render without any styling; Tailwind classes produce no output.

### Pitfall 3: Relay auth upgrade breaks development workflow silently

**What goes wrong:** After removing the shared-secret path as default, existing dev setups that relied on shared-secret (Gateway + Relay in dev) stop connecting without an obvious error.

**Why it happens:** The Relay auth frame change is a protocol-level breaking change for existing `relay-client.ts` in Gateway. The old `gateway.auth` frame sends `{ type: 'gateway.auth', gatewayId, secret }`. The new frame sends `{ type: 'gateway.auth', token }`. If only one side is updated, connection always fails.

**How to avoid:** Update `packages/protocol` `RelayGatewayToServerFrame` to include both `secret?` and `token?` fields simultaneously. Update `relay.ts` to prefer `token` and fall back to `secret` only when the legacy flag is set. Update `relay-client.ts` to read from `~/.tether/auth.json` and send `token`. Update tests to cover both paths.

**Warning signs:** Relay logs show `authentication failed`; Gateway logs show `disconnected` on every reconnect attempt.

### Pitfall 4: JWT secret empty string passes `app.jwt.verify` in test environments

**What goes wrong:** `process.env.TETHER_SERVER_JWT_SECRET` is not set in test; config falls back to `''`; `jsonwebtoken` accepts `''` as a valid secret and signs tokens that are accepted by all tests, giving false green.

**Why it happens:** `jsonwebtoken.sign(payload, '')` does not throw; it produces a valid HS256 token. Tests pass. Production rejects because a real secret is set and the empty-signed tokens don't verify.

**How to avoid:** In `config/config.default.ts`, throw an error if `TETHER_SERVER_JWT_SECRET` is empty in non-test environments. Tests must set a deterministic test secret.

**Warning signs:** Integration tests pass with no env vars set; all tokens have empty-string signature.

### Pitfall 5: `~/.tether/auth.json` race between Gateway token refresh and relay-client reconnect

**What goes wrong:** Gateway reconnects to Relay while a token refresh is in progress, sends the old token, gets rejected, enters `auth_failed` state, and stops reconnecting.

**Why it happens:** The existing relay-client.ts enters `auth_failed` state on `gateway.auth.failed` and stops scheduling reconnects. If the refresh completed after the failed auth attempt, the state machine is stuck.

**How to avoid:** Token refresh must complete before relay-client initiates the connection attempt. After a successful refresh, write `auth.json` first, then trigger `connect()`. On `auth_failed`, check if a newer token is available before giving up — only give up if the token is still the one that was rejected.

**Warning signs:** After `tether gateway login`, Gateway connects to Relay once, then the first token refresh causes permanent disconnection.

### Pitfall 6: Notification WebSocket not scoped per accountId

**What goes wrong:** When a user in account A triggers a session event, the notification pushes to all connected sockets including account B devices.

**Why it happens:** `egg-socket.io` rooms must be joined per-user/per-account after authentication. If room join is skipped or uses a global room, all authenticated users receive all events.

**How to avoid:** On notification WS connect, verify the token, then `socket.join(accountId)`. All pushes must target `io.to(accountId).emit(...)`, never `io.emit(...)` (broadcast to all).

**Warning signs:** Account B's Web client shows session events from account A's sessions.

---

## Code Examples

### MySQL Schema Pattern (apps/server/sql/001_init.sql)

```sql
-- Source: [ASSUMED] derived from Phase 4 token class definitions
CREATE TABLE IF NOT EXISTS accounts (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  account_id  VARCHAR(36)  NOT NULL,
  name        VARCHAR(255) NOT NULL DEFAULT 'default',
  is_default  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  BIGINT       NOT NULL,
  INDEX idx_workspace_account (account_id)
);

CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  account_id  VARCHAR(36)  NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  email       VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status      ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL,
  UNIQUE KEY uk_user_email (email),
  INDEX idx_user_account (account_id)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  account_id  VARCHAR(36)  NOT NULL,
  email       VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role        ENUM('super_admin','admin') NOT NULL DEFAULT 'admin',
  status      ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL,
  UNIQUE KEY uk_admin_email (email)
);

CREATE TABLE IF NOT EXISTS devices (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  account_id  VARCHAR(36)  NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  user_id     VARCHAR(36)  NOT NULL,
  status      ENUM('active','revoked') NOT NULL DEFAULT 'active',
  user_agent  VARCHAR(512),
  last_seen_at BIGINT,
  created_at  BIGINT       NOT NULL,
  INDEX idx_device_user (user_id)
);

CREATE TABLE IF NOT EXISTS gateways (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  account_id  VARCHAR(36)  NOT NULL,
  workspace_id VARCHAR(36) NOT NULL,
  status      ENUM('active','unlinked') NOT NULL DEFAULT 'active',
  last_seen_at BIGINT,
  created_at  BIGINT       NOT NULL,
  INDEX idx_gateway_account (account_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti         VARCHAR(36)  NOT NULL PRIMARY KEY,
  token_class VARCHAR(64)  NOT NULL,
  account_id  VARCHAR(36)  NOT NULL,
  user_id     VARCHAR(36),
  admin_user_id VARCHAR(36),
  device_id   VARCHAR(36),
  gateway_id  VARCHAR(36),
  expires_at  BIGINT       NOT NULL,
  revoked     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  BIGINT       NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type   VARCHAR(128) NOT NULL,
  account_id   VARCHAR(36),
  workspace_id VARCHAR(36),
  user_id      VARCHAR(36),
  admin_user_id VARCHAR(36),
  device_id    VARCHAR(36),
  gateway_id   VARCHAR(36),
  session_id   VARCHAR(128),
  ip           VARCHAR(64),
  user_agent   VARCHAR(512),
  failure_reason VARCHAR(255),
  ts           BIGINT       NOT NULL,
  INDEX idx_audit_account (account_id, ts),
  INDEX idx_audit_user (user_id, ts)
);
```

### Egg Plugin Configuration Pattern

```typescript
// Source: https://github.com/eggjs/egg/blob/next/site/docs/tutorials/mysql.md
// apps/server/config/plugin.ts
import { EggPlugin } from 'egg';

const plugin: EggPlugin = {
  cors: { enable: true, package: 'egg-cors' },
  jwt: { enable: true, package: 'egg-jwt' },
  redis: { enable: true, package: 'egg-redis' },
  mysql: { enable: true, package: 'egg-mysql' },
  bcrypt: { enable: true, package: 'egg-bcrypt' },
  io: { enable: true, package: 'egg-socket.io' },
  console: { enable: true, package: 'egg-console' },
  apidoc: { enable: false, package: 'egg-apidoc2' },
  oss: { enable: false, package: 'egg-oss' },
};

export default plugin;
```

### Token Payload Structure (shared type in packages/core or packages/protocol)

```typescript
// Source: [VERIFIED: Phase 4 ACCOUNT-AUTH-SPEC.md token table]
// packages/core/src/auth.ts (new file)
export type NormalClientAccessPayload = {
  tokenClass: 'normal_client_access';
  accountId: string;
  workspaceId: string;
  userId: string;
  deviceId: string;
  jti: string;
  expiresAt: number;
};

export type GatewayTokenPayload = {
  tokenClass: 'gateway_token';
  accountId: string;
  workspaceId: string;
  gatewayId: string;
  jti: string;
  expiresAt: number;
};

export type ManagementAccessPayload = {
  tokenClass: 'management_access';
  accountId: string;
  workspaceId: string;
  adminUserId: string;
  deviceId: string;
  jti: string;
  expiresAt: number;
};

export type WsTicketPayload = {
  tokenClass: 'ws_ticket';
  accountId: string;
  workspaceId: string;
  userId: string;
  deviceId: string;
  gatewayId: string;
  sessionId: string;
  mode: 'control' | 'observe';
  jti: string;
  expiresAt: number;
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Relay shared-secret auth for all clients | JWT token auth, shared-secret as legacy opt-in | Phase 5 | Relay now validates token class and account/workspace scope |
| Gateway publishes sessions without identity | Gateway binds to account via `tether gateway login`, sends gatewayToken | Phase 5 | Sessions are scoped to accountId/workspaceId |
| HTTP write endpoints unauthenticated (LAN-only) | All write endpoints require valid normal_client_access token | Phase 5 | Fixes CRITICAL security gap in CONCERNS.md |
| WS ticket is single-use UUID with no scope | WS ticket is JWT carrying full account/workspace/Gateway/session/mode scope | Phase 5 | Prevents cross-session or cross-account ticket reuse |
| Browser has no auth state | Browser reads/writes localStorage; Authorization header on all calls | Phase 5 | v0.3 pragmatic; later hardens to httpOnly cookies |

**Deprecated/outdated:**
- `/setup?token=...` route: explicitly removed per D-05. Use `/register` directly for first user creation.
- `apps/relay` shared-secret auth as default: becomes legacy-only after Phase 5. Opt-in via `TETHER_RELAY_ALLOW_LEGACY_SECRET=1`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Egg 3.x requires `"type": "commonjs"` and will fail with `"type": "module"` | Standard Stack, Anti-Patterns | apps/server scaffold will fail to boot; hours of debugging |
| A2 | `egg-jwt` 3.1.7 is compatible with `egg` 3.34.0 | Standard Stack | Plugin load error at startup |
| A3 | `TETHER_SERVER_JWT_SECRET` should be the env var name for the JWT signing key | Standard Stack, Pitfalls | Planner picks wrong variable names; deployer confusion |
| A4 | shadcn 4.x uses `@tailwindcss/vite` plugin (not postcss), compatible with Vite 7 | Standard Stack, Pitfalls | shadcn init may fail or produce unstyled components |
| A5 | `egg-bcrypt` API is `ctx.genHash(plaintext)` / `ctx.compare(plaintext, hash)` | Code Examples | Service code calls wrong API and crashes |
| A6 | `egg-socket.io` 4.x supports authenticated namespace via middleware with `app.io.of('/').use(...)` pattern | Architecture Patterns | Notification WebSocket auth may need different wiring |
| A7 | MySQL and Redis are assumed to be available in the deployment environment (not installed on dev machine) | Environment Availability | Phase 5 cannot be run locally without external MySQL and Redis |

---

## Open Questions

1. **JWT validation in Relay: inline vs. server call**
   - What we know: Server signs tokens with a shared secret. Relay can verify by having the same secret (inline), or by calling `POST /api/token/validate` (remote call on every WS auth).
   - What's unclear: The user has not specified. Inline validation is faster and simpler; remote validation enables instant revoke propagation.
   - Recommendation: Use inline JWT verification (Relay has the same `TETHER_SERVER_JWT_SECRET`). For revocation, Relay calls Server only when it receives a frame from an already-authenticated connection and needs to check if the token was revoked since connection opened (or skip per-frame checks and rely on connection lifetime). The planner should pick one and document it.

2. **apps/server port and Vite proxy configuration**
   - What we know: Gateway runs on 4789; Relay on 4889; Web dev server on 4790.
   - What's unclear: What port does apps/server use? How does apps/web in dev proxy `/api` to Server (not Gateway)?
   - Recommendation: Use 4800 for apps/server. Update `apps/web/vite.config.ts` to proxy `/api/auth/*`, `/api/admin/*`, `/api/gateway/*`, `/api/token/*`, `/api/audit/*` to `http://127.0.0.1:4800`, and keep `/api/*` (fallback) to `http://127.0.0.1:4789` for Gateway.

3. **Where to add `tether gateway login` — does it replace `tether gateway config` relay config?**
   - What we know: Existing `tether gateway config` writes relay URL/secret to `~/.tether/config.json`. Phase 5 adds `tether gateway login` which writes `~/.tether/auth.json`.
   - What's unclear: After Phase 5, should `tether gateway config --relay-url` still work, or is relay config subsumed by Server registration?
   - Recommendation: Keep `tether gateway config --relay-url` for specifying which Relay to connect to. `tether gateway login` binds to Server and obtains the Gateway token. These are separate concerns. `relay-client.ts` reads from both: Relay URL from config, Gateway token from auth.json.

4. **How apps/web handles the case where apps/server is not configured (solo dev)**
   - What we know: Current Web just talks to Gateway directly. Phase 5 adds Server-dependent flows.
   - What's unclear: If `TETHER_SERVER_URL` is not set, does the Web app show auth pages or skip to terminal?
   - Recommendation: Planner should decide: either Web always shows auth (requiring Server), or Web shows a warning and falls back to local-only mode for development. The second approach is safer for dev experience.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | apps/server | Yes | v22.22.2 | — |
| pnpm | monorepo | Yes | 10.33.0 | — |
| MySQL | apps/server data layer | No (CLI not on PATH) | — | Developer must install locally or use Docker; no in-process alternative |
| Redis | apps/server token revocation, egg-redis | No (not running) | — | egg-redis without Redis is a startup error; developer must run Redis locally or via Docker |
| mysql CLI (for running SQL files) | apps/server/sql/001_init.sql | No | — | Use any MySQL client (TablePlus, DBeaver, etc.) to run schema files |

**Missing dependencies with no fallback:**
- MySQL: apps/server cannot start without a reachable MySQL instance. Phase 5 plans must include a note that deployers/developers must provision MySQL before running `apps/server`.
- Redis: `egg-redis` will fail to connect on startup if Redis is not available. Plans must include a note that Redis is required for token revocation.

**Missing dependencies with fallback:**
- None identified; MySQL and Redis are hard requirements.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node --test` via `tsx --test`) |
| Config file | None — inline `tsx --test src/*.test.ts` per package |
| Quick run command | `pnpm --filter @tether/server test` (once server package exists) |
| Full suite command | `pnpm test` (runs all workspace packages) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SERVER-01 / SERVER-02 | apps/server starts, responds to /healthz | smoke | `curl http://127.0.0.1:4800/healthz` | No — Wave 0 |
| AUTH-01 | POST /api/auth/register creates user and returns tokens | integration | `pnpm --filter @tether/server test` | No — Wave 0 |
| AUTH-01 | POST /api/auth/login returns tokens with correct tokenClass | integration | `pnpm --filter @tether/server test` | No — Wave 0 |
| AUTH-01 | POST /api/admin/auth/register creates super_admin | integration | `pnpm --filter @tether/server test` | No — Wave 0 |
| AUTH-02 | tether gateway login writes auth.json with mode 0600 | integration | `pnpm --filter @tether/cli test` | No — Wave 0 |
| AUTH-03 | Gateway /api/ws-ticket rejects missing/invalid token | integration | `pnpm --filter @tether/gateway test` | No — Wave 0 |
| AUTH-03 | Gateway /api/sessions/:id/stop rejects non-owner token | integration | `pnpm --filter @tether/gateway test` | No — Wave 0 |
| AUTH-04 | WS ticket scoped to sessionId cannot be used for different sessionId | unit | `pnpm --filter @tether/gateway test` | No — Wave 0 |
| AUTH-05 | Revoked token rejected by /api/ws-ticket | integration | `pnpm --filter @tether/server test` + `pnpm --filter @tether/gateway test` | No — Wave 0 |
| AUTH-07 | Notification WS pushes session.started event to correct accountId room only | integration | `pnpm --filter @tether/server test` | No — Wave 0 |
| RELAY-AUTH-01 | Relay /gateway rejects missing/invalid token | integration | `pnpm --filter @tether/relay test` | No — Wave 0 |
| RELAY-AUTH-01 | Relay /client rejects missing/invalid token | integration | `pnpm --filter @tether/relay test` | No — Wave 0 |
| RELAY-AUTH-02 | Relay client from account A cannot subscribe to account B session | integration | `pnpm --filter @tether/relay test` | No — Wave 0 |
| AUDIT-01 | auth.login.succeeded and auth.login.failed events written to audit_events | integration | `pnpm --filter @tether/server test` | No — Wave 0 |
| AUDIT-02 | Audit event payload does not contain token fields | unit | `pnpm --filter @tether/server test` | No — Wave 0 |
| WEBUI-01 | /register page renders without errors | smoke | browser manual check | No — manual only |

### Sampling Rate
- **Per task commit:** `pnpm typecheck` (all workspace packages)
- **Per wave merge:** `pnpm test` (full test suite) + `pnpm typecheck`
- **Phase gate:** All tests green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `apps/server/src/test/auth.test.ts` — covers AUTH-01, AUDIT-01, AUDIT-02
- [ ] `apps/server/src/test/relay_token.test.ts` — covers token validation utility used by Relay
- [ ] `apps/relay/src/relay.test.ts` — extend existing test file to cover RELAY-AUTH-01, RELAY-AUTH-02
- [ ] `apps/gateway/src/daemon.test.ts` — extend existing to cover AUTH-03, AUTH-04, AUTH-05
- [ ] `packages/core/src/auth.ts` — new token payload type definitions (no test file needed, types only)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | email/password + bcrypt via egg-bcrypt; no default credentials |
| V3 Session Management | Yes | JWT with 30-day expiry; jti-based revocation in Redis; single-use WS tickets |
| V4 Access Control | Yes | Token class guard middleware; ownership check (userId == session owner); Relay account scope check |
| V5 Input Validation | Yes | zod on Web forms; Egg body parsing with manual type checks in controllers |
| V6 Cryptography | Yes | JWT HS256 via egg-jwt + jsonwebtoken; bcrypt for passwords via egg-bcrypt |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Management token used for session control | Elevation of Privilege | Token class check in Gateway auth middleware: reject `tokenClass !== 'normal_client_access'` |
| Cross-account Relay frame access | Tampering / Information Disclosure | Relay stores `accountId` on each connected socket; rejects frames targeting other accountId |
| Raw token logged in audit events | Information Disclosure | Audit service strips all fields matching `token`, `secret`, `password`, `hash` before MySQL insert |
| Empty JWT secret in dev/test | Spoofing | Config startup check: throw if `TETHER_SERVER_JWT_SECRET` is empty outside test mode |
| auth.json world-readable | Information Disclosure | `writeFile(path, content, { mode: 0o600 })` per D-25 |
| CORS allowing all origins on apps/server | Tampering | `egg-cors` configured with explicit origin allowlist (apps/web origin only) |
| Notification WS leaking events across accounts | Information Disclosure | `socket.join(accountId)` on connect; push only via `io.to(accountId).emit(...)` |
| Shared-secret relay auth used in production | Bypass | `TETHER_RELAY_ALLOW_LEGACY_SECRET` env var required; Relay logs a loud warning when legacy mode is active |

---

## Sources

### Primary (HIGH confidence)
- `apps/relay/src/relay.ts` — verified existing auth frame structure and injection points [VERIFIED: codebase]
- `apps/gateway/src/relay-client.ts` — verified existing Gateway↔Relay auth frame (`gateway.auth` with secret) [VERIFIED: codebase]
- `apps/gateway/src/daemon.ts` — verified existing WS ticket pattern and write endpoints [VERIFIED: codebase]
- `packages/protocol/src/index.ts` — verified existing RelayGatewayToServerFrame union [VERIFIED: codebase]
- `.planning/phases/04-account-auth-contract/04-ACCOUNT-AUTH-SPEC.md` — Phase 4 contract, all token class fields [VERIFIED: codebase]
- `apps/web/package.json` — confirmed no Tailwind, no shadcn today [VERIFIED: codebase]
- Context7 `/eggjs/egg` — Egg TypeScript controller, service, plugin configuration patterns [CITED: https://github.com/eggjs/egg/blob/next/site/docs/tutorials/typescript.md]
- Context7 `/shadcn-ui/ui` — shadcn Vite init command (`npx shadcn@latest init -t vite --monorepo`), form patterns [CITED: https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/installation/vite.mdx]

### Secondary (MEDIUM confidence)
- npm registry version verification for egg (3.34.0), egg-jwt (3.1.7), egg-mysql (5.0.0), egg-redis (2.6.1), egg-bcrypt (1.1.0), egg-socket.io (4.1.6), egg-cors (3.0.1), egg-console (2.0.1) [VERIFIED: npm view]
- npm registry version for shadcn CLI (4.6.0), tailwindcss (4.2.4) [VERIFIED: npm view]

### Tertiary (LOW confidence / ASSUMED)
- Egg 3.x `"type": "commonjs"` requirement — [ASSUMED] based on Egg architecture; not verified against a live Egg 3.x + Node.js 22 boot test in this session
- `egg-bcrypt` API surface (`ctx.genHash`, `ctx.compare`) — [ASSUMED] based on plugin README pattern; not verified via ctx7 in this session
- `egg-socket.io` 4.x authenticated namespace pattern — [ASSUMED] based on general socket.io room pattern; specific Egg integration not verified via ctx7 in this session

---

## Metadata

**Confidence breakdown:**
- Standard stack (apps/server Egg plugins): MEDIUM — versions verified via npm; Egg TypeScript patterns verified via Context7; CJS requirement is ASSUMED
- Architecture (Relay injection, Gateway token check, CLI login): HIGH — verified against actual source files
- shadcn setup for Vite: HIGH — verified via Context7
- MySQL schema: MEDIUM — derived from Phase 4 spec; actual column names are discretionary
- Pitfalls: HIGH for CJS/ESM and Relay auth upgrade; MEDIUM for others

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (Egg and shadcn are stable; token/auth design is locked by Phase 4 spec)
