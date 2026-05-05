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
import { handleChatMessage } from './chat-handler.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { replaySessionEvents } from './replay.js';
import type { SessionRunnerClient } from './session-runner-client.js';
import type { Session, SessionEvent, Store } from './store.js';

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

  const sendSessions = () => {
    send({
      type: 'gateway.sessions',
      gatewayId: effectiveGatewayId,
      sessions: options.store.listSessions().map(toRelaySession)
    });
  };

  const handleFrame = (frame: RelayServerToGatewayFrame) => {
    switch (frame.type) {
      case 'gateway.auth.ok':
        setConnectionState('connected');
        sendSessions();
        return;
      case 'gateway.auth.failed':
        setConnectionState('auth_failed');
        socket?.close();
        return;
      case 'client.list':
        sendSessions();
        return;
      case 'client.subscribe':
        void subscribeClient(frame.clientId, frame.sessionId, frame.after ?? 0, frame.mode, frame.tail, frame.cols, frame.rows);
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
        void handleChatMessage(frame.sessionId, frame.message, options.store, runnerClient)
          .then((event) => {
            send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
          })
          .catch(() => {
            // PTY may have exited; suppress
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
    }
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

    const replayCursor = replayEvents(clientId, sessionId, after, tail);

    const runnerClient = options.runnerClientForSession?.(session);
    let unsubscribe: (() => void | Promise<void>) | undefined;
    if (runnerClient) {
      try {
        unsubscribe = await runnerClient.subscribeEvents((frame) => {
          const event = options.store.listEvents(frame.sessionId, frame.eventId - 1, 1)[0];
          if (event) {
            send({ type: 'gateway.event', gatewayId: effectiveGatewayId, event: toRelayEvent(event) });
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
      });
    }
    subscriptions.set(key, { mode, unsubscribe });
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
