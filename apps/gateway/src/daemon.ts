import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import { readTetherConfig, type TetherConfig } from '@tether/config';
import { isProviderName, PROVIDERS } from '@tether/core';
import type { AuthScopePayload } from '@tether/core';
import { initLogger, logger } from './utils/logger.js';
import { createSessionId } from './utils/ids.js';
import { createSessionEvent } from './utils/events.js';
import { isValidTerminalSize, type PtySessionManager } from './pty/manager.js';
import { openLocalTerminalForProvider, type LocalTerminalProvider } from './pty/local-terminal.js';
import { registerGateway, touchGateway, unregisterGateway } from './registry.js';
import { detectSelectOptions } from './pty/agent-select-detector.js';
import { startRelayClient, type RunningRelayClient } from './relay-client.js';
import { SessionRunnerClient } from './pty/session-runner-client.js';
import { spawnSessionRunnerProcess } from './pty/session-runner-spawn.js';
import type { Session, SessionStatus } from './types.js';
import { decodeGatewayToken, loadGatewayAuthState, type GatewayAuthState } from './utils/gateway-auth.js';
import { resolvePackageVersion } from './utils/package-version.js';

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
  return undefined;
}

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
  initLogger();
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

  const updateRunnerExitStatus = (
    sessionId: string,
    exitCode: number | null,
    signal: NodeJS.Signals | null
  ): void => {
    const session = options.ptySessions.getSession(sessionId);
    if (!session || session.status !== 'running') {
      return;
    }
    const nextStatus: SessionStatus = signal ? 'lost' : exitCode === 0 ? 'completed' : 'failed';
    updateSessionStatus(sessionId, nextStatus);
    session.status = nextStatus;
    options.ptySessions.publishEvent(createSessionEvent(sessionId, 'runner.exited', {
      exitCode,
      signal,
      status: nextStatus
    }));
    void relayClient?.syncSessions();
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
    logger.warn('daemon', 'session marked lost on startup', { sessionId: session.id });
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

  logger.info('daemon', 'started', { host: options.host, port: options.port, version: TETHER_VERSION, gatewayId });

  if (options.relay) {
    relayClient = startRelayClient({
      url: options.relay.url,
      secret: options.relay.secret,
      gatewayId,
      ptySessions: options.ptySessions,
      runnerClientForSession: getRunnerClient,
      onNewPtySession: async ({ provider, cwd, cols, rows, launchMode, title, providerArgs }) => {
        if (!isProviderName(provider)) {
          throw new Error(`unsupported provider: ${provider}`);
        }
        if (!isLaunchablePtyProvider(provider)) {
          throw new Error(`unsupported provider: ${provider}`);
        }
        const projectPath = resolveProjectPath(cwd);
        if (launchMode === 'local-terminal') {
          await openLocalTerminalForProvider({ cwd: projectPath, provider });
          return { launchMode, provider };
        }
        const authState = await loadGatewayAuthState();
        if (!authState.ok) {
          throw new Error(authState.error);
        }
        const identity = getGatewayIdentity(authState.value);
        if (!identity) {
          throw new Error('gateway auth identity is incomplete; run: tether login');
        }
        const id = createSessionId();
        const session = await spawnSessionRunnerProcess({
          options: {
            id,
            provider,
            command: providerCommand(provider, options.config),
            providerArgs: provider === 'shell' ? ['-l'] : providerArgs,
            projectPath,
            title,
            cols: cols ?? 120,
            rows: rows ?? 40,
            owner: {
              accountId: identity.accountId,
              userId: identity.userId,
              gatewayId: identity.gatewayId
            }
          },
          onExit: ({ sessionId, exitCode, signal }) => {
            updateRunnerExitStatus(sessionId, exitCode, signal);
          }
        });
        options.ptySessions.restoreSession(session);
        logger.info('daemon', 'pty session created', { sessionId: session.id, provider, cwd: projectPath });
        return { launchMode: 'background', sessionId: session.id };
      }
    });
  }

  return {
    url,
    close: async () => {
      logger.info('daemon', 'closed', { gatewayId });
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
        logger.warn('daemon', 'server heartbeat failed', { error: lastServerHeartbeatError });
        return;
      }
      lastServerHeartbeatAt = Date.now();
      lastServerHeartbeatError = undefined;
    } catch (error) {
      lastServerHeartbeatError = error instanceof Error ? error.message : String(error);
      logger.warn('daemon', 'server heartbeat failed', { error: lastServerHeartbeatError });
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

function isLaunchablePtyProvider(provider: string): provider is LocalTerminalProvider {
  return provider === 'shell' || provider === 'claude' || provider === 'codex';
}

function resolveProjectPath(cwd: string | undefined): string {
  const trimmed = cwd?.trim();
  if (!trimmed) {
    return process.cwd();
  }
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function pathListIncludes(value: string | undefined, needle: string): boolean {
  return (value ?? '').split(path.delimiter).includes(needle);
}
