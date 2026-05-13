import WebSocket from 'ws';
import type {
  RelayAuthScope,
  RelayGatewayToServerFrame,
  RelayServerToGatewayFrame,
  RelayTerminalEvent
} from '@tether/protocol';
import { ChatSessionRegistry } from './chat/chat-session-registry.js';
import { ChatRuntime } from './chat/chat-runtime.js';
import { logger } from './utils/logger.js';
import type { PtySessionManager } from './pty/manager.js';
import { ChatHandler } from './relay/chat-handler.js';
import { FrameRouter } from './relay/frame-router.js';
import { PtyHandler, type NewPtySessionHandler } from './relay/pty-handler.js';
import { RelaySender } from './relay/relay-sender.js';
import { SessionCatalog, toRelaySession } from './relay/session-catalog.js';
import { SubscriptionHandler, SubscriptionManager } from './relay/subscription-manager.js';
import type { SessionRunnerClient } from './pty/session-runner-client.js';
import type { Session, SessionEvent } from './types.js';
import { decodeGatewayToken, loadGatewayAuthState } from './utils/gateway-auth.js';
import { resolvePackageVersion } from './utils/package-version.js';

const TETHER_VERSION = resolvePackageVersion(import.meta.url, ['@tether-labs/cli', '@tether/gateway']) ?? '0.0.0-dev';

export type RelayClientOptions = {
  url: string;
  secret: string;
  gatewayId: string;
  token?: string;
  scope?: RelayAuthScope;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
  onNewPtySession?: NewPtySessionHandler;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  ptyHealthCheckIntervalMs?: number;
};

export type RunningRelayClient = {
  close: () => Promise<void>;
  syncSessions: () => Promise<void>;
  status: () => RelayConnectionStatus;
};

export type RelayConnectionStatus = {
  configured: true;
  state: 'connecting' | 'connected' | 'disconnected' | 'auth_failed';
  url: string;
  lastChangedAt: number;
};

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;
const RELAY_HEARTBEAT_INTERVAL_MS = 15_000;
const RELAY_HEARTBEAT_TIMEOUT_MS = 10_000;
const PTY_HEALTH_CHECK_INTERVAL_MS = 30_000;
const RELAY_FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'providerArgs', 'providerCommand']);
export function startRelayClient(options: RelayClientOptions): RunningRelayClient {
  let closed = false;
  let socket: WebSocket | undefined;
  let reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let heartbeatInterval: NodeJS.Timeout | undefined;
  let heartbeatTimeout: NodeJS.Timeout | undefined;
  let ptyHealthTimer: NodeJS.Timeout | undefined;
  let ptyHealthCheckRunning = false;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? RELAY_HEARTBEAT_TIMEOUT_MS;
  const ptyHealthCheckIntervalMs = options.ptyHealthCheckIntervalMs ?? PTY_HEALTH_CHECK_INTERVAL_MS;
  const subscriptions = new SubscriptionManager();
  const chatRegistry = new ChatSessionRegistry();
  let connectionState: RelayConnectionStatus['state'] = 'connecting';
  let lastChangedAt = Date.now();
  let effectiveGatewayId = options.gatewayId;
  const send = (frame: RelayGatewayToServerFrame) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };
  let sendSessions: () => Promise<void> = async () => undefined;
  const relaySender = new RelaySender((frame) => send(frame), () => effectiveGatewayId);
  const sessionCatalog = new SessionCatalog({
    chatRegistry,
    ptySessions: options.ptySessions,
    runnerClientForSession: options.runnerClientForSession,
    emitEvent: (event) => relaySender.event(toRelayEvent(event)),
    isPidAlive,
    onSessionsChanged: () => {
      void sendSessions();
    }
  });
  const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
    relaySender.error(clientId, sessionId, code, message);
  };
  const deferLostError = (clientId: string, sessionId: string) => {
    setTimeout(() => {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }, 0);
  };
  const ptyHandler = new PtyHandler({
    relaySender,
    sessionCatalog,
    subscriptions,
    ptySessions: options.ptySessions,
    runnerClientForSession: options.runnerClientForSession,
    onNewPtySession: options.onNewPtySession,
    sendSessions: () => sendSessions(),
    sendError
  });
  const chatRuntime = new ChatRuntime({
    gatewayId: () => effectiveGatewayId,
    chatRegistry,
    relaySender,
    sendSessions: () => sendSessions()
  });

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
    logger.info('relay', 'connecting', { url: options.url });
    socket = new WebSocket(relayGatewayUrl(options.url));

    socket.on('open', () => {
      startHeartbeat(socket);
      void (async () => {
        const authResult = await resolveRelayAuth(options);
        if (!authResult.ok) {
          if (authResult.permanent) {
            logger.error('relay', 'auth failed, run: tether login', { reason: authResult.message, permanent: true });
            closed = true;
          } else {
            logger.warn('relay', 'auth failed, will retry', { reason: authResult.message });
          }
          setConnectionState('auth_failed');
          socket?.close();
          return;
        }
        effectiveGatewayId = authResult.gatewayId;
        reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
        send({ type: 'gateway.auth', gatewayId: authResult.gatewayId, token: authResult.token, scope: authResult.scope, secret: options.secret, version: TETHER_VERSION });
      })();
    });

    socket.on('message', (data) => {
      const frame = parseFrame(data);
      if (!frame) {
        return;
      }
      frameRouter.route(frame);
    });

    socket.on('close', () => {
      clearHeartbeat();
      socket = undefined;
      void subscriptionHandler.clearSubscriptions();
      if (connectionState !== 'auth_failed') {
        setConnectionState('disconnected');
        logger.info('relay', 'disconnected');
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
    logger.info('relay', 'reconnecting', { delayMs: delay });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
    reconnectTimer.unref();
  };

  const clearHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = undefined;
    }
    if (heartbeatTimeout) {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = undefined;
    }
  };

  const hasRunningPtySession = (): boolean => {
    return (options.ptySessions?.listSessions() ?? []).some(
      session => session.transport === 'pty-event-stream' && session.status === 'running'
    );
  };

  const stopPtyHealthCheck = () => {
    if (!ptyHealthTimer) {
      return;
    }
    clearTimeout(ptyHealthTimer);
    ptyHealthTimer = undefined;
  };

  const ensurePtyHealthCheck = () => {
    if (closed || connectionState !== 'connected' || ptyHealthCheckRunning || ptyHealthTimer || !hasRunningPtySession()) {
      if (!hasRunningPtySession()) {
        stopPtyHealthCheck();
      }
      return;
    }
    ptyHealthTimer = setTimeout(() => {
      ptyHealthTimer = undefined;
      if (closed || connectionState !== 'connected' || ptyHealthCheckRunning || !hasRunningPtySession()) {
        if (!hasRunningPtySession()) {
          stopPtyHealthCheck();
        }
        return;
      }
      ptyHealthCheckRunning = true;
      void sendSessions().finally(() => {
        ptyHealthCheckRunning = false;
        ensurePtyHealthCheck();
      });
    }, ptyHealthCheckIntervalMs);
    ptyHealthTimer.unref();
  };

  const startHeartbeat = (activeSocket: WebSocket | undefined) => {
    clearHeartbeat();
    if (!activeSocket) {
      return;
    }
    activeSocket.on('pong', () => {
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
      }
    });
    const ping = () => {
      if (activeSocket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (heartbeatTimeout) {
        return;
      }
      try {
        activeSocket.ping();
        heartbeatTimeout = setTimeout(() => {
          heartbeatTimeout = undefined;
          activeSocket.terminate();
        }, heartbeatTimeoutMs);
        heartbeatTimeout.unref();
      } catch {
        activeSocket.terminate();
      }
    };
    heartbeatInterval = setInterval(ping, heartbeatIntervalMs);
    heartbeatInterval.unref();
    ping();
  };

  const chatHandler = new ChatHandler({
    chatRegistry,
    relaySender,
    sessionCatalog,
    subscriptions,
    runnerForProvider: provider => chatRuntime.runnerForProvider(provider),
    sendError
  });
  const subscriptionHandler = new SubscriptionHandler({
    sessionCatalog,
    subscriptions,
    relaySender,
    ptySessions: options.ptySessions,
    runnerClientForSession: options.runnerClientForSession,
    runnerForProvider: provider => chatRuntime.runnerForProvider(provider),
    toRelayEvent,
    sendError,
    deferLostError
  });

  sendSessions = async () => {
    const sessions = await sessionCatalog.listRelaySessions();
    relaySender.sessions(sessions.map(toRelaySession));
    if (hasRunningPtySession()) {
      ensurePtyHealthCheck();
    } else {
      stopPtyHealthCheck();
    }
  };

  const frameRouter = new FrameRouter({
    onAuthOk: (frame) => {
      setConnectionState('connected');
      logger.info('relay', 'connected', { gatewayId: effectiveGatewayId ?? frame.gatewayId });
      void sendSessions();
    },
    onSessionsRestore: (frame) => {
      sessionCatalog.restoreRelaySessions(frame.sessions);
      void sendSessions();
    },
    onAuthFailed: (frame) => {
      logger.warn('relay', 'server rejected auth', { code: frame.code, message: frame.message });
      setConnectionState('auth_failed');
      socket?.close();
    },
    onList: () => {
      void sendSessions();
    },
    onSubscribe: (frame) => {
      void subscriptionHandler.subscribeClient(frame.clientId, frame.sessionId, frame.after ?? 0, frame.mode, frame.tail, frame.cols, frame.rows);
    },
    onInput: (frame) => {
      void ptyHandler.writeInput(frame.clientId, frame.sessionId, frame.data);
    },
    onResize: (frame) => {
      void ptyHandler.resizePty(frame.clientId, frame.sessionId, frame.cols, frame.rows);
    },
    onStop: (frame) => {
      void ptyHandler.stopPty(frame.clientId, frame.sessionId);
    },
    onUnsubscribe: (frame) => {
      void subscriptionHandler.removeSubscription(frame.clientId, frame.sessionId);
    },
    onDetach: (frame) => {
      void subscriptionHandler.removeSubscription(frame.clientId, frame.sessionId);
    },
    onChat: (frame) => {
      chatHandler.handleChat(frame);
    },
    onListProviders: (frame) => {
      void chatHandler.sendProviders(frame.clientId);
    },
    onCwdSuggest: (frame) => {
      void chatHandler.sendCwdSuggestions(frame.clientId, frame.cwd);
    },
    onSwitchModel: (frame) => {
      chatHandler.handleSwitchModel(frame.clientId, frame.sessionId);
    },
    onPermissionResponse: (frame) => {
      chatHandler.handlePermissionResponse(frame);
    },
    onNewPtySession: (frame) => {
      ptyHandler.handleNewSession(frame);
    }
  });

  connect();

  return {
    close: async () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      clearHeartbeat();
      stopPtyHealthCheck();
      await subscriptionHandler.clearSubscriptions();
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
    syncSessions: () => sendSessions(),
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
  parsed.pathname = normalizedPath.endsWith('/ws/gateway') ? normalizedPath : `${normalizedPath}/ws/gateway`;
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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

type RelayAuthResult =
  | { ok: true; gatewayId: string; token?: string; scope: RelayAuthScope }
  | { ok: false; permanent: boolean; message: string }

async function resolveRelayAuth(options: RelayClientOptions): Promise<RelayAuthResult> {
  if (options.token && options.scope) {
    return {
      ok: true,
      gatewayId: options.scope.gatewayId ?? options.gatewayId,
      token: options.token,
      scope: options.scope
    };
  }

  const authState = await loadGatewayAuthState();
  if (!authState.ok) {
    const permanent = authState.error === 'gateway_auth_missing' || authState.error === 'gateway_auth_invalid';
    return { ok: false, permanent, message: authState.error };
  }
  const parsed = authState.value;
  const payload = decodeGatewayToken(parsed.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string'
    ? payload.gatewayId
    : typeof parsed.gatewayId === 'string' ? parsed.gatewayId : undefined;
  const accountId = typeof payload?.accountId === 'string'
    ? payload.accountId
    : typeof parsed.accountId === 'string' ? parsed.accountId : undefined;
  if (!gatewayId || !accountId) {
    return { ok: false, permanent: true, message: 'gateway_auth_missing_ids' };
  }
  return {
    ok: true,
    gatewayId,
    token: parsed.accessToken,
    scope: {
      accountId,
      gatewayId,
      tokenClass: 'gateway_access',
      expiresAt: parsed.expiresAt,
      jti: 'relay-auth-local'
    }
  };
}
