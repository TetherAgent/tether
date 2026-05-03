# Phase 6: Account Management Console - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/admin-web/package.json` | config | — | `apps/web/package.json` | exact |
| `apps/admin-web/vite.config.ts` | config | request-response | `apps/web/vite.config.ts` | exact |
| `apps/admin-web/tsconfig.json` | config | — | `apps/web/tsconfig.json` | exact |
| `apps/admin-web/src/lib/admin-api.ts` | utility | request-response | `apps/web/src/lib/api.ts` | exact |
| `apps/admin-web/src/contexts/admin-auth-context.tsx` | provider | request-response | `apps/web/src/contexts/auth-context.tsx` | exact |
| `apps/admin-web/src/hooks/use-admin-auth.ts` | hook | — | `apps/web/src/hooks/use-auth.ts` | exact |
| `apps/admin-web/src/components/layout/AdminLayout.tsx` | component | request-response | `apps/web/src/main.tsx` (`RequireAdminAuth`) | role-match |
| `apps/admin-web/src/pages/DashboardPage.tsx` | component | request-response | `apps/web/src/pages/admin-login-page.tsx` | role-match |
| `apps/admin-web/src/pages/UsersPage.tsx` | component | CRUD | `apps/web/src/pages/admin-login-page.tsx` | role-match |
| `apps/admin-web/src/pages/DevicesPage.tsx` | component | CRUD | `apps/web/src/pages/admin-login-page.tsx` | role-match |
| `apps/admin-web/src/pages/GatewaysPage.tsx` | component | CRUD | `apps/web/src/pages/admin-login-page.tsx` | role-match |
| `apps/admin-web/src/pages/AuditPage.tsx` | component | CRUD | `apps/web/src/pages/admin-login-page.tsx` | role-match |
| `apps/server/app/controller/admin/users.ts` | controller | CRUD | `apps/server/app/controller/admin-auth.ts` | exact |
| `apps/server/app/controller/admin/devices.ts` | controller | CRUD | `apps/server/app/controller/gateway.ts` | role-match |
| `apps/server/app/controller/admin/gateways.ts` | controller | CRUD | `apps/server/app/controller/gateway.ts` | role-match |
| `apps/server/app/controller/admin/audit.ts` | controller | CRUD | `apps/server/app/controller/audit.ts` | exact |
| `apps/server/app/controller/admin/admins.ts` | controller | CRUD | `apps/server/app/controller/admin-auth.ts` | role-match |
| `apps/server/app/service/admin/users.ts` | service | CRUD | `apps/server/app/service/audit.ts` | role-match |
| `apps/server/app/service/admin/devices.ts` | service | CRUD | `apps/server/app/service/auth.ts` | role-match |
| `apps/server/app/service/admin/gateways.ts` | service | CRUD | `apps/server/app/service/auth.ts` | role-match |
| `apps/server/app/service/admin/audit.ts` | service | CRUD | `apps/server/app/service/audit.ts` | exact |
| `apps/server/app/service/admin/admins.ts` | service | CRUD | `apps/server/app/service/auth.ts` | role-match |
| `apps/server/app/middleware/admin-auth.ts` | middleware | request-response | `apps/server/app/middleware/auth.ts` | exact |
| `apps/server/app/router/admin.ts` | route | request-response | `apps/server/app/router.ts` | exact |

---

## Pattern Assignments

### `apps/admin-web/package.json` (config)

**Analog:** `apps/web/package.json`

**核心 package.json 结构** — 复制以下结构，名称改为 `@tether/admin-web`，scripts 的 port 改为不与 web 冲突的端口（如 `4792`/`4793`）：

```json
{
  "name": "@tether/admin-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 4792",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "preview": "vite preview --host 127.0.0.1 --port 4793"
  },
  "dependencies": {
    "@hookform/resolvers": "...",
    "@radix-ui/react-label": "...",
    "@radix-ui/react-slot": "...",
    "class-variance-authority": "...",
    "clsx": "...",
    "react": "...",
    "react-dom": "...",
    "react-router-dom": "...",
    "tailwind-merge": "...",
    "zod": "...",
    "typescript": "...",
    "vite": "..."
  },
  "devDependencies": {
    "@tailwindcss/vite": "...",
    "@types/react": "...",
    "@types/react-dom": "...",
    "tailwindcss": "..."
  }
}
```

注意：`@xterm/*` 不需要引入，admin-web 不含终端功能。可以视需要引入 `@tether/core` 共享类型。

---

### `apps/admin-web/vite.config.ts` (config)

**Analog:** `apps/web/vite.config.ts`

**完整 Vite 配置模式**（`apps/web/vite.config.ts` 全部内容）：

```typescript
import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api/auth': { target: 'http://127.0.0.1:4800' },
      '/api/admin': { target: 'http://127.0.0.1:4800' },
      '/api': { target: 'http://127.0.0.1:4800' }
    }
  }
});
```

admin-web 所有请求均指向 `apps/server`（端口 4800），proxy 只需保留 `/api/admin` 即可，无需 `/api/gateway` 等路径。

---

### `apps/admin-web/tsconfig.json` (config)

**Analog:** `apps/web/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

与 `apps/web/tsconfig.json` 完全一致，直接复制。

---

### `apps/admin-web/src/lib/admin-api.ts` (utility, request-response)

**Analog:** `apps/web/src/lib/api.ts`

**核心 requestJson 函数**（`apps/web/src/lib/api.ts` 第 66–93 行）：

```typescript
type RequestOptions = RequestInit & {
  token?: string;
};

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type') && options.body) {
    headers.set('content-type', 'application/json');
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(path, { ...options, headers });

  const body = await response.json().catch(() => undefined) as { error?: string } | T | undefined;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `request_failed_${response.status}`;
    throw new Error(message);
  }

  return body as T;
}
```

`admin-api.ts` 复制此 `requestJson` 函数不变，然后在其上导出针对 `/admin/api/*` 的具名函数，例如：

```typescript
export async function listUsers(token: string) {
  return requestJson<{ users: AdminUser[] }>('/admin/api/users', { token });
}

export async function revokeDevice(token: string, deviceId: string) {
  return requestJson<{ ok: true }>(`/admin/api/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST',
    token
  });
}
```

**不要**重复导出 `loginManagement` 等已在 `apps/web/src/lib/api.ts` 中定义的登录函数 — admin-web 的登录页重用 `/api/admin/auth/login` 时可从共享包导入或直接 inline。

---

### `apps/admin-web/src/contexts/admin-auth-context.tsx` (provider, request-response)

**Analog:** `apps/web/src/contexts/auth-context.tsx`

**localStorage 读写模式**（第 35–57 行）：

```typescript
const MANAGEMENT_STORAGE_KEY = 'tether:web:managementAuth';

function readStorage<T>(key: string): AuthStorageRecord<T> | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthStorageRecord<T>;
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function writeStorage<T>(key: string, value: AuthStorageRecord<T> | null) {
  if (!value) { window.localStorage.removeItem(key); return; }
  window.localStorage.setItem(key, JSON.stringify(value));
}
```

**管理 token 验证模式**（第 108–125 行）：

```typescript
const validateManagementSession = React.useCallback(async () => {
  const stored = readStorage<ManagementIdentity>(MANAGEMENT_STORAGE_KEY);
  if (!stored?.accessToken) { logoutManagement(); return false; }
  try {
    const identity = await validateManagement(stored.accessToken);
    if (identity.tokenClass !== 'management_access') throw new Error('wrong_token_class');
    persistManagement({ ...stored, identity });
    return true;
  } catch {
    logoutManagement();
    return false;
  }
}, [logoutManagement, persistManagement]);
```

`admin-auth-context.tsx` 只需保留 management 侧逻辑，删除 `normalAuth`、`normalNotificationCleanup` 等普通用户相关内容。`AuthContext` 改名为 `AdminAuthContext`，storage key 保持 `'tether:web:managementAuth'` 以共享 Phase 5 的已登录状态。

---

### `apps/admin-web/src/hooks/use-admin-auth.ts` (hook)

**Analog:** `apps/web/src/hooks/use-auth.ts`（完整文件，仅 11 行）：

```typescript
import * as React from 'react';
import { AdminAuthContext } from '../contexts/admin-auth-context.js';

export function useAdminAuth() {
  const context = React.useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within <AdminAuthProvider>');
  }
  return context;
}
```

---

### `apps/admin-web/src/components/layout/AdminLayout.tsx` (component, request-response)

**Analog:** `apps/web/src/main.tsx`（`RequireAdminAuth` 组件，第 242–255 行）

**路由级 Auth Guard 模式**：

```typescript
function RequireAdminAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { authReady, managementAuth } = useAuth();

  if (!authReady) return null;

  if (!managementAuth) {
    return <Navigate replace to="/admin/login" state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
```

`AdminLayout.tsx` 将此 guard 内联，并在通过后渲染左侧导航 + 顶部 header + `<Outlet />`（React Router nested route）。

**D-08 布局结构：** sidebar（5 个菜单项）+ header（当前页标题 + 已登录 admin 邮箱）+ content area（`<Outlet />`）。

**D-09/D-10 路由映射：**
```
/admin/dashboard  → 概览
/admin/users      → 用户
/admin/devices    → 设备
/admin/gateways   → Gateway
/admin/audit      → 审计
```

---

### `apps/admin-web/src/pages/DashboardPage.tsx` 等 5 个页面 (component, CRUD)

**Analog:** `apps/web/src/pages/admin-login-page.tsx`

**shadcn Card + Form 模式**（第 1–83 行全文）：

**Imports 模式**（第 1–12 行）：
```typescript
import * as React from 'react';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
```

**页面组件模式** — 每个 Page 组件都是一个普通 React function component，只渲染 content area，无需知道 sidebar/header（由 `AdminLayout` 提供）：

```typescript
export function UsersPage() {
  const { managementAuth } = useAdminAuth();
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listUsers(managementAuth!.accessToken)
      .then(setUsers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'load_failed'));
  }, [managementAuth]);

  // render table...
}
```

**D-18/D-22 确认对话框模式** — 用 `window.confirm` 或 shadcn Dialog，确认后调用 API，成功则就地过滤列表：

```typescript
const handleRevoke = async (deviceId: string) => {
  if (!window.confirm('确定吊销设备？此操作不可撤销')) return;
  try {
    await revokeDevice(managementAuth!.accessToken, deviceId);
    setDevices((current) => current.filter((d) => d.id !== deviceId));
  } catch (err) {
    setError(err instanceof Error ? err.message : 'revoke_failed');
  }
};
```

---

### `apps/server/app/controller/admin/users.ts` 等 5 个 controller (controller, CRUD)

**Analog:** `apps/server/app/controller/admin-auth.ts`（完整文件）

**Controller 核心模式**（第 1–68 行）：

```typescript
import { Controller } from 'egg';
import { listUsers } from '../../service/admin/users';

export default class AdminUsersController extends Controller {
  public async index(): Promise<void> {
    try {
      const result = await listUsers(this.app.config);
      this.ctx.body = result;
    } catch (error) {
      this.ctx.status = 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_users_failed' };
    }
  }
}
```

**错误状态码映射模式**（参照 `admin-auth.ts` 第 25–28 行）：

```typescript
this.ctx.status = error instanceof Error && error.message === 'not_found' ? 404 : 400;
this.ctx.body = { error: error instanceof Error ? error.message : 'operation_failed' };
```

**request body 读取模式**（`admin-auth.ts` 第 13 行）：

```typescript
const body = this.ctx.request.body as Record<string, string | undefined>;
```

**query params 读取模式**（参照 `audit.ts` index 方法扩展后的模式）：

```typescript
const query = this.ctx.query as Record<string, string | undefined>;
const page = Number(query.page ?? '1');
const limit = Number(query.limit ?? '20');
```

---

### `apps/server/app/service/admin/users.ts` 等 5 个 service (service, CRUD)

**Analog:** `apps/server/app/service/audit.ts` 和 `apps/server/app/service/auth.ts`

**MySQL/内存双模式模式**（`audit.ts` 第 28–53 行）：

```typescript
export async function listUsers(config: AuthConfig) {
  if (mysqlModeEnabled()) {
    return await loadUsersFromMysql();
  }
  return [...runtimeStore().users.values()];
}
```

**storage 函数调用约定**（`auth.ts` 第 26–38 行 imports）：

```typescript
import {
  mysqlModeEnabled,
  // ... storage functions
} from './storage';
import { runtimeStore } from './runtime';
```

**审计事件记录模式**（`auth.ts` 第 369–379 行）— 所有管理操作（吊销设备、取消 Gateway 等）完成后调用：

```typescript
await recordAuditEvent({
  accountId: ...,
  workspaceId: ...,
  adminUserId: ...,
  action: 'admin.device.revoked',
  tokenClass: 'management_access',
  payload: { deviceId: device.id }
});
```

---

### `apps/server/app/middleware/admin-auth.ts` (middleware, request-response)

**Analog:** `apps/server/app/middleware/auth.ts`（完整文件，19 行）

**完整参照代码**（`apps/server/app/middleware/auth.ts` 全部）：

```typescript
import type { AuthTokenClass } from '@tether/core';
import { verifyToken, type AuthConfig } from '../service/auth';

export function bearerTokenFromHeader(headerValue: string | undefined): string {
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    throw new Error('missing_token');
  }
  return headerValue.slice(7).trim();
}

export function requireTokenClass(
  headerValue: string | undefined,
  config: AuthConfig,
  expected: AuthTokenClass[]
) {
  const token = bearerTokenFromHeader(headerValue);
  const payload = verifyToken(token, config);
  if (!expected.includes(payload.tokenClass)) {
    throw new Error('wrong_token_class');
  }
  return payload;
}
```

`admin-auth.ts` 导出一个 `requireManagementToken` 函数，内部调用 `requireTokenClass(header, config, ['management_access'])`，在管理 API 路由中使用。Controller 调用示例：

```typescript
import { requireManagementToken } from '../../middleware/admin-auth';

public async index(): Promise<void> {
  try {
    const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
    // identity.adminUserId, identity.accountId 可用
    ...
  } catch (error) {
    this.ctx.status = 401;
    this.ctx.body = { error: error instanceof Error ? error.message : 'unauthorized' };
  }
}
```

---

### `apps/server/app/router/admin.ts` (route, request-response)

**Analog:** `apps/server/app/router.ts`（完整文件，26 行）

**Router 注册模式**（`apps/server/app/router.ts` 全部）：

```typescript
import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller } = app;

  router.get('/admin/api/users',           controller.admin.users.index);
  router.get('/admin/api/devices',         controller.admin.devices.index);
  router.post('/admin/api/devices/:id/revoke', controller.admin.devices.revoke);
  router.get('/admin/api/gateways',        controller.admin.gateways.index);
  router.post('/admin/api/gateways/:id/unlink', controller.admin.gateways.unlink);
  router.get('/admin/api/audit',           controller.admin.audit.index);
  router.get('/admin/api/admins',          controller.admin.admins.index);
  router.post('/admin/api/admins',         controller.admin.admins.create);
  router.delete('/admin/api/admins/:id',   controller.admin.admins.destroy);
};
```

此文件需要在 `apps/server/app/router.ts` 中通过 `import` 引入并调用，或者按 Egg 约定放在 `app/router/` 子目录并被 Egg 自动加载（取决于 Egg 版本，如不自动加载则在主 router 显式导入）。

---

## Shared Patterns

### Authentication Guard (Server)
**Source:** `apps/server/app/middleware/auth.ts`
**Apply to:** 所有 `apps/server/app/controller/admin/*.ts`

每个管理 controller 方法第一行调用：
```typescript
const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
```
失败时返回 401。

### Error Handling (Server Controllers)
**Source:** `apps/server/app/controller/admin-auth.ts` 第 25–28 行
**Apply to:** 所有 `apps/server/app/controller/admin/*.ts`

```typescript
} catch (error) {
  this.ctx.status = error instanceof Error && error.message === 'not_found' ? 404 : 400;
  this.ctx.body = { error: error instanceof Error ? error.message : 'operation_failed' };
}
```

### localStorage Token Read (Frontend)
**Source:** `apps/web/src/contexts/auth-context.tsx` 第 17 行、第 35–49 行
**Apply to:** `apps/admin-web/src/contexts/admin-auth-context.tsx`

Storage key `'tether:web:managementAuth'` 与 Phase 5 保持一致，使 admin-web 能直接复用已登录的 management token。

### requestJson HTTP Client (Frontend)
**Source:** `apps/web/src/lib/api.ts` 第 66–93 行
**Apply to:** `apps/admin-web/src/lib/admin-api.ts`

所有 admin API 调用通过同一个 `requestJson` 内部函数发出，token 通过 `options.token` 传入，自动挂载 `Authorization: Bearer` header。

### MySQL/Memory Dual Mode (Server Services)
**Source:** `apps/server/app/service/audit.ts` 第 28–53 行
**Apply to:** 所有 `apps/server/app/service/admin/*.ts`

每个 service 函数以 `if (mysqlModeEnabled())` 分支隔离 MySQL 查询和内存 runtimeStore 读取，保持与现有服务一致。

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/admin-web/src/main.tsx` (entry) | config | — | 现有 `apps/web/src/main.tsx` 包含大量 terminal/session 逻辑，admin-web 的 entry 需从头编写，只挂载 `AdminAuthProvider` + React Router + `AdminLayout` nested routes，无可直接复制的 analog |

---

## Metadata

**Analog search scope:** `apps/web/src/`, `apps/server/app/controller/`, `apps/server/app/service/`, `apps/server/app/middleware/`, `apps/server/app/router.ts`
**Files scanned:** 15
**Pattern extraction date:** 2026-05-03
