---
phase: 06-account-management-console
reviewed: 2026-05-03T00:00:00Z
depth: standard
files_reviewed: 42
files_reviewed_list:
  - apps/admin-web/src/components/layout/AdminLayout.tsx
  - apps/admin-web/src/components/ui/badge.tsx
  - apps/admin-web/src/components/ui/button.tsx
  - apps/admin-web/src/components/ui/card.tsx
  - apps/admin-web/src/components/ui/dialog.tsx
  - apps/admin-web/src/components/ui/form.tsx
  - apps/admin-web/src/components/ui/input.tsx
  - apps/admin-web/src/components/ui/label.tsx
  - apps/admin-web/src/components/ui/pagination.tsx
  - apps/admin-web/src/components/ui/select.tsx
  - apps/admin-web/src/components/ui/skeleton.tsx
  - apps/admin-web/src/components/ui/table.tsx
  - apps/admin-web/src/contexts/admin-auth-context.tsx
  - apps/admin-web/src/hooks/use-admin-auth.ts
  - apps/admin-web/src/lib/admin-api.ts
  - apps/admin-web/src/lib/utils.ts
  - apps/admin-web/src/main.tsx
  - apps/admin-web/src/pages/AdminLoginPage.tsx
  - apps/admin-web/src/pages/AdminRegisterPage.tsx
  - apps/admin-web/src/pages/AuditPage.tsx
  - apps/admin-web/src/pages/DashboardPage.tsx
  - apps/admin-web/src/pages/DevicesPage.tsx
  - apps/admin-web/src/pages/GatewaysPage.tsx
  - apps/admin-web/src/pages/UsersPage.tsx
  - apps/admin-web/vite.config.ts
  - apps/server/app/controller/admin/admins.ts
  - apps/server/app/controller/admin/audit.ts
  - apps/server/app/controller/admin/devices.ts
  - apps/server/app/controller/admin/gateways.ts
  - apps/server/app/controller/admin/users.ts
  - apps/server/app/middleware/admin-auth.ts
  - apps/server/app/router.ts
  - apps/server/app/router/admin.ts
  - apps/server/app/service/admin/admins.ts
  - apps/server/app/service/admin/audit.ts
  - apps/server/app/service/admin/devices.ts
  - apps/server/app/service/admin/gateways.ts
  - apps/server/app/service/admin/users.ts
  - apps/server/app/service/storage.ts
findings:
  critical: 6
  warning: 8
  info: 2
  total: 16
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-05-03T00:00:00Z
**Depth:** standard
**Files Reviewed:** 42
**Status:** issues_found

## Summary

This phase implements the admin management console: a React SPA with auth, routing, and five data pages (dashboard, users, devices, gateways, audit), backed by a new `/admin/api/*` route namespace on the Egg.js server. The overall shape of the code is sound—management token auth is applied to every admin endpoint, the device-revocation flow correctly revokes both the device record and its refresh tokens, and the React routing loop for the login page is handled correctly.

Five blockers and six warnings were found in the original 38-file review. A subsequent gap-closure pass (plans 06-06) added `AdminRegisterPage.tsx`, `createAdmin` in `admin-api.ts`, the `/admin/register` route in `main.tsx`, and JWT payload decoding in `admin-auth-context.tsx`. That pass adds one new blocker and two new warnings, bringing cumulative totals to 6 critical, 8 warnings, 2 info (16 total).

The most serious issues from the original pass remain open: (1) `multipleStatements: true` on the MySQL pool; (2) `revokeRefreshTokensByDeviceId` ignoring `gateway_refresh_tokens`; (3) `useFormField` null-guard fires after the read it is meant to protect; (4) admin self-deletion not blocked; (5) stale token in localStorage is never evicted on startup. The new gap-closure blocker is: `atob` decodes bytes as Latin-1, not UTF-8 — JWT payloads with multi-byte characters silently corrupt `identity` parsing, which can leave `managementAuth.identity` undefined after login even when the token is valid.

---

## Critical Issues

### CR-01: `multipleStatements: true` enables second-order SQL injection

**File:** `apps/server/app/service/storage.ts:114`
**Issue:** The MySQL pool is created with `multipleStatements: true`. The `ensureSchema()` helper calls `mysqlPool().query(sql)` with a raw file that intentionally contains multiple statements — this is the only place it is needed. However, `multipleStatements: true` applies pool-wide. Any future call to `pool.execute()` or `pool.query()` where user-supplied data is embedded unsafely will now be able to smuggle additional statements. The project uses parameterised `execute()` everywhere today, but the pool option permanently widens the attack surface. Additionally, if the schema file (`001_init.sql`) were ever replaced or injected, the multi-statement mode would allow full DDL/DML execution.

**Fix:** Remove `multipleStatements: true` from the pool configuration and instead execute the schema file in a dedicated single-use connection, or split it into individual statements and run each through `execute()`:

```typescript
// Remove from pool options:
// multipleStatements: true   <-- DELETE THIS LINE

// In ensureSchema, replace pool.query(sql) with:
const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
const conn = await mysqlPool().getConnection();
try {
  for (const stmt of statements) {
    await conn.execute(stmt);
  }
} finally {
  conn.release();
}
```

---

### CR-02: `revokeRefreshTokensByDeviceId` only revokes `refresh_tokens`, not `gateway_refresh_tokens`

**File:** `apps/server/app/service/storage.ts:756-763`
**Issue:** When a device is admin-revoked, `revokeAdminDevice()` calls `revokeRefreshTokensByDeviceId(deviceId)`. That function issues an `UPDATE` against `refresh_tokens` only:

```sql
UPDATE refresh_tokens SET revoked_at = NOW() WHERE device_id = ? AND revoked_at IS NULL
```

The `gateway_refresh_tokens` table also has a `device_id` column and a `revoked_at` column (confirmed by `saveRefreshToken()` at line 449 and `loadRefreshTokenByJti()` at line 506). A device that was registered as a gateway's device will have live rows in `gateway_refresh_tokens` with its `device_id`. Those rows are not touched by this function, so the gateway can continue to refresh tokens after the associated device has been admin-revoked.

**Fix:**

```typescript
export async function revokeRefreshTokensByDeviceId(deviceId: string): Promise<void> {
  await execute(
    'UPDATE refresh_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
    [deviceId]
  );
  await execute(
    'UPDATE gateway_refresh_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
    [deviceId]
  );
}
```

---

### CR-03: Access token expiry never checked on the frontend; 401 does not trigger logout

**File:** `apps/admin-web/src/contexts/admin-auth-context.tsx:51-55`, `apps/admin-web/src/lib/admin-api.ts:56-64`
**Issue:** `loginManagement` stores `accessToken` and `refreshToken` but never populates `identity` (the `identity` field is always absent from the stored record — compare lines 73-77 with the `ManagementIdentity` type which has `expiresAt`). On startup, `readStorage()` reads the raw record from `localStorage`; there is no check of `expiresAt`. A token that expired days ago will be read back as valid `managementAuth`, the layout will render, and all API calls will receive 401 until the user manually discovers the session is stale.

Furthermore `requestJson()` throws an `Error` on 401 (line 60-63) but callers only catch it to set a local error state — they never call `logoutManagement()` or redirect to `/admin/login`. An expired session silently shows "数据加载失败" for every panel with no recovery path other than manual navigation.

**Fix — two parts:**

1. Populate `identity` on login by decoding the JWT payload (no library needed, just base64):

```typescript
function decodeJwtPayload(token: string): ManagementIdentity | undefined {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return undefined;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return undefined; }
}

// in loginManagement, after building the record:
const record: AuthStorageRecord<ManagementIdentity> = {
  accessToken: body.accessToken,
  refreshToken: body.refreshToken,
  identity: decodeJwtPayload(body.accessToken)
};
```

2. In `readStorage`, reject records whose token is already expired:

```typescript
const parsed = JSON.parse(raw) as AuthStorageRecord<ManagementIdentity>;
if (parsed.identity?.expiresAt && parsed.identity.expiresAt <= Date.now()) {
  window.localStorage.removeItem(key);
  return null;
}
```

3. In `requestJson`, propagate 401 as a distinct error class so callers (or a central interceptor) can call `logoutManagement()`.

---

### CR-04: `useFormField` null-guard fires after the guarded value is already read

**File:** `apps/admin-web/src/components/ui/form.tsx:38-58`
**Issue:** `useFormField()` calls `useContext(FormFieldContext)` then immediately calls `getFieldState(fieldContext.name, formState)` on line 43 — which will throw if `fieldContext` is the empty default `{}` (i.e. `fieldContext.name` is `undefined`). The null-guard `if (!fieldContext)` is on line 45, after the crash-inducing read. This is a logic error: `fieldContext` is initialised as `{} as FormFieldContextValue`, which is always truthy, so the guard never fires anyway even in its wrong position.

```typescript
// Current (broken order):
const fieldContext = React.useContext(FormFieldContext);   // line 39 — always truthy ({})
const itemContext  = React.useContext(FormItemContext);
const { getFieldState, formState } = useFormContext();
const fieldState = getFieldState(fieldContext.name, formState); // line 43 — crashes when name===undefined
if (!fieldContext) { throw ... }                               // line 45 — never reached

// Fix: guard on name presence, before the read:
if (!fieldContext.name) {
  throw new Error('useFormField should be used within <FormField>');
}
const fieldState = getFieldState(fieldContext.name, formState);
```

---

### CR-05: Admin self-deletion is not blocked

**File:** `apps/server/app/service/admin/admins.ts:23-44`, `apps/server/app/controller/admin/admins.ts:40-51`
**Issue:** `deleteAdminManager(id, adminUserId, ...)` receives the caller's own `adminUserId` but never checks `id !== adminUserId`. An authenticated admin can call `DELETE /admin/api/admins/:id` with their own `id` and successfully delete their own account. In the MySQL path the account is deleted and the audit record writes `adminUserId` of the now-deleted user, leaving a dangling reference. More critically, if the only admin account deletes itself, the console becomes inaccessible and there is no recovery path (the registration endpoint requires an existing management token).

**Fix:**

```typescript
export async function deleteAdminManager(
  id: string,
  adminUserId: string,
  accountId: string,
  workspaceId: string
) {
  if (id === adminUserId) throw new Error('cannot_delete_self');
  // ... rest of function
}
```

Return 403 from the controller for this error code.

---

### CR-06: `atob` decodes Latin-1, not UTF-8 — JWT payloads with multi-byte characters silently corrupt identity parsing

**File:** `apps/admin-web/src/contexts/admin-auth-context.tsx:9-11`
**Issue:** `decodeJwtPayload` uses `atob(base64)` to decode the JWT payload. `atob` produces a Latin-1 byte string, not a UTF-8 decoded string. JWT payloads are always UTF-8 encoded. If any string claim in the token — for example, an admin account name or a `displayName` stored in the payload — contains a non-ASCII character (e.g., CJK characters, accented Latin, or emoji), `atob` will produce a corrupt byte sequence. `JSON.parse` will then either throw (caught, returning `null`) or parse successfully but with garbled string values.

The consequence: after a successful login, `identity` is set to `undefined`, `managementAuth.identity` is `undefined`, and the header's email display falls back to the empty string (line 23 of `AdminLayout.tsx`: `managementAuth.identity?.adminUserId ?? ''`). More importantly the `expiresAt` expiry guard (when added per CR-03) will be unable to read the expiry, so expired tokens will never be evicted.

This is a latent defect that does not affect the initial deployment (where admin emails are plain ASCII), but will manifest the moment any non-ASCII string appears in a JWT claim.

**Fix:** Decode the raw bytes through `TextDecoder` before parsing:

```typescript
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // atob gives Latin-1 bytes; re-encode as Uint8Array then UTF-8 decode
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

---

## Warnings

### WR-01: `countDevices()` counts revoked devices, making pagination totals wrong

**File:** `apps/server/app/service/storage.ts:741-747`
**Issue:** `countDevices()` counts all rows with `token_class = 'normal_client_access'`, including those with `revoked_at IS NOT NULL`. `loadAllDevices()` also returns all such rows (both active and revoked). The page count shown in `DevicesPage` is therefore consistent with itself, but it counts revoked devices, while `countActiveDevices()` (used in the dashboard) applies `AND revoked_at IS NULL`. The dashboard "活跃设备" stat and the devices-page total are semantically different, which will confuse operators. If the intent is to show all devices (active + revoked) in the admin table, `countDevices` is correct but the dashboard stat is misleadingly named/implemented.

**Fix:** Decide on intent. If the devices page is meant to show all devices, document this explicitly. If it should show only active devices, add `AND revoked_at IS NULL` to `countDevices()` and the `loadAllDevices()` WHERE clause.

---

### WR-02: `missing_admin_user_id` guard is asymmetric: present in `revoke`/`unlink` but absent in `admins.destroy`

**File:** `apps/server/app/controller/admin/devices.ts:22`, `apps/server/app/controller/admin/gateways.ts:22`, `apps/server/app/controller/admin/admins.ts:42-44`
**Issue:** `devices.revoke` and `gateways.unlink` both explicitly guard `if (!identity.adminUserId) throw new Error('missing_admin_user_id')`. `admins.destroy` instead uses `identity.adminUserId ?? ''` — passing an empty string as the auditing actor when `adminUserId` is absent. An empty string is stored in the audit log as the deleting actor, producing silent data integrity corruption in the audit trail rather than a clean 401/400 rejection.

**Fix:**

```typescript
// admins.destroy, line 44
const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
if (!identity.adminUserId) throw new Error('missing_admin_user_id');
const { id } = this.ctx.params as Record<string, string>;
await deleteAdminManager(id, identity.adminUserId, identity.accountId, identity.workspaceId);
```

---

### WR-03: In-memory mode device revocation deletes the record instead of marking it revoked

**File:** `apps/server/app/service/admin/devices.ts:57-62`
**Issue:** In the non-MySQL code path, `revokeAdminDevice` calls `store.devices.delete(deviceId)`. Subsequent `GET /admin/api/devices` will no longer show that device at all — the revocation is invisible in the table. The MySQL path correctly sets `revoked_at` and the device remains visible with `status: 'revoked'`. This is a functional divergence between the two modes that will cause test/dev confusion and means audit events for a revoked device become orphaned (the device no longer exists to cross-reference).

**Fix:** Add a `revokedAt` field to `DeviceRecord` in the runtime store (or use a separate Set), and update the listing logic to map it to `status: 'revoked'` instead of deleting.

---

### WR-04: `adminAdmins.index` and `adminAdmins.create` discard the token return value and do not audit

**File:** `apps/server/app/controller/admin/admins.ts:8-9`, `apps/server/app/controller/admin/admins.ts:18-19`
**Issue:** `requireManagementToken(...)` returns the decoded identity, but `index` and `create` both call it as a void statement (discarding the return). For `index` this is harmless (no identity needed). For `create` it means the new admin user is registered without the audit trail knowing *which* operator performed the registration — unlike `destroy` which passes `identity.adminUserId` to `deleteAdminManager`. The `registerManagementUser` call does not accept an `actorAdminUserId` parameter, so the audit event written for the new admin creation will have no actor.

**Fix:** Capture `identity` from `requireManagementToken` in `create`, then thread `actorAdminUserId: identity.adminUserId` through to `registerManagementUser` (requires a matching service change).

---

### WR-05: `AuditPage` filter label "用户邮箱" but sends value as `userId`

**File:** `apps/admin-web/src/pages/AuditPage.tsx:116-121`, `apps/admin-web/src/lib/admin-api.ts:105`
**Issue:** The filter input is labelled "用户邮箱" (user email) and the value typed by the operator is sent as `userId` to the API. The server-side `listAdminAuditEvents` maps `params.userId` directly to `WHERE user_id = ?`. User IDs are opaque UUIDs; operators typing an email address will always get zero results. The link from `UsersPage` correctly passes `user.id` (line 125 in UsersPage.tsx), but the freeform filter input clearly expects email.

**Fix:** Either rename the placeholder to "用户 ID" to match what the field actually accepts, or add server-side lookup by email before filtering by `user_id`.

---

### WR-06: Stale token in `localStorage` is never cleared on 401 — session becomes permanently broken

**File:** `apps/admin-web/src/pages/DashboardPage.tsx:22-24`, `apps/admin-web/src/pages/DevicesPage.tsx:63-68`, `apps/admin-web/src/pages/UsersPage.tsx:37-44`, `apps/admin-web/src/pages/GatewaysPage.tsx:63-68`, `apps/admin-web/src/pages/AuditPage.tsx:71-74`
**Issue:** All five data pages catch fetch errors and call `setError(...)`. None of them check whether the error is `request_failed_401` and call `logoutManagement()`. When an access token expires mid-session, every request will silently fail with an error toast; the admin will need to manually navigate to `/admin/login` and re-authenticate. The `refreshToken` stored alongside the access token is never used anywhere in the frontend (no refresh flow is implemented).

**Fix:** In `requestJson`, detect HTTP 401 and throw a distinct error type (e.g. `class AuthError extends Error`). In the pages (or in a shared hook), catch `AuthError` and call `logoutManagement()` which will trigger the `AdminLayout` auth guard to redirect to `/admin/login`.

---

### WR-07: `AdminRegisterPage` renders the form to unauthenticated users — no early redirect

**File:** `apps/admin-web/src/pages/AdminRegisterPage.tsx:34-39`, `apps/admin-web/src/main.tsx:23`
**Issue:** `/admin/register` is correctly placed outside `AdminLayout` (so no auth guard applies), but the page does not redirect unauthenticated visitors away from the form. When `managementAuth` is `null`, the page renders the complete registration form. Only when the form is submitted does it show the error "请先登录后再创建管理员账户". A user who lands on `/admin/register` without a session sees a functional-looking registration form, fills it out, and hits an error on submit with no navigational hint about where to go.

Furthermore, since the page is indexed in the catch-all redirect as a known route (it does not match `path="*"`), direct navigation to `/admin/register` by a non-admin is always possible.

The security boundary is correctly enforced server-side (the `POST /admin/api/admins` controller validates the management token), so this is not a security bypass — but it is a UX/workflow defect: unauthenticated visitors should be redirected to `/admin/login` immediately.

**Fix:** Add an early redirect at the top of `AdminRegisterPage`:

```typescript
export function AdminRegisterPage() {
  const navigate = useNavigate();
  const { authReady, managementAuth } = useAdminAuth();

  React.useEffect(() => {
    if (authReady && !managementAuth) {
      navigate('/admin/login', { replace: true });
    }
  }, [authReady, managementAuth, navigate]);

  // ... rest unchanged
}
```

---

### WR-08: `readStorage` expiry check is absent — `expiresAt` now populated but never enforced at boot

**File:** `apps/admin-web/src/contexts/admin-auth-context.tsx:35-45`, `apps/admin-web/src/contexts/admin-auth-context.tsx:65-69`
**Issue:** `decodeJwtPayload` (added in 06-06) correctly extracts `exp` from the JWT and stores it as `expiresAt` in the `identity` field. However, `readStorage` — called on app boot in the `useEffect` at line 66 — reads the stored record and returns it unconditionally without checking whether `identity.expiresAt` is in the past. An admin who closes the browser, waits for the token to expire, and then reopens the console will be shown the layout briefly (because `managementAuth` is initially populated from storage) before the first API call returns 401.

This is distinct from CR-03 (which noted the field was not populated at all). Now that the field is populated, the missing eviction guard is a separate actionable item.

**Fix:**

```typescript
function readStorage<T>(key: string): AuthStorageRecord<T> | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthStorageRecord<T>;
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      // Evict expired tokens immediately at boot
      const identity = parsed.identity as { expiresAt?: number } | undefined;
      if (identity?.expiresAt && identity.expiresAt * 1000 <= Date.now()) {
        window.localStorage.removeItem(key);
        return null;
      }
      return parsed;
    }
  } catch { return null; }
  return null;
}
```

Note: JWT `exp` is in seconds, so multiply by 1000 when comparing to `Date.now()` (milliseconds). The original CR-03 fix suggestion used `expiresAt <= Date.now()` without the `* 1000` conversion, which would also need to be corrected.

---

## Info

### IN-01: Inconsistent `.js` extension on imports across server admin files

**File:** `apps/server/app/controller/admin/admins.ts:2-4`, `apps/server/app/service/admin/admins.ts:1-4`, `apps/server/app/controller/admin/users.ts:2-3`, `apps/server/app/service/admin/users.ts:1-2`
**Issue:** The audit, devices, and gateways controllers use `.js` extensions on relative imports (consistent with ESM). The admins and users controllers and services omit the `.js` extension. This inconsistency could cause resolution failures in strict ESM mode and complicates toolchain configuration.

**Fix:** Add `.js` to all relative imports in the admins and users files to match the pattern used by the other controllers.

---

### IN-02: `DashboardPage` has no loading state

**File:** `apps/admin-web/src/pages/DashboardPage.tsx:13-66`
**Issue:** All other data pages (devices, users, gateways, audit) show `<Skeleton>` rows while loading. `DashboardPage` jumps directly from null stats to rendered values with no intermediate skeleton. The stat cards flash from empty to populated, which is visually inconsistent. This is a quality gap, not a correctness issue.

**Fix:** Add a `loading` state initialised to `true`, set to `false` in `.then()`/`.catch()`, and render `<Skeleton>` placeholders in the card content while `loading` is true.

---

_Reviewed: 2026-05-03T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
