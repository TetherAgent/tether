import { readFile } from 'node:fs/promises';
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
import type { ProviderName } from '@tether/core';
import { createSessionId } from './ids.js';
import { maskSensitiveOutput } from './mask.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { listGateways, registerGateway, touchGateway, unregisterGateway } from './registry.js';
import { startRelayClient, type RunningRelayClient } from './relay-client.js';
import { Store } from './store.js';
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
  const tickets = new Map<string, number>();
  const clients = new Map<string, Map<string, ClientInfo>>();
  const controllers = new Map<string, string>();
  let relayClient: RunningRelayClient | undefined;
  app.post('/api/ws-ticket', (c) => {
    const ticket = randomUUID();
    tickets.set(ticket, Date.now() + 60_000);
    return c.json({ ticket, expiresInMs: 60_000 });
  });

  app.get('/api/status', (c) => {
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
      liveSessionIds: options.ptySessions?.liveSessionIds() ?? []
    });
  });

  app.get('/api/sessions', async (c) => {
    const includeStopped = c.req.query('all') === '1';
    const sessions = options.store.listSessions();
    const liveSessions = [];
    for (const session of sessions) {
      const alive =
        session.transport === 'pty-event-stream'
          ? options.ptySessions?.hasLiveSession(session.id) ?? false
          : await sessionExists(session.tmuxSessionName);
      if (!alive && session.status === 'running' && session.transport === 'tmux') {
        options.store.updateSessionStatus(session.id, 'stopped');
        session.status = 'stopped';
      }
      if (alive && session.status === 'stopped' && session.transport === 'tmux') {
        options.store.updateSessionStatus(session.id, 'running');
        session.status = 'running';
      }
      if (alive || includeStopped) {
        liveSessions.push(session);
      }
    }
    return c.json({ sessions: liveSessions });
  });

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

    const cols = request.cols ?? 120;
    const rows = request.rows ?? 40;
    if (!isValidTerminalSize(cols, rows)) {
      return c.json({ error: 'invalid terminal size' }, 400);
    }
    const terminalRows = rows as number;

    if (!options.ptySessions) {
      return c.json({ error: 'pty session manager unavailable' }, 503);
    }

    const id = createSessionId();
    const session = options.ptySessions.create({ id, provider, command, projectPath, cols, rows: terminalRows });
    return c.json({ session }, 201);
  });

  app.get('/api/gateways', async (c) => {
    return c.json({ gateways: await listGateways() });
  });

  app.get('/api/sessions/:id/snapshot', async (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
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
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }

    const body = await c.req.json<{ text?: unknown }>().catch(() => undefined);
    if (!body || typeof body.text !== 'string' || body.text.length === 0) {
      return c.json({ error: 'text is required' }, 400);
    }

    if (body.text.length > 4000) {
      return c.json({ error: 'text is too long' }, 400);
    }

    if (session.transport === 'pty-event-stream') {
      const ok = options.ptySessions?.write(session.id, { clientId: 'http-send', data: `${body.text}\r` }) ?? false;
      if (!ok) {
        options.store.updateSessionStatus(session.id, 'lost');
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

  app.get('/api/sessions/:id/events', (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const after = parseIntegerQuery(c.req.query('after'), 0);
    const limit = parseIntegerQuery(c.req.query('limit'), 1000);
    return c.json({ events: options.store.listEvents(session.id, after, limit) });
  });

  app.get('/api/sessions/:id/clients', (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    const sessionClients = [...(clients.get(session.id)?.values() ?? [])];
    return c.json({
      controllerClientId: controllers.get(session.id) ?? null,
      clients: sessionClients
    });
  });

  app.post('/api/sessions/:id/input', async (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    if (session.transport !== 'pty-event-stream') {
      return c.json({ error: 'session is not pty-backed' }, 409);
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

  app.post('/api/sessions/:id/stop', async (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }
    if (session.transport === 'pty-event-stream') {
      const ok = options.ptySessions?.stop(session.id) ?? false;
      if (!ok) {
        options.store.updateSessionStatus(session.id, 'lost');
        return c.json({ error: 'pty session is no longer running' }, 410);
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

  const livePtyIds = options.ptySessions?.liveSessionIds() ?? [];
  for (const sessionId of options.store.markRunningPtySessionsLost(livePtyIds)) {
    options.store.appendEvent(sessionId, 'session.error', {
      code: 'session_lost',
      message: 'Gateway restarted without a live PTY handle'
    });
  }

  const wss = new WebSocketServer({ server: server as unknown as HttpServer });
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

    const clientId = `cli_${randomUUID()}`;
    const mode = parsedUrl.searchParams.get('mode') === 'observe' ? 'observe' : 'control';
    const after = parseIntegerQuery(parsedUrl.searchParams.get('after') ?? undefined, 0);
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
    for (const event of options.store.listEvents(sessionId, after, 5000)) {
      socket.send(JSON.stringify({ type: 'event', event }));
    }
    socket.send(JSON.stringify({
      type: 'replay.done',
      latestEventId: options.store.latestEventId(sessionId)
    }));
    const attached = options.store.appendEvent(session.id, 'client.attached', {
      clientId,
      deviceName: client.deviceName,
      surface: client.surface,
      mode
    });
    socket.send(JSON.stringify({ type: 'event', event: attached }));

    const unsubscribe = options.ptySessions?.subscribe(sessionId, (event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'event', event }));
      }
    });

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
      ptySessions: options.ptySessions
    });
  }

  return {
    url,
    close: async () => {
      clearInterval(heartbeat);
      await relayClient?.close();
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

const SESSION_CREATE_ALLOWED_KEYS = new Set(['provider', 'projectPath', 'cols', 'rows']);
const SESSION_CREATE_FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'shell', 'providerCommand']);

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

function consumeTicket(tickets: Map<string, number>, ticket: string | null): boolean {
  if (!ticket) {
    return false;
  }
  const expiresAt = tickets.get(ticket);
  tickets.delete(ticket);
  return typeof expiresAt === 'number' && expiresAt >= Date.now();
}

function stripAnsi(value: string): string {
  return value.replace(
    // Covers common ANSI CSI/OSC control sequences. This is a temporary fallback
    // for the pre-based snapshot UI; the event-stream UI should render with xterm.js.
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    ''
  );
}
