import WebSocket from 'ws';
import type {
  RelayGatewayToServerFrame,
  RelayServerToGatewayFrame,
  RelaySession,
  RelayTerminalEvent
} from '@tether/protocol';
import type { PtySessionManager } from './pty.js';
import type { Session, SessionEvent, Store } from './store.js';

export type RelayClientOptions = {
  url: string;
  secret: string;
  gatewayId: string;
  store: Store;
  ptySessions?: PtySessionManager;
};

export type RunningRelayClient = {
  close: () => Promise<void>;
};

type RelaySubscription = {
  mode: 'control' | 'observe';
  unsubscribe?: () => void;
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

  const connect = () => {
    if (closed) {
      return;
    }

    socket = new WebSocket(relayGatewayUrl(options.url));

    socket.on('open', () => {
      reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      send({ type: 'gateway.auth', gatewayId: options.gatewayId, secret: options.secret });
      sendSessions();
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
      gatewayId: options.gatewayId,
      sessions: options.store.listSessions().map(toRelaySession)
    });
  };

  const handleFrame = (frame: RelayServerToGatewayFrame) => {
    switch (frame.type) {
      case 'gateway.auth.ok':
        return;
      case 'gateway.auth.failed':
        socket?.close();
        return;
      case 'client.list':
        sendSessions();
        return;
      case 'client.subscribe':
        subscribeClient(frame.clientId, frame.sessionId, frame.after ?? 0, frame.mode);
        return;
      case 'client.input':
        writeInput(frame.clientId, frame.sessionId, frame.data);
        return;
      case 'client.resize':
        resizePty(frame.clientId, frame.sessionId, frame.cols, frame.rows);
        return;
      case 'client.detach':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
    }
  };

  const subscribeClient = (clientId: string, sessionId: string, after: number, mode: 'control' | 'observe') => {
    removeSubscription(clientId, sessionId);
    const session = options.store.getSession(sessionId);
    if (!session) {
      sendError(clientId, sessionId, 'session_not_found', 'session not found');
      return;
    }

    const events = options.store.listEvents(sessionId, after, 5000).map(toRelayEvent);
    send({ type: 'gateway.replay', gatewayId: options.gatewayId, clientId, sessionId, events });

    const key = subscriptionKey(clientId, sessionId);
    const unsubscribe = options.ptySessions?.subscribe(sessionId, (event) => {
      send({ type: 'gateway.event', gatewayId: options.gatewayId, event: toRelayEvent(event) });
    });
    subscriptions.set(key, { mode, unsubscribe });
  };

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

  const resizePty = (clientId: string, sessionId: string, cols: number, rows: number) => {
    const subscription = subscriptions.get(subscriptionKey(clientId, sessionId));
    if (!subscription) {
      sendError(clientId, sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    if (subscription.mode !== 'control') {
      sendError(clientId, sessionId, 'observe_only', 'observer clients cannot resize');
      return;
    }
    const ok = options.ptySessions?.resize(sessionId, clientId, cols, rows) ?? false;
    if (!ok) {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  };

  const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
    send({ type: 'gateway.error', gatewayId: options.gatewayId, clientId, sessionId, code, message });
  };

  const removeSubscription = (clientId: string, sessionId: string) => {
    const key = subscriptionKey(clientId, sessionId);
    const subscription = subscriptions.get(key);
    subscription?.unsubscribe?.();
    subscriptions.delete(key);
  };

  const clearSubscriptions = () => {
    for (const subscription of subscriptions.values()) {
      subscription.unsubscribe?.();
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
    }
  };
}

function relayGatewayUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/gateway`;
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
