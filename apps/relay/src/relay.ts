import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  RelayAuthScope,
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
  allowLegacySecret?: boolean;
  validateToken?: (token: string) => Promise<RelayAuthScope | undefined>;
  serverSyncUrl?: string;
  runtimeSyncSecret?: string;
};

export type RunningRelayServer = {
  url: string;
  close: () => Promise<void>;
};

const POLICY_VIOLATION = 1008;
export const TETHER_RELAY_ALLOW_LEGACY_SECRET = 'TETHER_RELAY_ALLOW_LEGACY_SECRET';
const FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'providerCommand']);
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const AUTH_TIMEOUT_MS = 5000;

type GatewayState = {
  gatewayId: string;
  scope?: RelayAuthScope;
  authMethod: RelayAuthMethod;
  socket: WebSocket;
};

type ClientState = {
  clientId: string;
  scope?: RelayAuthScope;
  gatewayId?: string;
  authMethod: RelayAuthMethod;
  socket: WebSocket;
  subscriptions: Map<string, RelayClientMode>;
};

type RelayAuthMethod = 'token' | 'legacy-secret';

export async function startRelayServer(options: RelayServerOptions): Promise<RunningRelayServer> {
  if (!options.secret && !options.validateToken) {
    throw new Error('Relay auth is required');
  }

  const RUNTIME_EVENT_WHITELIST = new Set([
    'terminal.output',
    'terminal.input',
    'user.message',
    'session.error',
    'session.exited',
    'agent.status',
    'agent.result',
    'agent.tool',
    'gateway.session-created'
  ]);

  async function syncToServer(endpoint: string, body: unknown, method = 'POST'): Promise<void> {
    if (!options.serverSyncUrl || !options.runtimeSyncSecret) {
      return;
    }
    try {
      const response = await fetch(`${options.serverSyncUrl}${endpoint}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-tether-runtime-sync-secret': options.runtimeSyncSecret
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) {
        console.warn(`[relay] sync failed: ${endpoint} HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(`[relay] sync error: ${endpoint}`, String(error));
    }
  }

  const clients = new Map<string, ClientState>();
  const latestSessions = new Map<string, RelaySession>();
  const gateways = new Map<string, GatewayState>();
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
    if (path === '/ws/gateway') {
      void handleGateway(socket);
      return;
    }
    if (path === '/ws/client') {
      void handleClient(socket);
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

  const address = server.address();
  const port = address && typeof address !== 'string' ? address.port : options.port;
  const url = `http://${options.host}:${port}`;
  return {
    url,
    close: () => closeRelay(wss, server)
  };

  async function handleGateway(socket: WebSocket): Promise<void> {
    let authenticated = false;
    let gatewayId = '';
    let gatewayScope: RelayAuthScope | undefined;
    const authTimer = setTimeout(() => {
      if (!authenticated && socket.readyState === WebSocket.OPEN) {
        socket.close(POLICY_VIOLATION, 'authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.on('message', (data) => {
      void (async () => {
        const parsed = parseFrame(data);
        if (!parsed || hasForbiddenKey(parsed)) {
          socket.close(POLICY_VIOLATION, 'invalid frame');
          return;
        }

        if (!authenticated) {
          if (parsed.type !== 'gateway.auth' || typeof parsed.gatewayId !== 'string') {
            socket.close(POLICY_VIOLATION, 'authentication failed');
            return;
          }
          const auth = await authenticateGatewayFrame(parsed as Extract<RelayGatewayToServerFrame, { type: 'gateway.auth' }>, options);
          if (!auth.ok) {
            sendToSocket<RelayServerToGatewayFrame>(socket, { type: 'gateway.auth.failed', code: auth.code, message: auth.message });
            socket.close(POLICY_VIOLATION, 'authentication failed');
            return;
          }
          const previousGateway = gateways.get(parsed.gatewayId);
          if (previousGateway && previousGateway.socket !== socket) {
            previousGateway.socket.close(POLICY_VIOLATION, 'gateway replaced');
          }
          gatewayId = parsed.gatewayId;
          gatewayScope = auth.scope;
          gateways.set(gatewayId, { gatewayId, scope: auth.scope, authMethod: auth.authMethod, socket });
          authenticated = true;
          clearTimeout(authTimer);
          sendToSocket<RelayServerToGatewayFrame>(socket, { type: 'gateway.auth.ok', gatewayId });
          return;
        }

        if (!isGatewayFrame(parsed, gatewayId)) {
          socket.close(POLICY_VIOLATION, 'unsupported frame');
          return;
        }
        if (!gatewayScope || !gatewayFrameWithinScope(parsed, gatewayScope)) {
          socket.close(POLICY_VIOLATION, 'out of scope');
          return;
        }
        handleGatewayFrame(parsed, gatewayScope);
      })().catch(() => {
        socket.close(POLICY_VIOLATION, 'gateway error');
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (gatewayId && gateways.get(gatewayId)?.socket === socket) {
        gateways.delete(gatewayId);
        dropSessionsForGateway(gatewayId);
        if (hasConnectedGateway()) {
          broadcastSessionList();
        } else {
          broadcastGatewayUnavailable();
        }
      }
    });
  }

  function handleGatewayFrame(frame: RelayGatewayToServerFrame, gatewayScope: RelayAuthScope): void {
    switch (frame.type) {
      case 'gateway.sessions':
        if (frame.sessions.length === 0 && hasCachedRunningSessions()) {
          broadcastSessionList();
          break;
        }
        dropSessionsForGateway(frame.gatewayId);
        for (const session of frame.sessions) {
          latestSessions.set(session.id, session);
        }
        broadcastSessionList();
        void syncToServer('/api/relay/runtime-sync/gateway/sessions', {
          gatewayId: frame.gatewayId,
          sessions: frame.sessions,
          scope: gatewayScope
        });
        break;
      case 'gateway.replay':
        sendReplay(frame.clientId, frame.sessionId, frame.events, frame.done !== false, frame.latestEventId);
        for (const event of frame.events) {
          if (RUNTIME_EVENT_WHITELIST.has(event.type)) {
            void syncToServer('/api/relay/runtime-sync/gateway/event', {
              gatewayId: frame.gatewayId,
              event,
              scope: gatewayScope
            });
          }
        }
        break;
      case 'gateway.event':
        if (frame.event.type === 'session.agent-id-updated') {
          const payload = frame.event.payload as { agentSessionId?: unknown };
          if (typeof payload.agentSessionId === 'string') {
            void syncToServer(
              `/api/relay/gateway-sessions/${frame.event.sessionId}/agent-session-id`,
              { agentSessionId: payload.agentSessionId },
              'PATCH'
            );
          }
          sendEventToSubscribers(frame.event);
          break;
        }
        if (frame.event.type === 'agent.delta') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'agent.delta',
              sessionId: frame.event.sessionId,
              text: String(frame.event.payload.text ?? '')
            });
          }
          break;
        }
        if (frame.event.type === 'agent.result') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'agent.result',
              sessionId: frame.event.sessionId,
              text: String(frame.event.payload.text ?? ''),
              usage: (frame.event.payload.usage ?? { input_tokens: 0, output_tokens: 0 }) as {
                input_tokens: number;
                output_tokens: number;
                cost_usd?: number;
              },
              ...(typeof frame.event.payload.stop_reason === 'string'
                ? { stop_reason: frame.event.payload.stop_reason }
                : {})
            });
          }
        } else if (frame.event.type === 'session.error') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'error',
              sessionId: frame.event.sessionId,
              code: String(frame.event.payload.code ?? 'session_error'),
              message: String(frame.event.payload.message ?? 'session error')
            });
          } else {
            sendEventToSubscribers(frame.event);
          }
        } else if (frame.event.type === 'agent.tool') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'agent.tool',
              sessionId: frame.event.sessionId,
              name: String(frame.event.payload.name ?? ''),
              input:
                frame.event.payload.input && typeof frame.event.payload.input === 'object'
                  ? (frame.event.payload.input as Record<string, unknown>)
                  : {},
              ...(typeof frame.event.payload.result === 'string' ? { result: frame.event.payload.result } : {}),
              ...(typeof frame.event.payload.isError === 'boolean' ? { isError: frame.event.payload.isError } : {})
            });
          }
        } else if (frame.event.type === 'gateway.providers') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'gateway.providers',
              providers: Array.isArray(frame.event.payload.providers)
                ? (frame.event.payload.providers as Array<{ provider: string; models: string[] }>)
                : []
            });
          }
          break;
        } else if (frame.event.type === 'gateway.cwd-suggestions') {
          const clientId = typeof frame.event.payload.clientId === 'string' ? frame.event.payload.clientId : undefined;
          if (clientId) {
            sendToClient(clientId, {
              type: 'gateway.cwd-suggestions',
              cwd: String(frame.event.payload.cwd ?? ''),
              suggestions: Array.isArray(frame.event.payload.suggestions)
                ? frame.event.payload.suggestions.filter((item): item is string => typeof item === 'string')
                : []
            });
          }
          break;
        } else {
          sendEventToSubscribers(frame.event);
        }
        if (RUNTIME_EVENT_WHITELIST.has(frame.event.type)) {
          void syncToServer('/api/relay/runtime-sync/gateway/event', {
            gatewayId: frame.gatewayId,
            event: frame.event,
            scope: gatewayScope
          });
        }
        break;
      case 'gateway.session-created': {
        const targetClient = clients.get(frame.clientId);
        if (targetClient) {
          sendToSocket<RelayServerToClientFrame>(targetClient.socket, {
            type: 'gateway.session-created',
            sessionId: frame.sessionId
          });
        }
        break;
      }
      case 'gateway.chat-catchup': {
        const targetClient = clients.get(frame.clientId);
        if (targetClient) {
          sendToSocket<RelayServerToClientFrame>(targetClient.socket, {
            type: 'gateway.chat-catchup',
            sessionId: frame.sessionId,
            text: frame.text
          });
        }
        break;
      }
      case 'gateway.error':
        sendGatewayError(frame);
        break;
      case 'gateway.auth':
        break;
    }
  }

  function hasCachedRunningSessions(): boolean {
    for (const session of latestSessions.values()) {
      if (session.status === 'running') {
        return true;
      }
    }
    return false;
  }

  function dropSessionsForGateway(gatewayId: string): void {
    for (const [sessionId, session] of latestSessions.entries()) {
      if (session.gatewayId === gatewayId) {
        latestSessions.delete(sessionId);
      }
    }
  }

  function broadcastSessionList(): void {
    const sessions = [...latestSessions.values()];
    for (const client of clients.values()) {
      ensureClientGatewayId(client.clientId);
      sendToSocket<RelayServerToClientFrame>(client.socket, {
        type: 'sessions',
        sessions: sessions.filter((session) => clientCanSeeRelaySession(client, session))
      });
    }
  }

  async function handleClient(socket: WebSocket): Promise<void> {
    const clientId = `relay_${Math.random().toString(36).slice(2, 10)}`;
    const subscriptions = new Map<string, RelayClientMode>();
    let authenticated = false;
    let clientScope: RelayAuthScope | undefined;
    const authTimer = setTimeout(() => {
      if (!authenticated && socket.readyState === WebSocket.OPEN) {
        socket.close(POLICY_VIOLATION, 'authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    socket.on('message', (data) => {
      void (async () => {
        const parsed = parseFrame(data);
        if (!parsed || hasForbiddenKey(parsed)) {
          socket.close(POLICY_VIOLATION, 'invalid frame');
          return;
        }

        if (!authenticated) {
          if (parsed.type !== 'client.auth') {
            socket.close(POLICY_VIOLATION, 'authentication failed');
            return;
          }
          const auth = await authenticateClientFrame(parsed as Extract<RelayClientToServerFrame, { type: 'client.auth' }>, options);
          if (!auth.ok) {
            sendToSocket<RelayServerToClientFrame>(socket, { type: 'client.auth.failed', code: auth.code, message: auth.message });
            socket.close(POLICY_VIOLATION, 'authentication failed');
            return;
          }
          authenticated = true;
          clearTimeout(authTimer);
          clientScope = auth.scope;
          const gatewayId = clientScope.gatewayId ?? firstConnectedGateway()?.gatewayId;
          clients.set(clientId, { clientId, scope: auth.scope, gatewayId, authMethod: auth.authMethod, socket, subscriptions });
          sendToSocket<RelayServerToClientFrame>(socket, { type: 'client.auth.ok', clientId });
          sendToSocket<RelayServerToClientFrame>(socket, {
            type: 'hello',
            clientId,
            gatewayId
          });
          return;
        }

        if (!isClientFrame(parsed)) {
          socket.close(POLICY_VIOLATION, 'unsupported frame');
          return;
        }
        if (!clientScope) {
          socket.close(POLICY_VIOLATION, 'authentication failed');
          return;
        }
        handleClientFrame(clientId, clientScope, subscriptions, parsed);
      })().catch(() => {
        socket.close(POLICY_VIOLATION, 'client error');
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clients.delete(clientId);
    });
  }

  function handleClientFrame(
    clientId: string,
    clientScope: RelayAuthScope,
    subscriptions: Map<string, RelayClientMode>,
    frame: RelayClientToServerFrame
  ): void {
    const authMethod = clients.get(clientId)?.authMethod ?? 'token';
    switch (frame.type) {
      case 'client.list':
        if (!hasConnectedGateway()) {
          sendGatewayUnavailable(clientId);
          break;
        }
        forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.list', clientId });
        break;
      case 'client.subscribe': {
        const session = latestSessions.get(frame.sessionId);
        const client = clients.get(clientId);
        if (!client) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        if (!session) {
          sendGatewayUnavailable(clientId);
          break;
        }
        if (!clientCanSeeRelaySession(client, session)) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        if (clientScope.tokenClass === 'ws_ticket') {
          if (clientScope.sessionId !== frame.sessionId || clientScope.mode !== frame.mode) {
            sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'wrong_ticket_scope', message: 'ticket scope does not match session or mode' });
            break;
          }
        }
        if (session.transport === 'pty-event-stream' && session.status !== 'running') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: 'session_lost',
            message: 'PTY session is no longer running'
          });
          break;
        }
        subscriptions.set(frame.sessionId, frame.mode);
        forwardToSessionGateway({
          type: 'client.subscribe',
          clientId,
          sessionId: frame.sessionId,
          after: frame.after,
          tail: frame.tail,
          mode: frame.mode,
          cols: frame.cols,
          rows: frame.rows
        });
        break;
      }
      case 'client.input':
        if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        if (subscriptions.get(frame.sessionId) !== 'control') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
            message: subscriptions.has(frame.sessionId) ? 'observer clients cannot send input' : 'client is not subscribed to this session'
          });
          break;
        }
        forwardToSessionGateway({ type: 'client.input', clientId, sessionId: frame.sessionId, data: frame.data });
        break;
      case 'client.resize':
        if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        if (!isValidTerminalSize(frame.cols, frame.rows)) {
          socketClose(clientId, clients, 'invalid resize');
          break;
        }
        if (subscriptions.get(frame.sessionId) !== 'control') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
            message: subscriptions.has(frame.sessionId) ? 'observer clients cannot resize' : 'client is not subscribed to this session'
          });
          break;
        }
        forwardToSessionGateway({ type: 'client.resize', clientId, sessionId: frame.sessionId, cols: frame.cols, rows: frame.rows });
        break;
      case 'client.stop':
        if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId, 'control')) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        if (subscriptions.get(frame.sessionId) !== 'control') {
          sendToClient(clientId, {
            type: 'error',
            sessionId: frame.sessionId,
            code: subscriptions.has(frame.sessionId) ? 'observe_only' : 'not_subscribed',
            message: subscriptions.has(frame.sessionId) ? 'observer clients cannot stop sessions' : 'client is not subscribed to this session'
          });
          break;
        }
        forwardToSessionGateway({ type: 'client.stop', clientId, sessionId: frame.sessionId });
        break;
      case 'client.chat':
        forwardToGateway(ensureClientGatewayId(clientId), frame.sessionId === null
          ? {
              type: 'client.chat',
              clientId,
              sessionId: null,
              provider: frame.provider,
              model: frame.model,
              cwd: frame.cwd,
              message: frame.message,
              accountId: clientScope.accountId,
              workspaceId: clientScope.workspaceId,
              userId: clientScope.userId
            }
          : { type: 'client.chat', clientId, sessionId: frame.sessionId, message: frame.message, model: frame.model });
        break;
      case 'client.list-providers':
        forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.list-providers', clientId });
        break;
      case 'client.cwd-suggest':
        forwardToGateway(ensureClientGatewayId(clientId), { type: 'client.cwd-suggest', clientId, cwd: frame.cwd });
        break;
      case 'client.switch-model':
        forwardToGateway(ensureClientGatewayId(clientId), {
          type: 'client.switch-model',
          clientId,
          sessionId: frame.sessionId,
          provider: frame.provider,
          model: frame.model
        });
        break;
      case 'client.detach':
        if (!clientCanAccessSession(clientScope, authMethod, frame.sessionId)) {
          sendToClient(clientId, { type: 'error', sessionId: frame.sessionId, code: 'forbidden', message: 'session is outside client scope' });
          break;
        }
        subscriptions.delete(frame.sessionId);
        forwardToSessionGateway({ type: 'client.detach', clientId, sessionId: frame.sessionId });
        break;
      case 'client.auth':
        break;
    }
  }

  function forwardToSessionGateway(frame: RelayServerToGatewayFrame): void {
    const sessionId = 'sessionId' in frame ? frame.sessionId : undefined;
    const gatewayId = sessionId ? latestSessions.get(sessionId)?.gatewayId : undefined;
    const gateway = gatewayId ? gateways.get(gatewayId) : firstConnectedGateway();
    if (!gateway || gateway.socket.readyState !== WebSocket.OPEN) {
      const clientId = 'clientId' in frame ? frame.clientId : undefined;
      if (clientId) {
        sendGatewayUnavailable(clientId);
      }
      return;
    }
    sendToSocket<RelayServerToGatewayFrame>(gateway.socket, frame);
  }

  function forwardToGateway(gatewayId: string | undefined, frame: RelayServerToGatewayFrame): void {
    const gateway = gatewayId ? gateways.get(gatewayId) : undefined;
    if (!gateway || gateway.socket.readyState !== WebSocket.OPEN) {
      const clientId = 'clientId' in frame ? frame.clientId : undefined;
      if (clientId) {
        sendGatewayUnavailable(clientId);
      }
      return;
    }
    sendToSocket<RelayServerToGatewayFrame>(gateway.socket, frame);
  }

  function sendGatewayUnavailable(clientId: string): void {
    sendToClient(clientId, { type: 'sessions', sessions: [] });
    sendToClient(clientId, { type: 'error', code: 'gateway_unavailable', message: 'gateway is not connected' });
  }

  function ensureClientGatewayId(clientId: string): string | undefined {
    const client = clients.get(clientId);
    if (!client) {
      return undefined;
    }
    if (client.gatewayId) {
      return client.gatewayId;
    }
    const gatewayId = client.scope?.gatewayId ?? firstConnectedGateway()?.gatewayId;
    client.gatewayId = gatewayId;
    return gatewayId;
  }

  function clientCanSeeRelaySession(client: ClientState, session: RelaySession): boolean {
    if (client.gatewayId && session.gatewayId && session.gatewayId !== client.gatewayId) {
      return false;
    }
    return clientCanSeeSession(client.scope, client.authMethod, session, gatewayForSession(session)?.scope);
  }

  function broadcastGatewayUnavailable(): void {
    for (const client of clients.values()) {
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'sessions', sessions: [] });
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'error', code: 'gateway_unavailable', message: 'gateway is not connected' });
    }
  }

  function sendReplay(clientId: string, sessionId: string, events: RelayTerminalEvent[], done: boolean, latestEventId?: number): void {
    const client = clients.get(clientId);
    if (!client || !client.subscriptions.has(sessionId) || !clientCanAccessSession(client.scope, client.authMethod, sessionId)) {
      return;
    }
    const output = events
      .map((event) => event.type === 'terminal.output' && typeof event.payload.data === 'string' ? event.payload.data : '')
      .join('');
    const pageLatestEventId = latestEventId ?? events.at(-1)?.id ?? 0;
    if (output.length > 0) {
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'replay.output', sessionId, data: output, latestEventId: pageLatestEventId });
    }
    for (const event of events) {
      if (event.type === 'terminal.output' || event.type === 'user.input' || event.type === 'terminal.resize' || event.type === 'client.attached') {
        continue;
      }
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'event', event });
    }
    if (done) {
      sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'replay.done', sessionId, latestEventId: pageLatestEventId });
    }
  }

  function sendEventToSubscribers(event: RelayTerminalEvent): void {
    for (const client of clients.values()) {
      if (client.subscriptions.has(event.sessionId) && clientCanAccessSession(client.scope, client.authMethod, event.sessionId)) {
        sendToSocket<RelayServerToClientFrame>(client.socket, { type: 'event', event });
      }
    }
  }

  function clientCanAccessSession(
    clientScope: RelayAuthScope | undefined,
    authMethod: RelayAuthMethod,
    sessionId: string,
    requiredTicketMode?: RelayClientMode
  ): boolean {
    const session = latestSessions.get(sessionId);
    if (!session || !clientCanSeeSession(clientScope, authMethod, session, gatewayForSession(session)?.scope)) {
      return false;
    }
    if (clientScope?.tokenClass === 'ws_ticket') {
      if (clientScope.sessionId !== sessionId) {
        return false;
      }
      if (requiredTicketMode && clientScope.mode !== requiredTicketMode) {
        return false;
      }
    }
    return true;
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

  function gatewayForSession(session: RelaySession): GatewayState | undefined {
    return session.gatewayId ? gateways.get(session.gatewayId) : firstConnectedGateway();
  }

  function firstConnectedGateway(): GatewayState | undefined {
    for (const gateway of gateways.values()) {
      if (gateway.socket.readyState === WebSocket.OPEN) {
        return gateway;
      }
    }
    return undefined;
  }

  function hasConnectedGateway(): boolean {
    return firstConnectedGateway() !== undefined;
  }
}

async function authenticateGatewayFrame(
  frame: Extract<RelayGatewayToServerFrame, { type: 'gateway.auth' }>,
  options: RelayServerOptions
): Promise<{ ok: true; scope: RelayAuthScope; authMethod: RelayAuthMethod } | { ok: false; code: string; message: string }> {
  if (frame.token && options.validateToken) {
    const scope = await options.validateToken(frame.token);
    if (!scope) {
      return { ok: false, code: 'invalid_token', message: 'gateway token is invalid' };
    }
    if (scope.tokenClass !== 'gateway_access') {
      return { ok: false, code: 'wrong_token_class', message: 'gateway token must be gateway_access' };
    }
    if (scope.gatewayId && scope.gatewayId !== frame.gatewayId) {
      return { ok: false, code: 'wrong_gateway', message: 'gateway token does not match gateway id' };
    }
    return { ok: true, scope, authMethod: 'token' };
  }
  if (options.allowLegacySecret === true && frame.secret === options.secret && frame.scope) {
    return { ok: true, scope: frame.scope, authMethod: 'legacy-secret' };
  }
  return { ok: false, code: 'authentication_failed', message: 'gateway authentication failed' };
}

async function authenticateClientFrame(
  frame: Extract<RelayClientToServerFrame, { type: 'client.auth' }>,
  options: RelayServerOptions
): Promise<{ ok: true; scope: RelayAuthScope; authMethod: RelayAuthMethod } | { ok: false; code: string; message: string }> {
  const token = frame.ticket ?? frame.token;
  if (token && options.validateToken) {
    const scope = await options.validateToken(token);
    if (!scope) {
      return { ok: false, code: 'invalid_token', message: 'client token is invalid' };
    }
    if (scope.tokenClass !== 'normal_client_access' && scope.tokenClass !== 'ws_ticket') {
      return { ok: false, code: 'wrong_token_class', message: 'client token must be normal_client_access or ws_ticket' };
    }
    return { ok: true, scope, authMethod: 'token' };
  }
  if (options.allowLegacySecret === true && frame.secret === options.secret && frame.scope) {
    return { ok: true, scope: frame.scope, authMethod: 'legacy-secret' };
  }
  return { ok: false, code: 'authentication_failed', message: 'client authentication failed' };
}

function gatewayFrameWithinScope(frame: RelayGatewayToServerFrame, gatewayScope: RelayAuthScope): boolean {
  // 兼容旧 token：历史上 `gatewayId` 可能缺失（例如早期发的 gateway_access token）。
  // 在这种情况下不应强制做 gatewayId 绑定校验，否则会导致 Relay 收到 `gateway.sessions`
  // 直接判定 out-of-scope 并关闭网关连接，进而让 Web 端会话列表一会儿有一会儿没有。
  const scopedGatewayId = gatewayScope.gatewayId;
  switch (frame.type) {
    case 'gateway.sessions':
      return scopedGatewayId
        ? frame.sessions.every((session) => session.gatewayId === undefined || session.gatewayId === scopedGatewayId)
        : true;
    case 'gateway.replay':
      return gatewayScope.sessionId ? gatewayScope.sessionId === frame.sessionId : true;
    case 'gateway.event':
      return gatewayScope.sessionId ? gatewayScope.sessionId === frame.event.sessionId : true;
    case 'gateway.error':
      return gatewayScope.sessionId ? gatewayScope.sessionId === frame.sessionId : true;
    case 'gateway.session-created':
    case 'gateway.chat-catchup':
    case 'gateway.auth':
      return true;
  }
}

function clientCanSeeSession(clientScope: RelayAuthScope | undefined, authMethod: RelayAuthMethod, session: RelaySession, gatewayScope?: RelayAuthScope): boolean {
  if (!clientScope) {
    return false;
  }
  if (authMethod === 'token' && (!session.accountId || !session.workspaceId || !session.gatewayId)) {
    return false;
  }
  if (session.accountId && session.accountId !== clientScope.accountId) {
    return false;
  }
  if (session.workspaceId && session.workspaceId !== clientScope.workspaceId) {
    return false;
  }
  if (session.gatewayId && clientScope.gatewayId && session.gatewayId !== clientScope.gatewayId) {
    return false;
  }
  if (session.userId && clientScope.userId && session.userId !== clientScope.userId) {
    return false;
  }
  if (clientScope.tokenClass === 'ws_ticket') {
    if (clientScope.sessionId && session.id !== clientScope.sessionId) {
      return false;
    }
    if (session.gatewayId && gatewayScope?.gatewayId && session.gatewayId !== gatewayScope.gatewayId) {
      return false;
    }
  }
  return true;
}

function socketClose(clientId: string, clients: Map<string, ClientState>, reason: string): void {
  clients.get(clientId)?.socket.close(POLICY_VIOLATION, reason);
}

function parseFrame(data: WebSocket.RawData): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenKey);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || hasForbiddenKey(nested)) {
      return true;
    }
  }
  return false;
}

function isGatewayFrame(frame: Record<string, unknown>, gatewayId: string): frame is RelayGatewayToServerFrame {
  return typeof frame.type === 'string' && frame.gatewayId === gatewayId;
}

function isClientFrame(frame: Record<string, unknown>): frame is RelayClientToServerFrame {
  if (typeof frame.type !== 'string') {
    return false;
  }
  if (frame.type === 'client.resize') {
    return isValidTerminalSize(frame.cols, frame.rows);
  }
  return true;
}

function isValidTerminalSize(cols: unknown, rows: unknown): cols is number {
  return Number.isInteger(cols) && Number.isInteger(rows) && Number(cols) > 0 && Number(rows) > 0 && Number(cols) <= MAX_TERMINAL_COLS && Number(rows) <= MAX_TERMINAL_ROWS;
}

function sendToSocket<T>(socket: WebSocket, frame: T): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

function closeRelay(wss: WebSocketServer, server: HttpServer): Promise<void> {
  for (const client of wss.clients) {
    client.close();
  }
  return new Promise<void>((resolve, reject) => {
    wss.close((wsError) => {
      if (wsError) {
        reject(wsError);
        return;
      }
      server.close((serverError) => {
        if (serverError) {
          reject(serverError);
          return;
        }
        resolve();
      });
    });
  });
}
