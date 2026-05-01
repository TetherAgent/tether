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

export type RelayServerOptions = {
  host: string;
  port: number;
  secret: string;
};

export type RunningRelayServer = {
  url: string;
  close: () => Promise<void>;
};

const POLICY_VIOLATION = 1008;
const FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'providerCommand']);
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;

type GatewayState = {
  gatewayId: string;
  socket: WebSocket;
};

type ClientState = {
  clientId: string;
  socket: WebSocket;
  subscriptions: Map<string, RelayClientMode>;
};

export async function startRelayServer(options: RelayServerOptions): Promise<RunningRelayServer> {
  if (!options.secret) {
    throw new Error('Relay secret is required');
  }

  const clients = new Map<string, ClientState>();
  const latestSessions = new Map<string, RelaySession>();
  let gateway: GatewayState | undefined;

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=UTF-8' });
      response.end('ok');
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=UTF-8' });
    response.end('not found');
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (socket, request) => {
    const path = new URL(request.url ?? '/', `http://${options.host}:${options.port}`).pathname;
    if (path === '/gateway') {
      handleGateway(socket);
      return;
    }
    if (path === '/client') {
      handleClient(socket);
      return;
    }
    socket.close(POLICY_VIOLATION, 'unsupported path');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://${options.host}:${options.port}`;
  return {
    url,
    close: () => closeRelay(wss, server)
  };

  function handleGateway(socket: WebSocket): void {
    let authenticated = false;
    let gatewayId = '';

    socket.on('message', (data) => {
      const parsed = parseFrame(data);
      if (!parsed || hasForbiddenKey(parsed)) {
        socket.close(POLICY_VIOLATION, 'invalid frame');
        return;
      }

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

      if (!isGatewayFrame(parsed, gatewayId)) {
        socket.close(POLICY_VIOLATION, 'unsupported frame');
        return;
      }
      handleGatewayFrame(parsed);
    });

    socket.on('close', () => {
      if (gateway?.socket === socket) {
        gateway = undefined;
      }
    });
  }

  function handleGatewayFrame(frame: RelayGatewayToServerFrame): void {
    switch (frame.type) {
      case 'gateway.sessions':
        latestSessions.clear();
        for (const session of frame.sessions) {
          latestSessions.set(session.id, session);
        }
        broadcastToClients({ type: 'sessions', sessions: frame.sessions });
        break;
      case 'gateway.replay':
        sendReplay(frame.clientId, frame.sessionId, frame.events);
        break;
      case 'gateway.event':
        sendEventToSubscribers(frame.event);
        break;
      case 'gateway.error':
        sendGatewayError(frame);
        break;
      case 'gateway.auth':
        break;
    }
  }

  function handleClient(socket: WebSocket): void {
    const clientId = `relay_${randomUUID()}`;
    const subscriptions = new Map<string, RelayClientMode>();
    let authenticated = false;

    socket.on('message', (data) => {
      const parsed = parseFrame(data);
      if (!parsed || hasForbiddenKey(parsed)) {
        socket.close(POLICY_VIOLATION, 'invalid frame');
        return;
      }

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

      if (!isClientFrame(parsed)) {
        socket.close(POLICY_VIOLATION, 'unsupported frame');
        return;
      }
      handleClientFrame(clientId, subscriptions, parsed);
    });

    socket.on('close', () => {
      clients.delete(clientId);
    });
  }

  function handleClientFrame(clientId: string, subscriptions: Map<string, RelayClientMode>, frame: RelayClientToServerFrame): void {
    switch (frame.type) {
      case 'client.list':
        forwardToGateway({ type: 'client.list', clientId });
        if (!gateway) {
          sendToClient(clientId, { type: 'sessions', sessions: [...latestSessions.values()] });
        }
        break;
      case 'client.subscribe':
        subscriptions.set(frame.sessionId, frame.mode);
        forwardToGateway({
          type: 'client.subscribe',
          clientId,
          sessionId: frame.sessionId,
          after: frame.after,
          mode: frame.mode
        });
        break;
      case 'client.input':
        if (subscriptions.get(frame.sessionId) !== 'control') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
            message: subscriptions.has(frame.sessionId)
              ? 'observer clients cannot send input'
              : 'client is not subscribed to this session'
          });
          break;
        }
        forwardToGateway({ type: 'client.input', clientId, sessionId: frame.sessionId, data: frame.data });
        break;
      case 'client.resize':
        if (subscriptions.get(frame.sessionId) !== 'control') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
            message: subscriptions.has(frame.sessionId)
              ? 'observer clients cannot resize'
              : 'client is not subscribed to this session'
          });
          break;
        }
        forwardToGateway({
          type: 'client.resize',
          clientId,
          sessionId: frame.sessionId,
          cols: frame.cols,
          rows: frame.rows
        });
        break;
      case 'client.detach':
        subscriptions.delete(frame.sessionId);
        forwardToGateway({ type: 'client.detach', clientId, sessionId: frame.sessionId });
        break;
      case 'client.auth':
        break;
    }
  }

  function forwardToGateway(frame: RelayServerToGatewayFrame): void {
    if (!gateway || gateway.socket.readyState !== WebSocket.OPEN) {
      const clientId = 'clientId' in frame ? frame.clientId : undefined;
      if (clientId) {
        sendToClient(clientId, { type: 'error', code: 'gateway_unavailable', message: 'gateway is not connected' });
      }
      return;
    }
    sendToSocket<RelayServerToGatewayFrame>(gateway.socket, frame);
  }

  function sendReplay(clientId: string, sessionId: string, events: RelayTerminalEvent[]): void {
    const client = clients.get(clientId);
      if (!client || !client.subscriptions.has(sessionId)) {
      return;
    }
    for (const event of events) {
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'event', event });
    }
    const latestEventId = events.at(-1)?.id ?? 0;
    sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'replay.done', sessionId, latestEventId });
  }

  function sendEventToSubscribers(event: RelayTerminalEvent): void {
    for (const client of clients.values()) {
      if (client.subscriptions.has(event.sessionId)) {
        sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'event', event });
      }
    }
  }

  function sendGatewayError(frame: Extract<RelayGatewayToServerFrame, { type: 'gateway.error' }>): void {
    const error = { type: 'error' as const, sessionId: frame.sessionId, code: frame.code, message: frame.message };
    if (frame.clientId) {
      sendToClient(frame.clientId, error);
      return;
    }
    broadcastToClients(error);
  }

  function sendToClient(clientId: string, frame: RelayServerToClientFrame): void {
    const client = clients.get(clientId);
    if (client) {
      sendToSocket<RelayServerToClientFrame>(client.socket, frame);
    }
  }

  function broadcastToClients(frame: RelayServerToClientFrame): void {
    for (const client of clients.values()) {
      sendToSocket<RelayServerToClientFrame>(client.socket, frame);
    }
  }
}

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

function isGatewayFrame(frame: Record<string, unknown>, gatewayId: string): frame is RelayGatewayToServerFrame {
  if (frame.gatewayId !== gatewayId) {
    return false;
  }
  switch (frame.type) {
    case 'gateway.sessions':
      return Array.isArray(frame.sessions);
    case 'gateway.replay':
      return typeof frame.clientId === 'string' && typeof frame.sessionId === 'string' && Array.isArray(frame.events);
    case 'gateway.event':
      return isRelayTerminalEvent(frame.event);
    case 'gateway.error':
      return (
        (frame.clientId === undefined || typeof frame.clientId === 'string') &&
        (frame.sessionId === undefined || typeof frame.sessionId === 'string') &&
        typeof frame.code === 'string' &&
        typeof frame.message === 'string'
      );
    default:
      return false;
  }
}

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
    case 'client.input':
      return typeof frame.sessionId === 'string' && typeof frame.data === 'string';
    case 'client.resize':
      return typeof frame.sessionId === 'string' && isValidTerminalSize(frame.cols, frame.rows);
    case 'client.detach':
      return typeof frame.sessionId === 'string';
    default:
      return false;
  }
}

function isValidTerminalSize(cols: unknown, rows: unknown): cols is number {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    Number(cols) > 0 &&
    Number(rows) > 0 &&
    Number(cols) <= MAX_TERMINAL_COLS &&
    Number(rows) <= MAX_TERMINAL_ROWS
  );
}

function isRelayTerminalEvent(value: unknown): value is RelayTerminalEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'number' &&
    typeof event.sessionId === 'string' &&
    typeof event.type === 'string' &&
    typeof event.ts === 'number' &&
    !!event.payload &&
    typeof event.payload === 'object' &&
    !Array.isArray(event.payload)
  );
}

function sendToSocket<T>(socket: WebSocket, frame: T): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

async function closeRelay(wss: WebSocketServer, server: HttpServer): Promise<void> {
  for (const client of wss.clients) {
    client.close();
  }
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
