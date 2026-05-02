# Phase 05: Web-first Account Setup & Server Auth Runtime - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 33
**Analogs found:** 25 / 33

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/server/package.json` | config | request-response | `apps/web/package.json` | role-match |
| `apps/server/tsconfig.json` | config | transform | `apps/gateway/tsconfig.json` | role-match |
| `apps/server/config/config.default.ts` | config | request-response | no local Egg analog; use `05-RESEARCH.md` Egg config | no-analog |
| `apps/server/config/plugin.ts` | config | request-response | no local Egg analog; use `05-RESEARCH.md` Egg plugin pattern | no-analog |
| `apps/server/app/router.ts` | route | request-response | `apps/gateway/src/daemon.ts` | partial |
| `apps/server/app/controller/auth.ts` | controller | CRUD + request-response | no local Egg analog; use `05-RESEARCH.md` Egg controller pattern | no-analog |
| `apps/server/app/controller/admin_auth.ts` | controller | CRUD + request-response | no local Egg analog; use `05-RESEARCH.md` Egg controller pattern | no-analog |
| `apps/server/app/controller/gateway.ts` | controller | CRUD + request-response | `apps/gateway/src/daemon.ts` | partial |
| `apps/server/app/controller/token.ts` | controller | request-response | `apps/gateway/src/daemon.ts` | partial |
| `apps/server/app/controller/audit.ts` | controller | event-driven | `apps/gateway/src/store.ts` / `apps/gateway/src/daemon.ts` | partial |
| `apps/server/app/service/auth.ts` | service | CRUD | no local Egg analog; use `05-RESEARCH.md` | no-analog |
| `apps/server/app/service/admin_auth.ts` | service | CRUD | no local Egg analog; use `05-RESEARCH.md` | no-analog |
| `apps/server/app/service/gateway.ts` | service | CRUD | `apps/gateway/src/registry.ts` | partial |
| `apps/server/app/service/audit.ts` | service | event-driven | `apps/gateway/src/store.ts` | partial |
| `apps/server/app/service/notification.ts` | service | pub-sub | `apps/relay/src/relay.ts` | partial |
| `apps/server/app/middleware/auth.ts` | middleware | request-response | no local Egg analog; use `05-RESEARCH.md` JWT middleware | no-analog |
| `apps/server/sql/001_init.sql` | migration | batch | no SQL analog; use `05-RESEARCH.md` schema | no-analog |
| `packages/core/src/auth.ts` | model | request-response | `packages/protocol/src/index.ts` | role-match |
| `packages/protocol/src/index.ts` | model | streaming | `packages/protocol/src/index.ts` | exact |
| `packages/config/src/index.ts` | config | file-I/O | `packages/config/src/index.ts` | exact |
| `apps/cli/src/main.ts` | controller | request-response + file-I/O | `apps/cli/src/main.ts` | exact |
| `apps/gateway/src/daemon.ts` | controller | request-response + streaming | `apps/gateway/src/daemon.ts` | exact |
| `apps/gateway/src/relay-client.ts` | service | streaming | `apps/gateway/src/relay-client.ts` | exact |
| `apps/relay/src/relay.ts` | service | streaming + pub-sub | `apps/relay/src/relay.ts` | exact |
| `apps/web/package.json` | config | transform | `apps/web/package.json` | exact |
| `apps/web/vite.config.ts` | config | request-response | `apps/web/vite.config.ts` | exact |
| `apps/web/src/main.tsx` | component | request-response + streaming | `apps/web/src/main.tsx` | role-match |
| `apps/web/src/pages/RegisterPage.tsx` | component | request-response | `apps/web/src/main.tsx` + `05-RESEARCH.md` shadcn form | role-match |
| `apps/web/src/pages/LoginPage.tsx` | component | request-response | `apps/web/src/main.tsx` + `05-RESEARCH.md` shadcn form | role-match |
| `apps/web/src/pages/AdminRegisterPage.tsx` | component | request-response | `apps/web/src/main.tsx` + `05-RESEARCH.md` shadcn form | role-match |
| `apps/web/src/pages/AdminLoginPage.tsx` | component | request-response | `apps/web/src/main.tsx` + `05-RESEARCH.md` shadcn form | role-match |
| `apps/relay/src/relay.test.ts` | test | streaming | `apps/relay/src/relay.test.ts` | exact |
| `apps/gateway/src/daemon.test.ts` | test | request-response + streaming | `apps/gateway/src/daemon.test.ts` | exact |

## Pattern Assignments

### `apps/server/*` Egg runtime files

**Analog:** no local Egg app exists. Use `05-RESEARCH.md` Egg examples plus local API response conventions from `apps/gateway/src/daemon.ts`.

**Local route/response pattern** (`apps/gateway/src/daemon.ts` lines 50-62):
```typescript
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const app = new Hono();
  const displayHost = options.host === '0.0.0.0' ? localLanAddress() ?? '127.0.0.1' : options.host;
  const url = `http://${displayHost}:${options.port}`;
  const tickets = new Map<string, number>();
  app.post('/api/ws-ticket', (c) => {
    const ticket = randomUUID();
    tickets.set(ticket, Date.now() + 60_000);
    return c.json({ ticket, expiresInMs: 60_000 });
  });
```

**Validation/error pattern** (`apps/gateway/src/daemon.ts` lines 92-137):
```typescript
app.post('/api/sessions', async (c) => {
  if (options.allowApiSessionCreate !== true) {
    return c.json({ error: 'session creation is disabled' }, 403);
  }

  const body = await c.req.json<unknown>().catch(() => undefined);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (containsForbiddenSessionCreateKey(body)) {
    return c.json({ error: 'command-shaped session creation is not allowed' }, 400);
  }
```

**Egg imports/controller pattern** (`05-RESEARCH.md` lines 321-340):
```typescript
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

**Egg auth middleware pattern** (`05-RESEARCH.md` lines 347-379):
```typescript
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

**Egg config/plugin pattern** (`05-RESEARCH.md` lines 387-414, 761-776):
```typescript
mysql: {
  client: {
    host: process.env.TETHER_SERVER_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TETHER_SERVER_MYSQL_PORT ?? '3306'),
    user: process.env.TETHER_SERVER_MYSQL_USER ?? 'tether',
    password: process.env.TETHER_SERVER_MYSQL_PASSWORD ?? '',
    database: process.env.TETHER_SERVER_MYSQL_DATABASE ?? 'tether',
  },
  app: true,
  agent: false,
},
jwt: {
  secret: process.env.TETHER_SERVER_JWT_SECRET ?? '',
  expiresIn: '30d',
}
```

```typescript
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
```

### `packages/core/src/auth.ts` and `packages/protocol/src/index.ts`

**Analog:** `packages/protocol/src/index.ts`

**Type union pattern** (lines 23-47):
```typescript
export type RelayGatewayToServerFrame =
  | { type: 'gateway.auth'; gatewayId: string; secret: string }
  | { type: 'gateway.sessions'; gatewayId: string; sessions: RelaySession[] }
  | { type: 'gateway.replay'; gatewayId: string; clientId: string; sessionId: string; events: RelayTerminalEvent[] }
  | { type: 'gateway.event'; gatewayId: string; event: RelayTerminalEvent }
  | { type: 'gateway.error'; gatewayId: string; clientId?: string; sessionId?: string; code: string; message: string };

export type RelayClientToServerFrame =
  | { type: 'client.auth'; secret: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; mode: RelayClientMode }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; sessionId: string }
  | { type: 'client.detach'; sessionId: string };
```

**Apply:** add token payload types as exported discriminated unions. Extend relay auth frames with `token?` while keeping `secret?` only for explicit legacy mode.

### `packages/config/src/index.ts`

**Analog:** `packages/config/src/index.ts`

**Config read/write pattern** (lines 63-91):
```typescript
export function configPath(): string {
  return path.join(os.homedir(), '.tether', 'config.json');
}

export function readTetherConfig(pathOverride?: string): TetherConfig {
  const filePath = pathOverride ?? configPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as TetherConfig;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Tether config JSON: ${message}`);
  }
}

export async function writeTetherConfig(config: TetherConfig, pathOverride?: string): Promise<void> {
  const filePath = pathOverride ?? configPath();
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
```

**Env precedence pattern** (lines 107-116):
```typescript
export function resolveRelayConfig(input: RelayConfigInput = {}): ResolvedRelayConfig | undefined {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const url = input.cli?.relayUrl ?? env.TETHER_RELAY_URL ?? file.relay?.url;
  const secret = input.cli?.relaySecret ?? env.TETHER_RELAY_SECRET ?? file.relay?.secret;
  if (!url || !secret) {
    return undefined;
  }
  return { url, secret };
}
```

**Apply:** add `authPath()`, `readGatewayAuth()`, `writeGatewayAuth()` using the same parse/error style, but `writeGatewayAuth` must pass `{ mode: 0o600 }`.

### `apps/cli/src/main.ts`

**Analog:** `apps/cli/src/main.ts`

**Command registration pattern** (lines 110-135):
```typescript
const gatewayCommand = program
  .command('gateway')
  .description('start a persistent Tether Gateway without creating a session')
  .option('--host <host>', 'daemon host to bind')
  .option('--port <port>', 'daemon port', parsePort)
  .option('--relay-url <url>', 'relay server URL; falls back to TETHER_RELAY_URL')
  .option('--relay-secret <secret>', 'Relay shared secret')
  .action(async (options, command: Command) => {
    const file = readTetherConfig();
    const gateway = resolveGatewayConfig({ cli: gatewayCliConfig(options, command), file });
    const store = new Store();
    const ptySessions = new PtySessionManager(store);
    const daemon = await startDaemon({ host: gateway.host, port: gateway.port, store, ptySessions });
    console.log(`Tether Gateway: ${daemon.url}`);
    console.log('Gateway is running. Press Ctrl-C to stop.');
    await waitForShutdown();
    await daemon.close();
  });
```

**HTTP call/error pattern** (lines 445-468):
```typescript
const response = await fetch(`${gatewayUrl}/api/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(buildCreateSessionPayload(provider, options))
});

if (response.status === 403) {
  console.warn('常驻 Gateway 当前未启用 API session creation。请在 ~/.tether/config.json 中开启 gateway.allowApiSessionCreate 后重启 Gateway；本次将回退到 inline Gateway。');
  return undefined;
}
if (!response.ok) {
  throw new Error(`创建常驻 Gateway session 失败：HTTP ${response.status}`);
}
```

**Subprocess safety pattern** (lines 697-704):
```typescript
const child = spawn('tail', ['-f', ...paths], { stdio: 'inherit' });
await new Promise<void>((resolve, reject) => {
  child.on('error', reject);
  child.on('close', () => resolve());
});
```

**Apply:** implement `tether gateway login` under `gatewayCommand`; keep Chinese user-facing output; never use `shell:true`.

### `apps/gateway/src/daemon.ts`

**Analog:** `apps/gateway/src/daemon.ts`

**Ticket issuance pattern** (lines 54-62):
```typescript
const tickets = new Map<string, number>();
app.post('/api/ws-ticket', (c) => {
  const ticket = randomUUID();
  tickets.set(ticket, Date.now() + 60_000);
  return c.json({ ticket, expiresInMs: 60_000 });
});
```

**Write endpoint pattern** (lines 206-224):
```typescript
app.post('/api/sessions/:id/input', async (c) => {
  const session = options.store.getSession(c.req.param('id'));
  if (!session) {
    return c.json({ error: 'session not found' }, 404);
  }
  if (session.transport !== 'pty-event-stream') {
    return c.json({ error: LEGACY_TMUX_UNSUPPORTED_ERROR }, 409);
  }
  const body = await c.req.json<{ data?: unknown }>().catch(() => undefined);
  if (!body || typeof body.data !== 'string' || body.data.length === 0) {
    return c.json({ error: 'data is required' }, 400);
  }
  const ok = options.ptySessions?.write(session.id, { clientId: 'http-input', data: body.data }) ?? false;
  if (!ok) {
    options.store.updateSessionStatus(session.id, 'lost');
    return c.json({ error: 'pty session is no longer running' }, 410);
  }
  return c.json({ ok: true });
});
```

**WebSocket ticket consumption pattern** (lines 280-299, 519-525):
```typescript
wss.on('connection', (socket, request) => {
  const parsedUrl = new URL(request.url ?? '/', url);
  const match = /^\/api\/sessions\/([^/]+)\/stream$/.exec(parsedUrl.pathname);
  if (!match) {
    socket.close(1008, 'unsupported path');
    return;
  }
  const sessionId = decodeURIComponent(match[1]);
  const session = options.store.getSession(sessionId);
  if (!session || session.transport !== 'pty-event-stream') {
    socket.close(1008, 'session not found');
    return;
  }
  const ticket = parsedUrl.searchParams.get('ticket');
  if (!consumeTicket(tickets, ticket)) {
    socket.close(1008, 'invalid ticket');
    return;
  }
});

function consumeTicket(tickets: Map<string, number>, ticket: string | null): boolean {
  if (!ticket) {
    return false;
  }
  const expiresAt = tickets.get(ticket);
  tickets.delete(ticket);
  return typeof expiresAt === 'number' && expiresAt >= Date.now();
}
```

**Apply:** insert token verification before ticket issuance and write endpoints. Do not trust `accountId` query fields; scope must come from token payload.

### `apps/gateway/src/relay-client.ts`

**Analog:** `apps/gateway/src/relay-client.ts`

**Relay auth frame pattern** (lines 57-69):
```typescript
const connect = () => {
  if (closed) {
    return;
  }

  setConnectionState('connecting');
  socket = new WebSocket(relayGatewayUrl(options.url));

  socket.on('open', () => {
    reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
    send({ type: 'gateway.auth', gatewayId: options.gatewayId, secret: options.secret });
    sendSessions();
  });
};
```

**Auth failure state pattern** (lines 120-128):
```typescript
case 'gateway.auth.ok':
  setConnectionState('connected');
  return;
case 'gateway.auth.failed':
  setConnectionState('auth_failed');
  socket?.close();
  return;
```

**Frame forwarding pattern** (lines 150-181):
```typescript
const writeInput = (clientId: string, sessionId: string, data: string) => {
  const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
  if (!subscription) {
    sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
    return;
  }
  if (subscription.mode !== 'control') {
    sendError(clientId, sessionId, 'observe_only', 'observer clients cannot send input');
    return;
  }
  const ok = options.ptySessions?.write(sessionId, { clientId, data }) ?? false;
  if (!ok) {
    sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
  }
};
```

**Apply:** read gateway token from `~/.tether/auth.json`, send `{ type: 'gateway.auth', token }`, preserve relay routing-only behavior, and avoid permanent `auth_failed` when a refreshed token exists.

### `apps/relay/src/relay.ts`

**Analog:** `apps/relay/src/relay.ts`

**Imports and server setup** (lines 1-18, 41-74):
```typescript
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  RelayClientToServerFrame,
  RelayClientMode,
  RelayGatewayToServerFrame,
  RelayServerToClientFrame,
  RelayServerToGatewayFrame,
  RelaySession,
  RelayTerminalEvent
} from '@tether/protocol';

export async function startRelayServer(options: RelayServerOptions): Promise<RunningRelayServer> {
  if (!options.secret) {
    throw new Error('Relay secret is required');
  }
  const clients = new Map<string, ClientState>();
  const latestSessions = new Map<string, RelaySession>();
  let gateway: GatewayState | undefined;
```

**Current auth injection point** (lines 90-113, 153-178):
```typescript
if (!authenticated) {
  if (parsed.type !== 'gateway.auth' || parsed.secret !== options.secret || typeof parsed.gatewayId !== 'string') {
    socket.close(POLICY_VIOLATION, 'authentication failed');
    return;
  }
  if (gateway && gateway.socket !== socket) {
    gateway.socket.close(POLICY_VIOLATION, 'gateway replaced');
  }
  gatewayId = parsed.gatewayId;
  gateway = { gatewayId, socket };
  authenticated = true;
  sendToSocket<RelayServerToGatewayFrame>(socket, { type: 'gateway.auth.ok', gatewayId });
  return;
}
```

```typescript
if (!authenticated) {
  if (parsed.type !== 'client.auth' || parsed.secret !== options.secret) {
    socket.close(POLICY_VIOLATION, 'authentication failed');
    return;
  }
  authenticated = true;
  clients.set(clientId, { clientId, socket, subscriptions });
  sendToSocket<RelayServerToClientFrame>(socket, { type: 'client.auth.ok', clientId });
  sendToSocket<RelayServerToClientFrame>(socket, {
    type: 'hello',
    clientId,
    gatewayId: gateway?.gatewayId
  });
  return;
}
```

**Frame validation and command-block pattern** (lines 322-347, 372-393):
```typescript
function parseFrame(data: WebSocket.RawData): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(data.toString());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hasForbiddenKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenKey(item));
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || hasForbiddenKey(nested)) {
      return true;
    }
  }
  return false;
}
```

```typescript
function isClientFrame(frame: Record<string, unknown>): frame is RelayClientToServerFrame {
  switch (frame.type) {
    case 'client.list':
      return true;
    case 'client.subscribe':
      return (
        typeof frame.sessionId === 'string' &&
        (frame.after === undefined || typeof frame.after === 'number') &&
        (frame.mode === 'control' || frame.mode === 'observe')
      );
```

**Apply:** preserve `FORBIDDEN_KEYS`, add per-connection account/workspace/gateway scope, and reject cross-scope frames before forwarding.

### `apps/web/*`

**Analog:** `apps/web/src/main.tsx`, `apps/web/vite.config.ts`, `apps/web/package.json`

**Existing localStorage pattern** (`apps/web/src/main.tsx` lines 65-89):
```typescript
const WEB_TRANSPORT_KEY = 'tether:webTransportMode';
const WEB_CLIENT_MODE_KEY = 'tether:webClientMode';
const CONNECTION_MODE_KEY = 'tether:connectionMode';
const RELAY_URL_KEY = 'tether:relayUrl';
const RELAY_SECRET_KEY = 'tether:relaySecret';

function readConnectionSettings(): ConnectionSettings {
  return {
    connectionMode: readConnectionMode(),
    relayUrl: window.localStorage.getItem(RELAY_URL_KEY) ?? '',
    relaySecret: window.localStorage.getItem(RELAY_SECRET_KEY) ?? ''
  };
}
```

**App route switch pattern** (`apps/web/src/main.tsx` lines 195-217):
```tsx
function App() {
  const sessionId = sessionIdFromPath();
  const [connectionSettings, setConnectionSettings] = React.useState<ConnectionSettings>(readConnectionSettings);

  const updateConnectionSettings = React.useCallback((next: ConnectionSettings) => {
    window.localStorage.setItem(CONNECTION_MODE_KEY, next.connectionMode);
    window.localStorage.setItem(RELAY_URL_KEY, next.relayUrl);
    window.localStorage.setItem(RELAY_SECRET_KEY, next.relaySecret);
    setConnectionSettings(next);
  }, []);

  if (!sessionId) {
    return <SessionList connectionSettings={connectionSettings} onConnectionSettingsChange={updateConnectionSettings} />;
  }

  return <SessionView sessionId={sessionId} connectionSettings={connectionSettings} onConnectionSettingsChange={updateConnectionSettings} />;
}
```

**Vite proxy pattern** (`apps/web/vite.config.ts` lines 1-14):
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4789',
        ws: true
      }
    }
  }
});
```

**Package script pattern** (`apps/web/package.json` lines 6-24):
```json
"scripts": {
  "dev": "vite --host 127.0.0.1 --port 4790",
  "build": "tsc -p tsconfig.json --noEmit && vite build",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "preview": "vite preview --host 127.0.0.1 --port 4791"
},
"dependencies": {
  "@vitejs/plugin-react": "^5.0.2",
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/xterm": "^6.0.0",
  "react": "^19.1.0",
  "react-dom": "^19.1.0"
}
```

**Apply:** add shadcn/Tailwind 4 dependencies and auth routes while preserving existing terminal surface. Tokens live in `localStorage` and are sent through `Authorization: Bearer ...`.

### Tests

**Relay test analog:** `apps/relay/src/relay.test.ts`

**WebSocket auth test pattern** (lines 9-21, 197-208):
```typescript
test('relay rejects unauthenticated sockets', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4901, secret: SECRET });
  const client = new WebSocket('ws://127.0.0.1:4901/client');

  try {
    await waitForOpen(client);
    client.send(JSON.stringify({ type: 'client.list' }));
    const close = await waitForClose(client);
    assert.equal(close.code, 1008);
  } finally {
    client.close();
    await relay.close();
  }
});

async function authenticateGateway(ws: WebSocket): Promise<void> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-test', secret: SECRET }));
  await waitForJson(ws, (message) => message.type === 'gateway.auth.ok');
}
```

**Gateway test analog:** `apps/gateway/src/daemon.test.ts`

**HTTP auth/write endpoint test pattern** (lines 62-77, 213-241):
```typescript
test('session creation is disabled by default', async () => {
  const { store, cleanup } = tempStore();
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4899, store, ptySessions: new PtySessionManager(store) });

  try {
    const response = await fetch('http://127.0.0.1:4899/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'codex' })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'session creation is disabled' });
  } finally {
    await daemon.close();
    cleanup();
  }
});
```

```typescript
test('observe websocket clients cannot write input', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({ id: sessionId, provider: 'codex', command: '/bin/cat', projectPath: process.cwd(), cols: 80, rows: 24 });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4892, store, ptySessions });

  try {
    const ticket = await requestTicket(4892);
    const ws = new WebSocket(`ws://127.0.0.1:4892/api/sessions/${sessionId}/stream?ticket=${ticket}&mode=observe&surface=test`);
    const message = await waitForMessage(ws, (text) => text.includes('replay.done'));
    assert.match(message, /replay\.done/);
    ws.send(JSON.stringify({ type: 'input', data: 'blocked\r' }));
    const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
    assert.match(error, /observe_only/);
    ws.close();
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});
```

## Shared Patterns

### Authentication

**Source:** `05-RESEARCH.md` Egg middleware and `apps/relay/src/relay.ts` auth gates.
**Apply to:** `apps/server` protected routes, `apps/gateway` write/ticket endpoints, `apps/relay` `/gateway` and `/client`.

Rules:
- token class is mandatory;
- management tokens must never authorize terminal/session control;
- token payload scope is trusted, query/body `accountId` is not;
- revoked/invalid tokens return 401, wrong class/under-authorized returns 403 or WS 1008.

### Error Handling

**Source:** `apps/gateway/src/daemon.ts` lines 92-137, 206-224.
**Apply to:** HTTP controllers.

Pattern:
- parse JSON with `.catch(() => undefined)`;
- return `{ error: 'stable_code' }`;
- use concrete status codes: 400 invalid input, 401 missing/invalid token, 403 disabled/forbidden, 404 not found, 409 legacy/unsupported, 410 lost session.

### Routing-Only Relay

**Source:** `apps/relay/src/relay.ts` lines 25-27, 268-319, 334-347.
**Apply to:** Relay auth upgrade.

Pattern:
- keep `FORBIDDEN_KEYS` including `command`, `args`, `argv`, `env`, `providerCommand`;
- Relay never starts sessions and never accepts provider commands;
- Relay forwards validated frames only after checking subscription/mode/scope.

### Local File I/O

**Source:** `packages/config/src/index.ts` lines 63-91.
**Apply to:** `~/.tether/auth.json`.

Pattern:
- centralize path helpers in `packages/config`;
- create `~/.tether` recursively;
- parse JSON with typed errors;
- for auth token cache, write with restrictive mode `0o600`.

### Frontend Auth State

**Source:** `apps/web/src/main.tsx` lines 65-89 and `05-RESEARCH.md` shadcn form pattern.
**Apply to:** `AuthContext`, `useAuth`, `/register`, `/login`, `/admin/register`, `/admin/login`.

Pattern:
- localStorage keys should be namespaced like existing `tether:*` keys;
- fetch calls include `Authorization: Bearer ${accessToken}`;
- auth pages use shadcn form components and zod validation;
- terminal surface remains the primary post-login experience.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `apps/server/config/config.default.ts` | config | request-response | No Egg app exists in this repository |
| `apps/server/config/plugin.ts` | config | request-response | No Egg plugin config exists in this repository |
| `apps/server/app/controller/auth.ts` | controller | CRUD + request-response | Existing HTTP controllers are Hono closures, not Egg controllers |
| `apps/server/app/controller/admin_auth.ts` | controller | CRUD + request-response | No management realm implementation exists |
| `apps/server/app/service/auth.ts` | service | CRUD | No MySQL/JWT/bcrypt service exists |
| `apps/server/app/service/admin_auth.ts` | service | CRUD | No management auth service exists |
| `apps/server/app/middleware/auth.ts` | middleware | request-response | Existing auth is shared-secret/ticket based, not JWT middleware |
| `apps/server/sql/001_init.sql` | migration | batch | No SQL schema files exist |

## Metadata

**Analog search scope:** `apps/`, `packages/`, `.planning/phases/04-account-auth-contract/`, `.planning/codebase/`, `docs/current/`
**Files scanned:** 36 source/config/test/planning files
**Strong analogs used:** `apps/relay/src/relay.ts`, `apps/gateway/src/daemon.ts`, `apps/gateway/src/relay-client.ts`, `apps/cli/src/main.ts`, `packages/config/src/index.ts`, `packages/protocol/src/index.ts`, `apps/web/src/main.tsx`, `apps/relay/src/relay.test.ts`, `apps/gateway/src/daemon.test.ts`
**Pattern extraction date:** 2026-05-02
