import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import { readTetherConfig, type TetherConfig } from '@tether/config';
import { isProviderName, PROVIDERS } from '@tether/core';
import { ResponseCode, type AuthScopePayload, type AuthTokenClass } from '@tether/core';
import { createSessionId } from './utils/ids.js';
import { createSessionEvent } from './utils/events.js';
import { isValidTerminalSize, type PtySessionManager } from './pty/manager.js';
import { registerGateway, touchGateway, unregisterGateway } from './registry.js';
import { detectSelectOptions } from './pty/agent-select-detector.js';
import { startRelayClient, type RunningRelayClient } from './relay-client.js';
import { SessionRunnerClient } from './pty/session-runner-client.js';
import { spawnSessionRunnerProcess } from './pty/session-runner-spawn.js';
import type { Session } from './types.js';

export type DaemonOptions = {
  host: string;
  port: number;
  ptySessions: PtySessionManager;
  relay?: { url: string; secret: string; gatewayId?: string };
  config?: TetherConfig;
};

export type RunningDaemon = {
  url: string;
  close: () => Promise<void>;
};

type GatewayAuthState = {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

const GATEWAY_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

function decodeGatewayToken(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function getGatewayIdentity(authState: GatewayAuthState): { gatewayId: string; accountId: string; userId: string } | undefined {
  const payload = decodeGatewayToken(authState.accessToken);
  if (
    typeof payload?.gatewayId === 'string' &&
    typeof payload.accountId === 'string' &&
    typeof payload.userId === 'string'
  ) {
    return {
      gatewayId: payload.gatewayId,
      accountId: payload.accountId,
      userId: payload.userId
    };
  }
  const legacy = authState as GatewayAuthState & { gatewayId?: unknown; accountId?: unknown; userId?: unknown };
  if (
    typeof legacy.gatewayId === 'string' &&
    typeof legacy.accountId === 'string' &&
    typeof legacy.userId === 'string'
  ) {
    return {
      gatewayId: legacy.gatewayId,
      accountId: legacy.accountId,
      userId: legacy.userId
    };
  }
  if (typeof legacy.gatewayId === 'string') {
    return {
      gatewayId: legacy.gatewayId,
      accountId: typeof legacy.accountId === 'string' ? legacy.accountId : '',
      userId: typeof legacy.userId === 'string' ? legacy.userId : ''
    };
  }
  return undefined;
}

type AuthenticatedActor = AuthScopePayload;

type ServerApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T | null;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../web/dist');
const TETHER_VERSION = resolvePackageVersion(import.meta.url, ['@tether-labs/cli', '@tether/gateway']) ?? '0.0.0-dev';

export function localLanAddress(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

async function captureShellEnv(): Promise<void> {
  const shell = process.env.SHELL ?? '/bin/zsh';
  try {
    const stdout = await captureCommandOutput(shell, ['-l', '-c', 'env'], 5000);
    for (const line of stdout.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        process.env[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
  } catch {
    // Non-fatal: continue with existing env
  }
}

function captureCommandOutput(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('command timed out'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`command exited with code ${code ?? 1}`));
      }
    });
  });
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  await captureShellEnv();
  const app = new Hono();
  const displayHost = options.host === '0.0.0.0' ? localLanAddress() ?? '127.0.0.1' : options.host;
  const url = `http://${displayHost}:${options.port}`;
  const runnerClients = new Map<string, SessionRunnerClient>();
  let relayClient: RunningRelayClient | undefined;
  let lastServerHeartbeatAt: number | undefined;
  let lastServerHeartbeatError: string | undefined;

  const getRunnerClient = (session: Session): SessionRunnerClient | undefined => {
    if (!session.runnerSocketPath) {
      return undefined;
    }
    let client = runnerClients.get(session.id);
    if (!client) {
      client = new SessionRunnerClient({ socketPath: session.runnerSocketPath });
      runnerClients.set(session.id, client);
    }
    return client;
  };

  const pingRunner = async (session: Session): Promise<boolean> => {
    const client = getRunnerClient(session);
    if (!client) {
      return false;
    }
    try {
      const result = await client.ping();
      return result?.sessionId === session.id;
    } catch {
      runnerClients.delete(session.id);
      await client.close().catch(() => undefined);
      return false;
    }
  };

  const isLivePtySession = async (session: Session): Promise<boolean> => {
    if (session.transport !== 'pty-event-stream') {
      return false;
    }
    if (session.runnerSocketPath) {
      return pingRunner(session);
    }
    return options.ptySessions.hasLiveSession(session.id);
  };

  const getSession = (sessionId: string): Session | undefined => {
    return options.ptySessions.getSession(sessionId);
  };

  const listSessions = (): Session[] => {
    return options.ptySessions.listSessions();
  };

  const updateSessionStatus = (sessionId: string, status: Session['status'], now = Date.now()): void => {
    options.ptySessions.updateSessionStatus(sessionId, status);
    const session = options.ptySessions.getSession(sessionId);
    if (session) {
      session.lastActiveAt = now;
    }
  };

  const touchSession = (sessionId: string, now = Date.now()): void => {
    const session = options.ptySessions.getSession(sessionId);
    if (session) {
      session.updatedAt = now;
      session.lastActiveAt = now;
    }
  };

  const updateAttachState = (sessionId: string, attachState: Session['attachState'], now = Date.now()): void => {
    const session = options.ptySessions.getSession(sessionId);
    if (session) {
      session.attachState = attachState;
      session.updatedAt = now;
    }
  };

  const markSessionLost = (session: Session, message: string): void => {
    updateSessionStatus(session.id, 'lost');
    options.ptySessions.publishEvent(createSessionEvent(session.id, 'session.error', {
      code: 'session_lost',
      message
    }));
    session.status = 'lost';
  };
  app.get('/api/status', async (c) => {
    const ptySessions = listSessions().filter(
      (session) => session.transport === 'pty-event-stream' && session.status === 'running'
    );
    let runnerReachableCount = 0;
    let runnerUnreachableCount = 0;
    const liveSessionIds: string[] = [...(options.ptySessions?.liveSessionIds() ?? [])];
    for (const session of ptySessions) {
      if (!session.runnerSocketPath) {
        continue;
      }
      if (await pingRunner(session)) {
        runnerReachableCount += 1;
        liveSessionIds.push(session.id);
      } else {
        runnerUnreachableCount += 1;
      }
    }
    return c.json({
      ok: true,
      version: TETHER_VERSION,
      pid: process.pid,
      url,
      host: options.host,
      port: options.port,
      relay: relayClient ? relayClient.status() : { configured: false },
      serverAuth: await gatewayServerAuthStatus(),
      serverHeartbeat: {
        lastOkAt: lastServerHeartbeatAt,
        lastError: lastServerHeartbeatError
      },
      environment: {
        pathHasHomebrewBin: pathListIncludes(process.env.PATH, '/opt/homebrew/bin'),
        pathHasUsrLocalBin: pathListIncludes(process.env.PATH, '/usr/local/bin')
      },
      liveSessionIds,
      runners: {
        reachable: runnerReachableCount,
        unreachable: runnerUnreachableCount
      }
    });
  });

  app.get('/assets/*', async (c) => {
    const assetPath = path.resolve(webDistDir, c.req.path.replace(/^\//, ''));
    if (!assetPath.startsWith(webDistDir)) {
      return c.text('not found', 404);
    }
    const file = await readFile(assetPath).catch(() => undefined);
    if (!file) {
      return c.text('not found', 404);
    }
    return new Response(file);
  });

  const serveWebApp = async () => {
    const html = await readFile(path.resolve(webDistDir, 'index.html'), 'utf8').catch(() => undefined);
    if (!html) {
      return new Response('Web app is not built. Run: pnpm web:build', { status: 503 });
    }
    return new Response(html, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
  };

  app.get('/', serveWebApp);
  app.get('/remote', serveWebApp);
  app.get('/remote/session/:id', serveWebApp);

  const server = serve({
    fetch: app.fetch,
    hostname: options.host,
    port: options.port
  }) as ServerType;

  const livePtyIds = new Set(options.ptySessions.liveSessionIds());
  for (const session of listSessions()) {
    if (session.status !== 'running' || session.transport !== 'pty-event-stream') {
      continue;
    }
    const live = session.runnerSocketPath ? await pingRunner(session) : livePtyIds.has(session.id);
    if (live) {
      livePtyIds.add(session.id);
      if (session.attachState !== 'detached') {
        updateAttachState(session.id, 'detached');
        session.attachState = 'detached';
      }
      continue;
    }
    markSessionLost(session, 'Gateway restarted without a live PTY runner');
  }

  const gatewayId = options.relay?.gatewayId ?? `gw_${process.pid}_${options.port}`;
  const now = Date.now();
  await registerGateway({
    id: gatewayId,
    host: displayHost,
    port: options.port,
    url,
    pid: process.pid,
    startedAt: now,
    lastSeenAt: now
  });
  const heartbeat = setInterval(() => {
    touchGateway(gatewayId).catch(() => undefined);
  }, 10_000);
  heartbeat.unref();
  const serverHeartbeat = setInterval(() => {
    void sendServerHeartbeat();
  }, 30_000);
  serverHeartbeat.unref();
  void sendServerHeartbeat();

  if (options.relay) {
    relayClient = startRelayClient({
      url: options.relay.url,
      secret: options.relay.secret,
      gatewayId,
      ptySessions: options.ptySessions,
      runnerClientForSession: getRunnerClient,
      onNewPtySession: async ({ provider, cwd, cols, rows, title, providerArgs }) => {
        if (!isProviderName(provider)) {
          throw new Error(`unsupported provider: ${provider}`);
        }
        const authState = await loadGatewayAuthState();
        if (!authState.ok) {
          throw new Error(authState.error);
        }
        const identity = getGatewayIdentity(authState.value);
        const id = createSessionId();
        const session = await spawnSessionRunnerProcess({
          options: {
            id,
            provider,
            command: providerCommand(provider, options.config),
            providerArgs: provider === 'shell' ? ['-l'] : providerArgs,
            projectPath: path.resolve(cwd),
            title,
            cols,
            rows,
            owner: identity ? {
              accountId: identity.accountId,
              userId: identity.userId,
              gatewayId: identity.gatewayId
            } : undefined
          }
        });
        options.ptySessions.restoreSession(session);
        return { sessionId: session.id };
      }
    });
  }

  return {
    url,
    close: async () => {
      clearInterval(heartbeat);
      clearInterval(serverHeartbeat);
      await relayClient?.close();
      for (const client of runnerClients.values()) {
        await client.close().catch(() => undefined);
      }
      runnerClients.clear();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }).finally(() => unregisterGateway(gatewayId).catch(() => undefined));
    }
  };

  async function sendServerHeartbeat(): Promise<void> {
    const authState = await loadGatewayAuthState();
    if (!authState.ok) {
      lastServerHeartbeatError = authState.error;
      return;
    }
    try {
      const response = await fetch(`${authState.value.serverUrl}/api/relay/gateway/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${authState.value.accessToken}` }
      });
      if (!response.ok) {
        lastServerHeartbeatError = `HTTP ${response.status}`;
        return;
      }
      lastServerHeartbeatAt = Date.now();
      lastServerHeartbeatError = undefined;
    } catch (error) {
      lastServerHeartbeatError = error instanceof Error ? error.message : String(error);
    }
  }

  async function gatewayServerAuthStatus(): Promise<Record<string, unknown>> {
    const authState = await loadGatewayAuthState();
    if (!authState.ok) {
      return { state: authState.status === 401 ? 'missing_or_expired' : 'invalid', error: authState.error };
    }
    const identity = getGatewayIdentity(authState.value);
    return {
      state: 'logged_in',
      serverUrl: authState.value.serverUrl,
      gatewayId: identity?.gatewayId,
      accountId: identity?.accountId,
      userId: identity?.userId,
      expiresAt: authState.value.expiresAt
    };
  }
}

function providerCommand(provider: string, config = readTetherConfig()): string {
  if (provider === 'shell') {
    return process.env.SHELL || '/bin/zsh';
  }
  const configCommand = (config.providers as Record<string, { command?: string } | undefined>)?.[provider]?.command;
  if (configCommand && configCommand.length > 0) return configCommand;
  if (!isProviderName(provider)) {
    throw new Error(`unsupported provider: ${provider}`);
  }
  return PROVIDERS[provider].command;
}

function pathListIncludes(value: string | undefined, needle: string): boolean {
  return (value ?? '').split(path.delimiter).includes(needle);
}

function parseIntegerQuery(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseClientFrame(raw: string): { type?: unknown; data?: unknown; message?: unknown; cols?: unknown; rows?: unknown } | undefined {
  try {
    return JSON.parse(raw) as { type?: unknown; data?: unknown; message?: unknown; cols?: unknown; rows?: unknown };
  } catch {
    return undefined;
  }
}

async function authorizeRequest(
  authorization: string | undefined,
  allowedTokenClasses: AuthTokenClass[]
): Promise<
  | { ok: true; payload: AuthenticatedActor; gatewayId?: string }
  | { ok: false; status: 401 | 403 | 500; error: string }
> {
  const token = bearerTokenFromHeader(authorization);
  if (!token) {
    return { ok: false, status: 401, error: 'missing_token' };
  }
  const authState = await loadGatewayAuthState();
  if (!authState.ok) {
    return authState;
  }
  const payload = await validateAccessToken(authState.value.serverUrl, token);
  if (!payload) {
    return { ok: false, status: 401, error: 'invalid_token' };
  }
  if (!allowedTokenClasses.includes(payload.tokenClass)) {
    return { ok: false, status: 403, error: 'wrong_token_class' };
  }
  const identity = getGatewayIdentity(authState.value);
  return { ok: true, payload, gatewayId: identity?.gatewayId };
}

function authorizeSessionAccess(
  session: Session,
  actor: AuthenticatedActor,
  currentGatewayId?: string
): { ok: true } | { ok: false; status: 403; error: string } {
  if (session.accountId && session.accountId !== actor.accountId) {
    return { ok: false, status: 403, error: 'forbidden_account' };
  }
  if (session.userId && actor.userId && session.userId !== actor.userId) {
    return { ok: false, status: 403, error: 'forbidden_owner' };
  }
  const effectiveGatewayId = actor.gatewayId ?? currentGatewayId;
  if (session.gatewayId && effectiveGatewayId && session.gatewayId !== effectiveGatewayId) {
    return { ok: false, status: 403, error: 'forbidden_gateway' };
  }
  if (session.userId && !actor.userId) {
    return { ok: false, status: 403, error: 'forbidden_owner' };
  }
  return { ok: true };
}

function bearerTokenFromHeader(headerValue: string | undefined): string | undefined {
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    return undefined;
  }
  return headerValue.slice(7).trim();
}

async function loadGatewayAuthState(): Promise<
  | { ok: true; value: GatewayAuthState }
  | { ok: false; status: 500 | 401; error: string }
> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    return { ok: false, status: 401, error: 'gateway_auth_missing' };
  }
  const parsed = parseGatewayAuthState(raw);
  if (!parsed) {
    return { ok: false, status: 500, error: 'gateway_auth_invalid' };
  }
  if (parsed.expiresAt <= Date.now() + GATEWAY_TOKEN_REFRESH_SKEW_MS) {
    const refreshed = await refreshGatewayAuthState(parsed).catch(() => undefined);
    if (refreshed) {
      return { ok: true, value: refreshed };
    }
  }
  if (parsed.expiresAt <= Date.now()) {
    return { ok: false, status: 401, error: 'gateway_auth_expired' };
  }
  return { ok: true, value: parsed };
}

function gatewayAuthPath(): string {
  return process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json');
}

function parseGatewayAuthState(raw: string): GatewayAuthState | undefined {
  try {
    const value = JSON.parse(raw) as Partial<GatewayAuthState>;
    if (
      typeof value.serverUrl === 'string' &&
      typeof value.accessToken === 'string' &&
      typeof value.refreshToken === 'string' &&
      typeof value.expiresAt === 'number'
    ) {
      return value as GatewayAuthState;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function refreshGatewayAuthState(state: GatewayAuthState): Promise<GatewayAuthState | undefined> {
  const response = await fetch(`${state.serverUrl}/api/relay/gateway/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  if (!response.ok) {
    return undefined;
  }
  const body = await response.json().catch(() => undefined);
  const data = unwrapServerApiData<{ accessToken?: unknown; refreshToken?: unknown }>(body);
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return undefined;
  }
  const payload = decodeGatewayToken(data.accessToken);
  if (typeof payload?.expiresAt !== 'number') {
    return undefined;
  }
  const next: GatewayAuthState = {
    serverUrl: state.serverUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: payload.expiresAt
  };
  await mkdir(path.dirname(gatewayAuthPath()), { recursive: true });
  await writeFile(gatewayAuthPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function resolvePackageVersion(startUrl: string, packageNames: string[]): string | undefined {
  let current = path.dirname(fileURLToPath(startUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown; version?: unknown };
        if (
          typeof parsed.name === 'string' &&
          packageNames.includes(parsed.name) &&
          typeof parsed.version === 'string'
        ) {
          return parsed.version;
        }
      } catch {
        return undefined;
      }
    }
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return undefined;
}

async function validateAccessToken(serverUrl: string, token: string): Promise<AuthenticatedActor | undefined> {
  const response = await fetch(`${serverUrl}/api/server/token/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  }).catch(() => undefined);
  if (!response?.ok) {
    return undefined;
  }
  const body = await response.json().catch(() => undefined);
  const payload = unwrapServerApiData<Partial<AuthenticatedActor>>(body);
  if (payload && isAuthenticatedActor(payload)) {
    return payload;
  }
  return undefined;
}

function unwrapServerApiData<T>(body: unknown): T | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if ('code' in body) {
    const payload = body as ServerApiResponse<T>;
    return payload.code === ResponseCode.SUCCESS && payload.data ? payload.data : undefined;
  }
  return body as T;
}

function isAuthenticatedActor(payload: Partial<AuthenticatedActor>): payload is AuthenticatedActor {
  return (
    typeof payload.accountId === 'string' &&
    typeof payload.tokenClass === 'string' &&
    typeof payload.expiresAt === 'number' &&
    typeof payload.jti === 'string'
  );
}

function stripAnsi(value: string): string {
  return value.replace(
    // Covers common ANSI CSI/OSC control sequences. This is a temporary fallback
    // for the pre-based snapshot UI; the event-stream UI should render with xterm.js.
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  );
}
