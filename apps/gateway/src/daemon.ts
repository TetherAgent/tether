import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { readTetherConfig, type TetherConfig } from '@tether/config';
import { isProviderName, PROVIDERS } from '@tether/core';
import { ResponseCode, type AuthScopePayload, type AuthTokenClass, type ProviderName, type SessionAccessMode } from '@tether/core';
import { createSessionId } from './ids.js';
import { maskSensitiveOutput } from './mask.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { replaySessionEvents } from './replay.js';
import { listGateways, registerGateway, touchGateway, unregisterGateway } from './registry.js';
import { startRelayClient, type RunningRelayClient } from './relay-client.js';
import { SessionRunnerClient } from './session-runner-client.js';
import { spawnSessionRunnerProcess } from './session-runner-spawn.js';
import { Store, type Session } from './store.js';
import { capturePane, sendKeys, sessionExists } from './tmux.js';

export type DaemonOptions = {
  host: string;
  port: number;
  store: Store;
  ptySessions?: PtySessionManager;
  relay?: { url: string; secret: string; gatewayId?: string };
  allowApiSessionCreate?: boolean;
  config?: TetherConfig;
};

export type RunningDaemon = {
  url: string;
  close: () => Promise<void>;
};

type GatewayAuthState = {
  serverUrl: string;
  gatewayId: string;
  accountId: string;
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type AuthenticatedActor = AuthScopePayload;

type ServerApiResponse<T> = {
  code: number;
  msg?: string;
  data?: T | null;
};

type WsTicketPayload = AuthScopePayload & {
  tokenClass: 'ws_ticket';
  sessionId: string;
  mode: SessionAccessMode;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../web/dist');

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

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const app = new Hono();
  const displayHost = options.host === '0.0.0.0' ? localLanAddress() ?? '127.0.0.1' : options.host;
  const url = `http://${displayHost}:${options.port}`;
  const consumedTicketJtis = new Set<string>();
  const clients = new Map<string, Map<string, ClientInfo>>();
  const controllers = new Map<string, string>();
  const runnerClients = new Map<string, SessionRunnerClient>();
  let relayClient: RunningRelayClient | undefined;

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
    return options.ptySessions?.hasLiveSession(session.id) ?? false;
  };

  const markSessionLost = (session: Session, message: string): void => {
    options.store.updateSessionStatus(session.id, 'lost');
    options.store.appendEvent(session.id, 'session.error', {
      code: 'session_lost',
      message
    });
    session.status = 'lost';
  };
  app.post('/api/ws-ticket', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const body = await c.req.json<unknown>().catch(() => undefined);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const request = body as Record<string, unknown>;
    if (typeof request.sessionId !== 'string') {
      return c.json({ error: 'sessionId is required' }, 400);
    }
    const mode = request.mode === 'observe' ? 'observe' : request.mode === 'control' ? 'control' : undefined;
    if (!mode) {
      return c.json({ error: 'mode is required' }, 400);
    }
    const session = options.store.getSession(request.sessionId);
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    const authState = await loadGatewayAuthState();
    if (!authState.ok) {
      return c.json({ error: authState.error }, authState.status);
    }
    const ticket = issueWsTicket({
      accountId: actor.payload.accountId,
      workspaceId: actor.payload.workspaceId,
      gatewayId: actor.payload.gatewayId ?? authState.value.gatewayId,
      userId: actor.payload.userId,
      deviceId: actor.payload.deviceId,
      sessionId: session.id,
      mode,
      tokenClass: 'ws_ticket',
      expiresAt: Date.now() + 60_000,
      jti: `wst_${randomUUID().replace(/-/g, '')}`
    }, authState.value.refreshToken);
    return c.json({ ticket, expiresInMs: 60_000 });
  });

  app.get('/api/status', async (c) => {
    const ptySessions = options.store.listSessions().filter(
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
      pid: process.pid,
      url,
      host: options.host,
      port: options.port,
      allowApiSessionCreate: Boolean(options.allowApiSessionCreate),
      relay: relayClient ? relayClient.status() : { configured: false },
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

  app.get('/api/sessions', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const includeStopped = c.req.query('all') === '1';
    const sessions = options.store.listSessions();
    const liveSessions = [];
    for (const session of sessions) {
      const alive =
        session.transport === 'pty-event-stream'
          ? await isLivePtySession(session)
          : await sessionExists(session.tmuxSessionName);
      if (!alive && session.status === 'running' && session.transport === 'tmux') {
        options.store.updateSessionStatus(session.id, 'stopped');
        session.status = 'stopped';
      }
      if (!alive && session.status === 'running' && session.transport === 'pty-event-stream') {
        markSessionLost(session, 'Gateway no longer has a live runner for this session');
      }
      if (alive && session.status === 'stopped' && session.transport === 'tmux') {
        options.store.updateSessionStatus(session.id, 'running');
        session.status = 'running';
      }
      if (alive || includeStopped) {
        const ownership = authorizeSessionAccess(session, actor.payload);
        if (!ownership.ok) {
          continue;
        }
        liveSessions.push(session);
      }
    }
    return c.json({ sessions: liveSessions });
  });

  app.post('/api/sessions', async (c) => {
    if (options.allowApiSessionCreate !== true) {
      return c.json({ error: 'session creation is disabled' }, 403);
    }
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }

    const body = await c.req.json<unknown>().catch(() => undefined);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (containsForbiddenSessionCreateKey(body)) {
      return c.json({ error: 'command-shaped session creation is not allowed' }, 400);
    }

    const request = body as Record<string, unknown>;
    const unsupportedKey = Object.keys(request).find((key) => !SESSION_CREATE_ALLOWED_KEYS.has(key));
    if (unsupportedKey) {
      return c.json({ error: 'unsupported session creation field' }, 400);
    }

    if (typeof request.provider !== 'string' || !isProviderName(request.provider)) {
      return c.json({ error: 'provider is required' }, 400);
    }
    const provider = request.provider;
    const command = providerCommand(provider, options.config);

    if (request.projectPath !== undefined && typeof request.projectPath !== 'string') {
      return c.json({ error: 'projectPath must be a string' }, 400);
    }
    const projectPath = path.resolve(request.projectPath ?? process.cwd());
    const title = normalizeSessionTitle(request.title);
    if (request.title !== undefined && !title) {
      return c.json({ error: 'title must be a non-empty string with at most 64 characters' }, 400);
    }

    const providerArgs = request.providerArgs ?? [];
    if (!isValidProviderArgs(providerArgs)) {
      return c.json({ error: 'providerArgs must be a string array' }, 400);
    }

    const cols = request.cols ?? 120;
    const rows = request.rows ?? 40;
    if (!isValidTerminalSize(cols, rows)) {
      return c.json({ error: 'invalid terminal size' }, 400);
    }
    const terminalRows = rows as number;

    const id = createSessionId();
    const session = await spawnSessionRunnerProcess({
      store: options.store,
      options: {
        id,
        provider,
        command,
        providerArgs,
        projectPath,
        title,
        cols,
        rows: terminalRows,
        owner: {
          accountId: actor.payload.accountId,
          workspaceId: actor.payload.workspaceId,
          userId: actor.payload.userId,
          deviceId: actor.payload.deviceId,
          gatewayId: actor.payload.gatewayId
        }
      }
    });
    return c.json({ session }, 201);
  });

  app.get('/api/gateways', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    return c.json({ gateways: await listGateways() });
  });

  app.get('/api/sessions/:id/snapshot', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }

    if (session.transport === 'pty-event-stream') {
      const text = stripAnsi(options.store.transcript(session.id, 1000));
      return c.json({ session, text, capturedAt: Date.now() });
    }

    if (!(await sessionExists(session.tmuxSessionName))) {
      options.store.updateSessionStatus(session.id, 'stopped');
      return c.json({ error: 'tmux session is no longer running' }, 410);
    }

    const raw = await capturePane(session.tmuxSessionName);
    const text = maskSensitiveOutput(raw);
    return c.json({ session, text, capturedAt: Date.now() });
  });

  app.post('/api/sessions/:id/send', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }

    const body = await c.req.json<{ text?: unknown }>().catch(() => undefined);
    if (!body || typeof body.text !== 'string' || body.text.length === 0) {
      return c.json({ error: 'text is required' }, 400);
    }

    if (body.text.length > 4000) {
      return c.json({ error: 'text is too long' }, 400);
    }

    if (session.transport === 'pty-event-stream') {
      const runnerClient = getRunnerClient(session);
      if (runnerClient) {
        try {
          await runnerClient.write(`${body.text}\r`, 'http-send');
          return c.json({ ok: true });
        } catch {
          markSessionLost(session, 'Gateway could not write to this session runner');
          return c.json({ error: 'pty session is no longer running' }, 410);
        }
      }
      const ok = options.ptySessions?.write(session.id, { clientId: 'http-send', data: `${body.text}\r` }) ?? false;
      if (!ok) {
        markSessionLost(session, 'Gateway no longer has a live PTY handle for this session');
        return c.json({ error: 'pty session is no longer running' }, 410);
      }
      return c.json({ ok: true });
    }

    if (!(await sessionExists(session.tmuxSessionName))) {
      options.store.updateSessionStatus(session.id, 'stopped');
      return c.json({ error: 'tmux session is no longer running' }, 410);
    }

    await sendKeys(session.tmuxSessionName, body.text);
    options.store.touchSession(session.id);
    return c.json({ ok: true });
  });

  app.get('/api/sessions/:id/events', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    const after = parseIntegerQuery(c.req.query('after'), 0);
    const limit = parseIntegerQuery(c.req.query('limit'), 1000);
    const tail = parseIntegerQuery(c.req.query('tail'), 0);
    const events = tail > 0 && after === 0
      ? options.store.listRecentEvents(session.id, tail)
      : options.store.listEvents(session.id, after, limit);
    return c.json({ events });
  });

  app.get('/api/sessions/:id/clients', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    const sessionClients = [...(clients.get(session.id)?.values() ?? [])];
    return c.json({
      controllerClientId: controllers.get(session.id) ?? null,
      clients: sessionClients
    });
  });

  app.post('/api/sessions/:id/input', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    if (session.transport !== 'pty-event-stream') {
      return c.json({ error: 'session is not pty-backed' }, 409);
    }
    const body = await c.req.json<{ data?: unknown }>().catch(() => undefined);
    if (!body || typeof body.data !== 'string' || body.data.length === 0) {
      return c.json({ error: 'data is required' }, 400);
    }
    const runnerClient = getRunnerClient(session);
    if (runnerClient) {
      try {
        await runnerClient.write(body.data, 'http-input');
        return c.json({ ok: true });
      } catch {
        markSessionLost(session, 'Gateway could not write to this session runner');
        return c.json({ error: 'pty session is no longer running' }, 410);
      }
    }
    const ok = options.ptySessions?.write(session.id, { clientId: 'http-input', data: body.data }) ?? false;
    if (!ok) {
      markSessionLost(session, 'Gateway no longer has a live PTY handle for this session');
      return c.json({ error: 'pty session is no longer running' }, 410);
    }
    return c.json({ ok: true });
  });

  app.post('/api/sessions/:id/resize', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    if (session.transport !== 'pty-event-stream') {
      return c.json({ error: 'session is not pty-backed' }, 409);
    }
    const body = await c.req.json<{ cols?: unknown; rows?: unknown }>().catch(() => undefined);
    if (!body || typeof body.cols !== 'number' || typeof body.rows !== 'number' || !isValidTerminalSize(body.cols, body.rows)) {
      return c.json({ error: 'invalid terminal size' }, 400);
    }
    const runnerClient = getRunnerClient(session);
    if (runnerClient) {
      try {
        await runnerClient.resize(body.cols, body.rows, 'http-resize');
        return c.json({ ok: true });
      } catch {
        markSessionLost(session, 'Gateway could not resize this session runner');
        return c.json({ error: 'pty session is no longer running' }, 410);
      }
    }
    const ok = options.ptySessions?.resize(session.id, 'http-resize', body.cols, body.rows) ?? false;
    if (!ok) {
      markSessionLost(session, 'Gateway no longer has a live PTY handle for this session');
      return c.json({ error: 'pty session is no longer running' }, 410);
    }
    return c.json({ ok: true });
  });

  app.post('/api/sessions/:id/stop', async (c) => {
    const actor = await authorizeRequest(c.req.header('authorization'), ['normal_client_access', 'gateway_access']);
    if (!actor.ok) {
      return c.json({ error: actor.error }, actor.status);
    }
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const ownership = authorizeSessionAccess(session, actor.payload);
    if (!ownership.ok) {
      return c.json({ error: ownership.error }, ownership.status);
    }
    if (session.transport === 'pty-event-stream') {
      const runnerClient = getRunnerClient(session);
      if (runnerClient) {
        try {
          await runnerClient.stop('http-stop');
          return c.json({ ok: true });
        } catch {
          if (session.status === 'running') {
            markSessionLost(session, 'Stop requested after Gateway lost the session runner');
          }
          return c.json({
            ok: true,
            stopped: false,
            status: 'lost',
            error: 'session_lost',
            message: 'Gateway no longer has a live session runner; session was marked lost'
          });
        }
      }
      const ok = options.ptySessions?.stop(session.id) ?? false;
      if (!ok) {
        if (session.status === 'running') {
          markSessionLost(session, 'Stop requested after Gateway lost the PTY handle');
        }
        return c.json({
          ok: true,
          stopped: false,
          status: 'lost',
          error: 'session_lost',
          message: 'Gateway no longer has a live PTY handle; session was marked lost'
        });
      }
      return c.json({ ok: true });
    }
    if (!(await sessionExists(session.tmuxSessionName))) {
      options.store.updateSessionStatus(session.id, 'stopped');
      return c.json({ error: 'tmux session is no longer running' }, 410);
    }
    return c.json({ error: 'tmux stop is not implemented in this endpoint' }, 501);
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

  const livePtyIds = new Set(options.ptySessions?.liveSessionIds() ?? []);
  for (const session of options.store.listSessions()) {
    if (session.status !== 'running' || session.transport !== 'pty-event-stream') {
      continue;
    }
    const live = session.runnerSocketPath ? await pingRunner(session) : livePtyIds.has(session.id);
    if (live) {
      livePtyIds.add(session.id);
      if (session.attachState !== 'detached') {
        options.store.updateAttachState(session.id, 'detached');
        session.attachState = 'detached';
      }
      continue;
    }
    markSessionLost(session, 'Gateway restarted without a live PTY runner');
  }

  const wss = new WebSocketServer({ server: server as unknown as HttpServer });
  wss.on('connection', async (socket, request) => {
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
    if (!(await isLivePtySession(session))) {
      socket.close(1008, 'session_lost');
      return;
    }
    const ticket = wsTicketFromRequest(request, parsedUrl);
    const mode = parsedUrl.searchParams.get('mode') === 'observe' ? 'observe' : 'control';
    const authState = await loadGatewayAuthState();
    if (!authState.ok) {
      socket.close(1008, authState.error);
      return;
    }
    const ticketPayload = consumeTicket(consumedTicketJtis, ticket, sessionId, mode, authState.value.refreshToken);
    if (!ticketPayload.ok) {
      socket.close(1008, ticketPayload.error);
      return;
    }

    const clientId = `cli_${randomUUID()}`;
    const after = parseIntegerQuery(parsedUrl.searchParams.get('after') ?? undefined, 0);
    const tail = parseIntegerQuery(parsedUrl.searchParams.get('tail') ?? undefined, 0);
    const requestedCols = parseIntegerQuery(parsedUrl.searchParams.get('cols') ?? undefined, 0);
    const requestedRows = parseIntegerQuery(parsedUrl.searchParams.get('rows') ?? undefined, 0);
    let sessionClients = clients.get(session.id);
    if (!sessionClients) {
      sessionClients = new Map();
      clients.set(session.id, sessionClients);
    }
    if (mode === 'control') {
      controllers.set(session.id, clientId);
    }
    const client: ClientInfo = {
      clientId,
      deviceName: parsedUrl.searchParams.get('device') ?? 'websocket-client',
      surface: parsedUrl.searchParams.get('surface') ?? 'web',
      mode,
      attachedAt: Date.now(),
      lastSeenAt: Date.now()
    };
    sessionClients.set(clientId, client);
    options.store.updateAttachState(session.id, 'attached');
    socket.send(JSON.stringify({
      type: 'hello',
      sessionId,
      clientId,
      latestEventId: options.store.latestEventId(sessionId),
      controllerClientId: controllers.get(session.id) ?? null
    }));
    if (mode === 'control' && isValidTerminalSize(requestedCols, requestedRows)) {
      const runnerClient = getRunnerClient(session);
      if (runnerClient) {
        try {
          await runnerClient.resize(requestedCols, requestedRows, clientId);
        } catch {
          markSessionLost(session, 'Gateway could not resize this session runner before replay');
          socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
          socket.close(1008, 'session_lost');
          return;
        }
      } else {
        const ok = options.ptySessions?.resize(sessionId, clientId, requestedCols, requestedRows) ?? false;
        if (!ok) {
          markSessionLost(session, 'Gateway could not resize this PTY session before replay');
          socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
          socket.close(1008, 'session_lost');
          return;
        }
      }
    }
    const replayCursor = replaySessionEvents({
      store: options.store,
      sessionId,
      after,
      tail,
      sendPage: ({ events, done, latestEventId }) => {
        const output = events
          .map((event) => event.type === 'terminal.output' && typeof event.payload.data === 'string' ? event.payload.data : '')
          .join('');
        if (output.length > 0) {
          socket.send(JSON.stringify({ type: 'replay.output', sessionId, data: output, latestEventId }));
        }
        for (const event of events) {
          if (event.type === 'terminal.output' || event.type === 'user.input' || event.type === 'terminal.resize' || event.type === 'client.attached') {
            continue;
          }
          socket.send(JSON.stringify({ type: 'event', event }));
        }
        if (done) {
          socket.send(JSON.stringify({ type: 'replay.done', latestEventId }));
        }
      }
    });
    const attached = options.store.appendEvent(session.id, 'client.attached', {
      clientId,
      deviceName: client.deviceName,
      surface: client.surface,
      mode
    });
    socket.send(JSON.stringify({ type: 'event', event: attached }));

    const runnerClient = getRunnerClient(session);
    let unsubscribe: (() => void | Promise<void>) | undefined;
    if (runnerClient) {
      try {
        unsubscribe = await runnerClient.subscribeEvents((frame) => {
          const event = options.store.listEvents(frame.sessionId, frame.eventId - 1, 1)[0];
          if (event && socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: 'event', event }));
          }
        }, replayCursor);
      } catch {
        markSessionLost(session, 'Gateway could not subscribe to this session runner');
        socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
        socket.close(1008, 'session_lost');
        return;
      }
    } else {
      unsubscribe = options.ptySessions?.subscribe(sessionId, (event) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'event', event }));
        }
      });
    }

    socket.on('message', (data) => {
      const frame = parseClientFrame(data.toString());
      if (!frame) {
        socket.send(JSON.stringify({ type: 'error', code: 'bad_frame', message: 'invalid client frame' }));
        return;
      }
      if (frame.type === 'input' && typeof frame.data === 'string') {
        client.lastSeenAt = Date.now();
        if (client.mode === 'observe' || controllers.get(session.id) !== clientId) {
          socket.send(JSON.stringify({
            type: 'error',
            code: client.mode === 'observe' ? 'observe_only' : 'not_controller',
            message: client.mode === 'observe' ? 'observer clients cannot send input' : 'client is not the active controller'
          }));
          return;
        }
        if (runnerClient) {
          runnerClient.write(frame.data, clientId).catch(() => {
            socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
          });
          return;
        }
        const ok = options.ptySessions?.write(sessionId, { clientId, data: frame.data }) ?? false;
        if (!ok) {
          socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
        }
        return;
      }
      if (
        frame.type === 'resize' &&
        typeof frame.cols === 'number' &&
        typeof frame.rows === 'number'
      ) {
        client.lastSeenAt = Date.now();
        if (client.mode === 'observe' || controllers.get(session.id) !== clientId) {
          socket.send(JSON.stringify({
            type: 'error',
            code: client.mode === 'observe' ? 'observe_only' : 'not_controller',
            message: client.mode === 'observe' ? 'observer clients cannot resize' : 'client is not the active controller'
          }));
          return;
        }
        if (!isValidTerminalSize(frame.cols, frame.rows)) {
          socket.send(JSON.stringify({ type: 'error', code: 'bad_resize', message: 'resize requires positive terminal dimensions' }));
          return;
        }
        if (runnerClient) {
          runnerClient.resize(frame.cols, frame.rows, clientId).catch(() => {
            socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
          });
          return;
        }
        const ok = options.ptySessions?.resize(sessionId, clientId, frame.cols, frame.rows) ?? false;
        if (!ok) {
          socket.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'PTY session is no longer running' }));
        }
      }
    });

    socket.on('close', () => {
      unsubscribe?.();
      sessionClients?.delete(clientId);
      if (controllers.get(session.id) === clientId) {
        const nextController = [...(sessionClients?.values() ?? [])].find((candidate) => candidate.mode === 'control');
        if (nextController) {
          controllers.set(session.id, nextController.clientId);
          options.store.appendEvent(session.id, 'client.control_changed', {
            previousClientId: clientId,
            nextClientId: nextController.clientId,
            reason: 'disconnect'
          });
        } else {
          controllers.delete(session.id);
        }
      }
      options.store.appendEvent(session.id, 'client.detached', { clientId, reason: 'disconnect' });
      if ((sessionClients?.size ?? 0) === 0) {
        options.store.updateAttachState(session.id, 'detached');
      }
    });
  });

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

  if (options.relay) {
    relayClient = startRelayClient({
      url: options.relay.url,
      secret: options.relay.secret,
      gatewayId,
      store: options.store,
      ptySessions: options.ptySessions,
      runnerClientForSession: getRunnerClient
    });
  }

  return {
    url,
    close: async () => {
      clearInterval(heartbeat);
      await relayClient?.close();
      for (const client of runnerClients.values()) {
        await client.close().catch(() => undefined);
      }
      runnerClients.clear();
      wss.close();
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
}

function providerCommand(provider: ProviderName, config = readTetherConfig()): string {
  const command = config.providers?.[provider]?.command;
  return command && command.length > 0 ? command : PROVIDERS[provider].command;
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

function parseClientFrame(raw: string): { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown } | undefined {
  try {
    return JSON.parse(raw) as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  } catch {
    return undefined;
  }
}

type ClientInfo = {
  clientId: string;
  deviceName: string;
  surface: string;
  mode: 'control' | 'observe';
  attachedAt: number;
  lastSeenAt: number;
};

const SESSION_CREATE_ALLOWED_KEYS = new Set(['provider', 'projectPath', 'title', 'cols', 'rows', 'providerArgs']);
const SESSION_CREATE_FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'shell', 'providerCommand']);
const MAX_SESSION_NAME_LENGTH = 64;
const MAX_PROVIDER_ARGS = 64;
const MAX_PROVIDER_ARG_LENGTH = 4096;

function normalizeSessionTitle(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SESSION_NAME_LENGTH || /[\r\n]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function isValidProviderArgs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PROVIDER_ARGS &&
    value.every((item) => typeof item === 'string' && item.length <= MAX_PROVIDER_ARG_LENGTH)
  );
}

function containsForbiddenSessionCreateKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenSessionCreateKey);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (SESSION_CREATE_FORBIDDEN_KEYS.has(key) || containsForbiddenSessionCreateKey(nested)) {
      return true;
    }
  }
  return false;
}

async function authorizeRequest(
  authorization: string | undefined,
  allowedTokenClasses: AuthTokenClass[]
): Promise<
  | { ok: true; payload: AuthenticatedActor }
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
  return { ok: true, payload };
}

function authorizeSessionAccess(
  session: Session,
  actor: AuthenticatedActor
): { ok: true } | { ok: false; status: 403; error: string } {
  if (session.accountId && session.accountId !== actor.accountId) {
    return { ok: false, status: 403, error: 'forbidden_account' };
  }
  if (session.workspaceId && session.workspaceId !== actor.workspaceId) {
    return { ok: false, status: 403, error: 'forbidden_workspace' };
  }
  if (session.userId && actor.userId && session.userId !== actor.userId) {
    return { ok: false, status: 403, error: 'forbidden_owner' };
  }
  if (session.gatewayId && actor.gatewayId && session.gatewayId !== actor.gatewayId) {
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
      typeof value.gatewayId === 'string' &&
      typeof value.accountId === 'string' &&
      typeof value.workspaceId === 'string' &&
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

async function validateAccessToken(serverUrl: string, token: string): Promise<AuthenticatedActor | undefined> {
  const response = await fetch(`${serverUrl}/api/token/validate`, {
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
    typeof payload.workspaceId === 'string' &&
    typeof payload.tokenClass === 'string' &&
    typeof payload.expiresAt === 'number' &&
    typeof payload.jti === 'string'
  );
}

function wsTicketFromRequest(request: { headers: { 'sec-websocket-protocol'?: string | string[] | undefined } }, url: URL): string | null {
  const protocolHeader = request.headers['sec-websocket-protocol'];
  const protocols = Array.isArray(protocolHeader)
    ? protocolHeader.flatMap((value) => value.split(','))
    : (protocolHeader ?? '').split(',');
  const ticketProtocol = protocols.map((value) => value.trim()).find((value) => value.startsWith('tether-ticket.'));
  if (ticketProtocol) {
    return ticketProtocol.slice('tether-ticket.'.length);
  }
  return url.searchParams.get('ticket');
}

function issueWsTicket(payload: WsTicketPayload, secret: string): string {
  const encodedHeader = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encodeSegment(payload);
  const signature = signValue(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function consumeTicket(
  consumedJtis: Set<string>,
  ticket: string | null,
  expectedSessionId: string,
  expectedMode: SessionAccessMode,
  secret: string
): { ok: true; payload: WsTicketPayload } | { ok: false; error: string } {
  if (!ticket) {
    return { ok: false, error: 'invalid ticket' };
  }
  const parts = ticket.split('.');
  if (parts.length !== 3) {
    return { ok: false, error: 'invalid ticket' };
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, error: 'invalid ticket' };
  }
  const payload = decodeSegment<WsTicketPayload>(encodedPayload);
  if (payload.tokenClass !== 'ws_ticket') {
    return { ok: false, error: 'invalid ticket' };
  }
  if (payload.expiresAt < Date.now()) {
    return { ok: false, error: 'expired ticket' };
  }
  if (payload.sessionId !== expectedSessionId) {
    return { ok: false, error: 'wrong session ticket' };
  }
  if (payload.mode !== expectedMode) {
    return { ok: false, error: 'wrong mode ticket' };
  }
  if (consumedJtis.has(payload.jti)) {
    return { ok: false, error: 'reused ticket' };
  }
  consumedJtis.add(payload.jti);
  return { ok: true, payload };
}

function encodeSegment(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSegment<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function stripAnsi(value: string): string {
  return value.replace(
    // Covers common ANSI CSI/OSC control sequences. This is a temporary fallback
    // for the pre-based snapshot UI; the event-stream UI should render with xterm.js.
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  );
}
