import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type {
  RelayAuthScope,
  RelayGatewayToServerFrame,
  RelayServerToGatewayFrame,
  RelayTerminalEvent
} from '@tether/protocol';
import { detectSelectOptions } from './agent-select-detect.js';
import { ChatSessionRegistry } from './chat/chat-session-registry.js';
import { ChatSessionRunner, CodexChatRunner, CopilotChatRunner, type ChatRunnerOptions, type IChatRunner } from './chat-session-runner.js';
import { createSessionEvent } from './events.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { ChatHandler } from './relay/chat-handler.js';
import { PtyHandler, type NewPtySessionHandler } from './relay/pty-handler.js';
import { RelaySender } from './relay/relay-sender.js';
import { SessionCatalog, toRelaySession } from './relay/session-catalog.js';
import { SubscriptionManager } from './relay/subscription-manager.js';
import type { SessionRunnerClient } from './session-runner-client.js';
import type { Session, SessionEvent } from './types.js';

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

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;
const RELAY_HEARTBEAT_INTERVAL_MS = 15_000;
const RELAY_HEARTBEAT_TIMEOUT_MS = 10_000;
const RELAY_FORBIDDEN_KEYS = new Set(['command', 'args', 'argv', 'env', 'providerCommand']);
const GATEWAY_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export function startRelayClient(options: RelayClientOptions): RunningRelayClient {
  let closed = false;
  let socket: WebSocket | undefined;
  let reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let heartbeatInterval: NodeJS.Timeout | undefined;
  let heartbeatTimeout: NodeJS.Timeout | undefined;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? RELAY_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? RELAY_HEARTBEAT_TIMEOUT_MS;
  const subscriptions = new SubscriptionManager();
  const chatRegistry = new ChatSessionRegistry();
  let connectionState: RelayConnectionStatus['state'] = 'connecting';
  let lastChangedAt = Date.now();
  let effectiveGatewayId = options.gatewayId;
  const relaySender = new RelaySender((frame) => send(frame), () => effectiveGatewayId);
  const sessionCatalog = new SessionCatalog({
    chatRegistry,
    ptySessions: options.ptySessions,
    runnerClientForSession: options.runnerClientForSession,
    emitEvent: (event) => relaySender.event(toRelayEvent(event)),
    isPidAlive
  });
  const getStoredSession = (sessionId: string) => sessionCatalog.get(sessionId);
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
  const chatRunnerOptions: ChatRunnerOptions = {
    gatewayId: () => effectiveGatewayId,
    onSessionCreated: (clientId, sessionId) => {
      relaySender.sessionCreated(clientId, sessionId);
      void sendSessions();
    },
    onChatSessionCreated: (clientId, metadata) => {
      chatRegistry.upsertFromMetadata(metadata);
      relaySender.chatSessionCreated(clientId, metadata);
    },
    onUserMessage: ({ clientId, sessionId, event }) => {
      sendChatEvent(event.id, sessionId, 'user.message', {
        clientId,
        message: event.payload.message
      });
    },
    onDelta: ({ clientId, sessionId, text, deltaEventId }) => {
      sendChatEvent(deltaEventId, sessionId, 'agent.delta', { clientId, text });
    },
    onResult: ({ clientId, sessionId, event, text, usage, stopReason, contextWindow, rateLimitInfo, contextInputTokens, nextSuggestions }) => {
      chatRegistry.releaseInFlight(sessionId);
      sendChatEvent(event.id, sessionId, 'agent.result', {
        clientId,
        text,
        usage,
        ...(stopReason ? { stop_reason: stopReason } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(rateLimitInfo ? { rateLimitInfo } : {}),
        ...(contextInputTokens !== undefined ? { contextInputTokens } : {}),
        ...(nextSuggestions && nextSuggestions.length > 0 ? { nextSuggestions } : {})
      });
    },
    onPermissionRequest: ({ clientId, sessionId, requestId, toolName, input }) => {
      sendChatEvent(Date.now(), sessionId, 'agent.permission_request', {
        clientId,
        requestId,
        toolName,
        input
      });
    },
    onTool: ({ clientId, sessionId, event, name, input, result, isError }) => {
      sendChatEvent(event.id, sessionId, 'agent.tool', {
        clientId,
        name,
        input,
        ...(result ? { result } : {}),
        ...(isError !== undefined ? { isError } : {})
      });
    },
    onError: ({ clientId, sessionId, code, message, event }) => {
      chatRegistry.releaseInFlight(sessionId);
      if (event) {
        sendChatEvent(event.id, sessionId, 'session.error', {
          clientId,
          code,
          message
        });
      }
      relaySender.error(clientId, sessionId, code, message);
    },
    onAgentIdUpdate: (sessionId, agentSessionId) => {
      chatRegistry.updateAgentSessionId(sessionId, agentSessionId);
      sendChatEvent(Date.now(), sessionId, 'session.agent-id-updated', { sessionId, agentSessionId });
    }
  };
  const chatRunner = new ChatSessionRunner(chatRunnerOptions);
  const codexChatRunner = new CodexChatRunner(chatRunnerOptions);
  const copilotChatRunner = new CopilotChatRunner(chatRunnerOptions);

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
      startHeartbeat(socket);
      void (async () => {
        const auth = await resolveRelayAuth(options);
        if (!auth) {
          console.error('Relay auth failed: missing ~/.tether/auth.json or invalid gateway token. Run: tether login');
          setConnectionState('auth_failed');
          socket?.close();
          return;
        }
        effectiveGatewayId = auth.gatewayId;
        reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
        send({ type: 'gateway.auth', gatewayId: auth.gatewayId, token: auth.token, scope: auth.scope, secret: options.secret, version: TETHER_VERSION });
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
      clearHeartbeat();
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

  const send = (frame: RelayGatewayToServerFrame) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const sendChatEvent = (id: number, sessionId: string, type: string, payload: Record<string, unknown>) => {
    relaySender.event({
      id,
      sessionId,
      type,
      ts: Date.now(),
      payload
    });
  };

  const runnerForProvider = (provider: string): IChatRunner | undefined => {
    switch (provider) {
      case 'claude':
        return chatRunner;
      case 'codex':
        return codexChatRunner;
      case 'copilot':
        return copilotChatRunner;
      default:
        return undefined;
    }
  };

  const chatHandler = new ChatHandler({
    chatRegistry,
    relaySender,
    sessionCatalog,
    subscriptions,
    runnerForProvider,
    sendError
  });

  const sendSessions = async () => {
    relaySender.sessions((await sessionCatalog.listRelaySessions()).map(toRelaySession));
  };

  const handleFrame = (frame: RelayServerToGatewayFrame) => {
    switch (frame.type) {
      case 'gateway.auth.ok':
        setConnectionState('connected');
        void sendSessions();
        return;
      case 'gateway.sessions-restore':
        sessionCatalog.restoreRelaySessions(frame.sessions);
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
      case 'client.input':
        void ptyHandler.writeInput(frame.clientId, frame.sessionId, frame.data);
        return;
      case 'client.resize':
        void ptyHandler.resizePty(frame.clientId, frame.sessionId, frame.cols, frame.rows);
        return;
      case 'client.stop':
        void ptyHandler.stopPty(frame.clientId, frame.sessionId);
        return;
      case 'client.unsubscribe':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
      case 'client.detach':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
      case 'client.chat':
        chatHandler.handleChat(frame);
        return;
      case 'client.list-providers':
        void chatHandler.sendProviders(frame.clientId);
        return;
      case 'client.cwd-suggest':
        void chatHandler.sendCwdSuggestions(frame.clientId, frame.cwd);
        return;
      case 'client.switch-model':
        chatHandler.handleSwitchModel(frame.clientId, frame.sessionId);
        return;
      case 'client.permission_response':
        chatHandler.handlePermissionResponse(frame);
        return;
      case 'client.new-pty-session':
        ptyHandler.handleNewSession(frame);
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
    const session = getStoredSession(sessionId);
    if (!session) {
      sendError(clientId, sessionId, 'session_not_found', 'session not found');
      return;
    }
    const previousSubscription = subscriptions.get(clientId, sessionId);
    if (previousSubscription) {
      await previousSubscription.unsubscribe?.();
      subscriptions.delete(clientId, sessionId);
    }
    if (session.transport === 'pty-event-stream' && session.status !== 'running') {
      deferLostError(clientId, sessionId);
      return;
    }
    subscriptions.set(clientId, sessionId, { mode });
    if (session.transport === 'chat') {
      const catchupText = runnerForProvider(session.provider)?.getCatchup(sessionId);
      if (catchupText !== undefined) {
        relaySender.chatCatchup(clientId, sessionId, catchupText);
      }
      return;
    }
    if (isValidTerminalSize(cols, rows) && mode === 'control') {
      const nextCols = cols;
      const nextRows = Number(rows);
      const runnerClient = options.runnerClientForSession?.(session);
      if (runnerClient) {
        const resized = await runnerClient.resize(nextCols, nextRows, clientId).then(
          () => true,
          () => {
            sessionCatalog.markSessionLost(sessionId);
            return false;
          }
        );
        if (!resized) {
          subscriptions.delete(clientId, sessionId);
          deferLostError(clientId, sessionId);
          return;
        }
      } else {
        const ok = options.ptySessions?.resize(sessionId, clientId, nextCols, nextRows) ?? false;
        if (!ok) {
          sessionCatalog.markSessionLost(sessionId);
          subscriptions.delete(clientId, sessionId);
          deferLostError(clientId, sessionId);
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
        session.provider !== 'claude'
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
        const subSession = getStoredSession(session.id);
        if (!subSession) {
          return;
        }
        const raw = lines.filter((line) => /^\s*\d+\.\s+/.test(line)).join('\n');
        const selectEvent = createSessionEvent(subSession.id, 'agent.select', {
          options: matchedOptions,
          raw
        });
        relaySender.event(toRelayEvent(selectEvent));
        relaySelectEmitted = true;
      }, 300);
    };

    const replayCursor = replayEvents(clientId, sessionId, after, tail);

    const runnerClient = options.runnerClientForSession?.(session);
    let unsubscribe: (() => void | Promise<void>) | undefined;
    if (runnerClient) {
      try {
        unsubscribe = await runnerClient.subscribeEvents((frame) => {
          relaySender.event(toRelayEvent(frame.event));
          detectAndEmitRelaySelect(frame.event);
        }, replayCursor);
      } catch {
        sessionCatalog.markSessionLost(sessionId);
        subscriptions.delete(clientId, sessionId);
        deferLostError(clientId, sessionId);
        return;
      }
    } else {
      unsubscribe = options.ptySessions?.subscribe(sessionId, (event) => {
        relaySender.event(toRelayEvent(event));
        detectAndEmitRelaySelect(event);
      });
    }
    const wrappedUnsubscribe = async () => {
      clearTimeout(relaySelectDebounceTimer);
      await unsubscribe?.();
    };
    subscriptions.set(clientId, sessionId, { mode, unsubscribe: wrappedUnsubscribe });
  };

  const replayEvents = (clientId: string, sessionId: string, after: number, tail?: number): number => {
    void tail;
    relaySender.replay(clientId, sessionId, [], after);
    return after;
  };

  const removeSubscription = async (clientId: string, sessionId: string) => {
    await subscriptions.remove(clientId, sessionId);
  };

  const clearSubscriptions = () => {
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
      clearHeartbeat();
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
    if (next === current) break;
    current = next;
  }
  return undefined;
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
  let parsed = JSON.parse(raw) as {
    serverUrl?: unknown;
    gatewayId?: unknown;
    accountId?: unknown;
    accessToken?: unknown;
    refreshToken?: unknown;
    expiresAt?: unknown;
  };
  if (
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return undefined;
  }
  if (parsed.expiresAt <= Date.now() + GATEWAY_TOKEN_REFRESH_SKEW_MS) {
    parsed = await refreshGatewayAuthState(parsed).catch(() => parsed);
  }
  if (
    typeof parsed.expiresAt !== 'number' ||
    typeof parsed.accessToken !== 'string' ||
    parsed.expiresAt <= Date.now()
  ) {
    return undefined;
  }
  const payload = decodeGatewayToken(parsed.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string'
    ? payload.gatewayId
    : typeof parsed.gatewayId === 'string' ? parsed.gatewayId : undefined;
  const accountId = typeof payload?.accountId === 'string'
    ? payload.accountId
    : typeof parsed.accountId === 'string' ? parsed.accountId : undefined;
  if (!gatewayId || !accountId) {
    console.error('auth.json accessToken 缺少 gatewayId/accountId，请重新运行 tether login');
    return undefined;
  }
  return {
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

async function refreshGatewayAuthState(state: {
  serverUrl?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
}): Promise<{
  serverUrl?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
}> {
  if (typeof state.serverUrl !== 'string' || typeof state.refreshToken !== 'string') {
    return state;
  }
  const response = await fetch(`${state.serverUrl}/api/relay/gateway/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  if (!response.ok) {
    return state;
  }
  const body = await response.json().catch(() => undefined);
  const data = unwrapServerApiData(body) as { accessToken?: unknown; refreshToken?: unknown } | undefined;
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return state;
  }
  const payload = decodeGatewayToken(data.accessToken);
  if (typeof payload?.expiresAt !== 'number') {
    return state;
  }
  const next = {
    serverUrl: state.serverUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: payload.expiresAt
  };
  const authPath = process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json');
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

function unwrapServerApiData(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('code' in body)) {
    return body;
  }
  const payload = body as { code?: unknown; data?: unknown };
  return payload.code === 200 ? payload.data : undefined;
}
