import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type {
  RelayAuthScope,
  RelayGatewayToServerFrame,
  RelayServerToGatewayFrame,
  RelaySession,
  RelayTerminalEvent
} from '@tether/protocol';
import { detectSelectOptions } from './agent-select-detect.js';
import { handleChatMessage } from './chat-handler.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { replaySessionEvents } from './replay.js';
import type { SessionRunnerClient } from './session-runner-client.js';
import type { AgentTurn, Session, SessionEvent, Store } from './store.js';

export type RelayClientOptions = {
  url: string;
  secret: string;
  gatewayId: string;
  token?: string;
  scope?: RelayAuthScope;
  store: Store;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
};

export type RunningRelayClient = {
  close: () => Promise<void>;
  status: () => RelayConnectionStatus;
};

export type RelayConnectionStatus = {
  configured: true;
  state: 'connecting' | 'connected' | 'disconnected' | 'auth_failed';
  url: string;
  lastChangedAt: number;
};

type RelaySubscription = {
  mode: 'control' | 'observe';
  unsubscribe?: () => void | Promise<void>;
};

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;
const RELAY_FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'providerCommand']);

export function startRelayClient(options: RelayClientOptions): RunningRelayClient {
  let closed = false;
  let socket: WebSocket | undefined;
  let reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
  let reconnectTimer: NodeJS.Timeout | undefined;
  const subscriptions = new Map<string, RelaySubscription>();
  let connectionState: RelayConnectionStatus['state'] = 'connecting';
  let lastChangedAt = Date.now();
  let effectiveGatewayId = options.gatewayId;

  const setConnectionState = (state: RelayConnectionStatus['state']) => {
    if (connectionState === state) {
      return;
    }
    connectionState = state;
    lastChangedAt = Date.now();
  };

  const connect = () => {
    if (closed) {
      return;
    }

    setConnectionState('connecting');
    socket = new WebSocket(relayGatewayUrl(options.url));

    socket.on('open', () => {
      void (async () => {
        const auth = await resolveRelayAuth(options);
        if (!auth) {
          console.error('Relay auth failed: missing ~/.tether/auth.json or invalid gateway token. Run: tether gateway login');
          setConnectionState('auth_failed');
          socket?.close();
          return;
        }
        effectiveGatewayId = auth.gatewayId;
        reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
        send({ type: 'gateway.auth', gatewayId: auth.gatewayId, token: auth.token, scope: auth.scope, secret: options.secret });
      })();
    });

    socket.on('message', (data) => {
      const frame = parseFrame(data);
      if (!frame) {
        return;
      }
      handleFrame(frame);
    });

    socket.on('close', () => {
      socket = undefined;
      clearSubscriptions();
      if (connectionState !== 'auth_failed') {
        setConnectionState('disconnected');
      }
      scheduleReconnect();
    });

    socket.on('error', () => {
      socket?.close();
    });
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) {
      return;
    }
    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
    reconnectTimer.unref();
  };

  const send = (frame: RelayGatewayToServerFrame) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const sendSessions = async () => {
    send({
      type: 'gateway.sessions',
      gatewayId: effectiveGatewayId,
      sessions: (await listRelaySessions()).map(toRelaySession)
    });
  };

  const handleFrame = (frame: RelayServerToGatewayFrame) => {
    switch (frame.type) {
      case 'gateway.auth.ok':
        setConnectionState('connected');
        void sendSessions();
        return;
      case 'gateway.auth.failed':
        setConnectionState('auth_failed');
        socket?.close();
        return;
      case 'client.list':
        void sendSessions();
        return;
      case 'client.subscribe':
        void subscribeClient(frame.clientId, frame.sessionId, frame.after ?? 0, frame.mode, frame.tail, frame.cols, frame.rows);
        return;
      case 'client.conversation':
        sendConversation(frame.clientId, frame.sessionId);
        return;
      case 'client.input':
        void writeInput(frame.clientId, frame.sessionId, frame.data);
        return;
      case 'client.chat': {
        const session = options.store.getSession(frame.sessionId);
        if (!session) {
          return;
        }
        const runnerClient = options.runnerClientForSession?.(session);
        void handleChatMessage(frame.sessionId, frame.message, options.store, runnerClient, (data, clientId) => {
          const ok = options.ptySessions?.write(frame.sessionId, { clientId, data }) ?? false;
          if (!ok) {
            throw new Error('PTY session is no longer running');
          }
        })
          .then((events) => {
            for (const event of events) {
              send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
            }
          })
          .catch(() => {
            sendError(frame.clientId, frame.sessionId, 'session_lost', 'PTY session is no longer running');
          });
        return;
      }
      case 'client.resize':
        void resizePty(frame.clientId, frame.sessionId, frame.cols, frame.rows);
        return;
      case 'client.stop':
        void stopPty(frame.clientId, frame.sessionId);
        return;
      case 'client.detach':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
      case 'gateway.http.request':
        void handleHttpRequest(frame);
        return;
    }
  };

  const listRelaySessions = async (): Promise<Session[]> => {
    const sessions = options.store.listSessions();
    const result: Session[] = [];
    for (const session of sessions) {
      if (session.status !== 'running' || session.transport !== 'pty-event-stream') {
        result.push(session);
        continue;
      }
      const alive = await isLiveSession(session);
      if (alive) {
        result.push(session);
        continue;
      }
      markSessionLost(session.id);
      const updated = options.store.getSession(session.id);
      result.push(updated ?? { ...session, status: 'lost' });
    }
    return result;
  };

  const isLiveSession = async (session: Session): Promise<boolean> => {
    const runnerClient = options.runnerClientForSession?.(session);
    if (runnerClient) {
      try {
        const pong = await runnerClient.ping();
        return pong?.sessionId === session.id;
      } catch {
        return false;
      }
    }
    return options.ptySessions?.hasLiveSession(session.id) ?? false;
  };

  const subscribeClient = async (
    clientId: string,
    sessionId: string,
    after: number,
    mode: 'control' | 'observe',
    tail?: number,
    cols?: number,
    rows?: number
  ) => {
    const session = options.store.getSession(sessionId);
    if (!session) {
      sendError(clientId, sessionId, 'session_not_found', 'session not found');
      return;
    }
    const key = subscriptionKey(clientId, sessionId);
    const previousSubscription = subscriptions.get(key);
    if (previousSubscription) {
      await previousSubscription.unsubscribe?.();
      subscriptions.delete(key);
    }
    subscriptions.set(key, { mode });
    if (isValidTerminalSize(cols, rows) && mode === 'control') {
      const nextCols = cols;
      const nextRows = Number(rows);
      const runnerClient = options.runnerClientForSession?.(session);
      if (runnerClient) {
        const resized = await runnerClient.resize(nextCols, nextRows, clientId).then(
          () => true,
          () => {
            markSessionLost(sessionId);
            return false;
          }
        );
        if (!resized) {
          subscriptions.delete(key);
          sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
          return;
        }
      } else {
        const ok = options.ptySessions?.resize(sessionId, clientId, nextCols, nextRows) ?? false;
        if (!ok) {
          markSessionLost(sessionId);
          subscriptions.delete(key);
          sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
          return;
        }
      }
    }

    // agent.select detection state (per relay subscription)
    let relayRecentOutputBuf = '';
    let relaySelectEmitted = false;
    let relaySelectDebounceTimer: NodeJS.Timeout | undefined;
    const detectAndEmitRelaySelect = (event: SessionEvent) => {
      if (
        event.type !== 'terminal.output' ||
        (session.provider !== 'claude' && session.provider !== 'claude-proxy')
      ) {
        return;
      }
      if (relaySelectEmitted) {
        relaySelectEmitted = false;
      }
      const data = (event.payload as { data?: string }).data ?? '';
      relayRecentOutputBuf += data.replace(/\x1b\[[0-9;]*m/g, '');
      const bufLines = relayRecentOutputBuf.split('\n');
      if (bufLines.length > 50) {
        relayRecentOutputBuf = bufLines.slice(-50).join('\n');
      }
      clearTimeout(relaySelectDebounceTimer);
      relaySelectDebounceTimer = setTimeout(() => {
        if (relaySelectEmitted) {
          return;
        }
        const lines = relayRecentOutputBuf.split('\n');
        const matchedOptions = detectSelectOptions(lines);
        if (!matchedOptions) {
          return;
        }
        const subSession = options.store.getSession(session.id);
        if (!subSession) {
          return;
        }
        const raw = lines.filter((line) => /^\s*\d+\.\s+/.test(line)).join('\n');
        const selectEvent = options.store.appendEvent(subSession.id, 'agent.select', {
          options: matchedOptions,
          raw
        });
        send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(selectEvent) });
        relaySelectEmitted = true;
      }, 300);
    };

    const replayCursor = replayEvents(clientId, sessionId, after, tail);

    const runnerClient = options.runnerClientForSession?.(session);
    let unsubscribe: (() => void | Promise<void>) | undefined;
    if (runnerClient) {
      try {
        unsubscribe = await runnerClient.subscribeEvents((frame) => {
          const event = options.store.listEvents(frame.sessionId, frame.eventId - 1, 1)[0];
          if (event) {
            send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
            detectAndEmitRelaySelect(event);
          }
        }, replayCursor);
      } catch {
        markSessionLost(sessionId);
        subscriptions.delete(key);
        sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
        return;
      }
    } else {
      unsubscribe = options.ptySessions?.subscribe(sessionId, (event) => {
        send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
        detectAndEmitRelaySelect(event);
      });
    }
    const wrappedUnsubscribe = async () => {
      clearTimeout(relaySelectDebounceTimer);
      await unsubscribe?.();
    };
    subscriptions.set(key, { mode, unsubscribe: wrappedUnsubscribe });
  };

  const markSessionLost = (sessionId: string): void => {
    const session = options.store.getSession(sessionId);
    if (session?.status === 'running') {
      options.store.updateSessionStatus(sessionId, 'lost');
      options.store.appendEvent(sessionId, 'session.error', {
        code: 'session_lost',
        message: 'Gateway relay client lost the session runner'
      });
    }
  };

  const replayEvents = (clientId: string, sessionId: string, after: number, tail?: number): number => {
    return replaySessionEvents({
      store: options.store,
      sessionId,
      after,
      tail,
      sendPage: ({ events, done, latestEventId }) => {
        send({
          type: 'gateway.replay',
          gatewayId: effectiveGatewayId,
          clientId,
          sessionId,
          events: events.map(toRelayEvent),
          done,
          latestEventId
        });
      }
    });
  };

  const sendConversation = (clientId: string, sessionId: string): void => {
    const session = options.store.getSession(sessionId);
    if (!session) {
      sendError(clientId, sessionId, 'not_found', 'session not found');
      return;
    }
    send({
      type: 'gateway.conversation',
      gatewayId: effectiveGatewayId,
      clientId,
      sessionId,
      turns: options.store.listAgentTurns(sessionId).map((turn) => ({
        id: turn.id,
        sessionId: turn.sessionId,
        turnIndex: turn.turnIndex,
        role: turn.role,
        content: turn.content,
        tools: turn.tools,
        createdAt: turn.createdAt
      }))
    });
  };

  const writeInput = async (clientId: string, sessionId: string, data: string) => {
    const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
    if (!subscription) {
      sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    if (subscription.mode !== 'control') {
      sendError(clientId, sessionId, 'observe_only', 'observer clients cannot send input');
      return;
    }
    const session = options.store.getSession(sessionId);
    const runnerClient = session ? options.runnerClientForSession?.(session) : undefined;
    if (runnerClient) {
      await runnerClient.write(data, clientId).catch(() => {
        sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
      });
      return;
    }
    const ok = options.ptySessions?.write(sessionId, { clientId, data }) ?? false;
    if (!ok) {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  };

  const resizePty = async (clientId: string, sessionId: string, cols: number, rows: number) => {
    const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
    if (!subscription) {
      sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    if (subscription.mode !== 'control') {
      sendError(clientId, sessionId, 'observe_only', 'observer clients cannot resize');
      return;
    }
    if (!isValidTerminalSize(cols, rows)) {
      sendError(clientId, sessionId, 'bad_resize', 'resize requires positive terminal dimensions');
      return;
    }
    const session = options.store.getSession(sessionId);
    const runnerClient = session ? options.runnerClientForSession?.(session) : undefined;
    if (runnerClient) {
      await runnerClient.resize(cols, rows, clientId).catch(() => {
        sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
      });
      return;
    }
    const ok = options.ptySessions?.resize(sessionId, clientId, cols, rows) ?? false;
    if (!ok) {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  };

  const stopPty = async (clientId: string, sessionId: string) => {
    const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
    if (!subscription) {
      sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    if (subscription.mode !== 'control') {
      sendError(clientId, sessionId, 'observe_only', 'observer clients cannot stop sessions');
      return;
    }
    const session = options.store.getSession(sessionId);
    const runnerClient = session ? options.runnerClientForSession?.(session) : undefined;
    if (runnerClient) {
      await runnerClient.stop('relay-stop').catch(() => {
        options.store.updateSessionStatus(sessionId, 'lost');
        sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
      });
      return;
    }
    const ok = options.ptySessions?.stop(sessionId) ?? false;
    if (!ok) {
      options.store.updateSessionStatus(sessionId, 'lost');
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  };

  const handleHttpRequest = async (frame: Extract<RelayServerToGatewayFrame, { type: 'gateway.http.request' }>) => {
    const respond = (status: number, body: unknown) => {
      send({ type: 'gateway.http.response', gatewayId: effectiveGatewayId, requestId: frame.requestId, status, body });
    };
    try {
      if (frame.method === 'GET' && frame.path === '/api/sessions') {
        respond(200, { sessions: (await listRelaySessions()).map(toRelaySession) });
        return;
      }
      const sessionId = frame.sessionId;
      if (!sessionId) {
        respond(400, { error: 'sessionId is required' });
        return;
      }
      const session = options.store.getSession(sessionId);
      if (!session) {
        respond(404, { error: 'session not found' });
        return;
      }
      if (frame.method === 'GET' && frame.path === '/api/sessions/:id/conversation') {
        respond(200, {
          turns: options.store.listAgentTurns(sessionId).map((turn) => ({
            id: turn.id,
            sessionId: turn.sessionId,
            turnIndex: turn.turnIndex,
            role: turn.role,
            content: turn.content,
            tools: turn.tools,
            createdAt: turn.createdAt
          }))
        });
        return;
      }
      if (frame.method === 'GET' && frame.path === '/api/sessions/:id/events') {
        const after = Number.parseInt(frame.query?.after ?? '0', 10);
        const limit = Number.parseInt(frame.query?.limit ?? '1000', 10);
        respond(200, {
          events: options.store
            .listEvents(sessionId, Number.isFinite(after) ? after : 0, Number.isFinite(limit) ? limit : 1000)
            .map(toRelayEvent)
        });
        return;
      }
      if (frame.method === 'POST' && frame.path === '/api/sessions/:id/input') {
        const data = typeof (frame.body as { data?: unknown } | undefined)?.data === 'string'
          ? (frame.body as { data: string }).data
          : '';
        if (!data) {
          respond(400, { error: 'data is required' });
          return;
        }
        const runnerClient = options.runnerClientForSession?.(session);
        if (runnerClient) {
          await runnerClient.write(data, frame.clientId);
          respond(200, { ok: true });
          return;
        }
        const ok = options.ptySessions?.write(sessionId, { clientId: frame.clientId, data }) ?? false;
        respond(ok ? 200 : 410, ok ? { ok: true } : { error: 'pty session is no longer running' });
        return;
      }
      if (frame.method === 'POST' && frame.path === '/api/sessions/:id/stop') {
        const runnerClient = options.runnerClientForSession?.(session);
        if (runnerClient) {
          await runnerClient.stop('relay-http-stop');
          respond(200, { ok: true });
          return;
        }
        const ok = options.ptySessions?.stop(sessionId) ?? false;
        if (!ok) {
          options.store.updateSessionStatus(sessionId, 'lost');
        }
        respond(ok ? 200 : 410, ok ? { ok: true } : { error: 'pty session is no longer running' });
        return;
      }
      respond(404, { error: 'not found' });
    } catch (error) {
      respond(500, { error: error instanceof Error ? error.message : 'gateway error' });
    }
  };

  const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
    send({ type: 'gateway.error', gatewayId: effectiveGatewayId, clientId, sessionId, code, message });
  };

  const removeSubscription = async (clientId: string, sessionId: string) => {
    const key = subscriptionKey(clientId, sessionId);
    const subscription = subscriptions.get(key);
    await subscription?.unsubscribe?.();
    subscriptions.delete(key);
  };

  const clearSubscriptions = () => {
    for (const subscription of subscriptions.values()) {
      void subscription.unsubscribe?.();
    }
    subscriptions.clear();
  };

  connect();

  return {
    close: async () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      clearSubscriptions();
      const closingSocket = socket;
      socket = undefined;
      if (!closingSocket || closingSocket.readyState === WebSocket.CLOSED) {
        return;
      }
      await new Promise<void>((resolve) => {
        closingSocket.once('close', () => resolve());
        closingSocket.close();
      });
    },
    status: () => ({
      configured: true,
      state: connectionState,
      url: options.url,
      lastChangedAt
    })
  };
}

export function relayGatewayUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  } else if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('relay URL must use ws, wss, http, or https');
  }
  const normalizedPath = parsed.pathname.replace(/\/$/, '');
  parsed.pathname = normalizedPath.endsWith('/gateway') ? normalizedPath : `${normalizedPath}/gateway`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function parseFrame(data: WebSocket.RawData): RelayServerToGatewayFrame | undefined {
  try {
    const parsed = JSON.parse(data.toString()) as RelayServerToGatewayFrame;
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function subscriptionKey(clientId: string, sessionId: string): string {
  return `${clientId}:${sessionId}`;
}

function toRelaySession(session: Session): RelaySession {
  return {
    id: session.id,
    provider: session.provider,
    title: session.title,
    projectPath: session.projectPath,
    accountId: session.accountId,
    workspaceId: session.workspaceId,
    gatewayId: session.gatewayId,
    userId: session.userId,
    agentSessionId: session.agentSessionId,
    status: session.status,
    transport: session.transport,
    lastActiveAt: session.lastActiveAt
  };
}

function toRelayEvent(event: SessionEvent): RelayTerminalEvent {
  return {
    id: event.id,
    sessionId: event.sessionId,
    type: event.type,
    ts: event.ts,
    payload: sanitizeRelayPayload(event.payload)
  };
}

function sanitizeRelayPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RELAY_FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeRelayValue(value);
  }
  return sanitized;
}

function sanitizeRelayValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRelayValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return sanitizeRelayPayload(value as Record<string, unknown>);
}

async function resolveRelayAuth(
  options: RelayClientOptions
): Promise<{ gatewayId: string; token?: string; scope: RelayAuthScope } | undefined> {
  if (options.token && options.scope) {
    return {
      gatewayId: options.scope.gatewayId ?? options.gatewayId,
      token: options.token,
      scope: options.scope
    };
  }

  const raw = await readFile(process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json'), 'utf8').catch(() => undefined);
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as {
    gatewayId?: unknown;
    accountId?: unknown;
    workspaceId?: unknown;
    accessToken?: unknown;
    expiresAt?: unknown;
  };
  if (
    typeof parsed.gatewayId !== 'string' ||
    typeof parsed.accountId !== 'string' ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return undefined;
  }
  if (parsed.expiresAt <= Date.now()) {
    return undefined;
  }
  return {
    gatewayId: parsed.gatewayId,
    token: parsed.accessToken,
    scope: {
      accountId: parsed.accountId,
      workspaceId: parsed.workspaceId,
      gatewayId: parsed.gatewayId,
      tokenClass: 'gateway_access',
      expiresAt: parsed.expiresAt,
      jti: 'relay-auth-local'
    }
  };
}
