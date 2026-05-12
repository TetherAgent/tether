import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type {
  RelayAuthScope,
  RelayGatewayToServerFrame,
  RelayServerToGatewayFrame,
  RelaySession,
  RelayTerminalEvent
} from '@tether/protocol';
import { detectSelectOptions } from './agent-select-detect.js';
import { ChatSessionRunner, CodexChatRunner, CopilotChatRunner, type ChatRunnerOptions, type IChatRunner } from './chat-session-runner.js';
import { createSessionEvent } from './events.js';
import { isValidTerminalSize, type PtySessionManager } from './pty.js';
import { RelaySender } from './relay/relay-sender.js';
import type { SessionRunnerClient } from './session-runner-client.js';
import type { Session, SessionEvent } from './types.js';
import { providerEffectiveEnv } from './provider-env.js';

const TETHER_VERSION = resolvePackageVersion(import.meta.url, ['@tether-labs/cli', '@tether/gateway']) ?? '0.0.0-dev';

export type RelayClientOptions = {
  url: string;
  secret: string;
  gatewayId: string;
  token?: string;
  scope?: RelayAuthScope;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
  onNewPtySession?: (params: {
    clientId: string;
    provider: string;
    command: string;
    cwd: string;
    cols: number;
    rows: number;
    title?: string;
    providerArgs?: string[];
  }) => Promise<{ sessionId: string }>;
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

type RelaySubscription = {
  mode: 'control' | 'observe';
  unsubscribe?: () => void | Promise<void>;
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
  const subscriptions = new Map<string, RelaySubscription>();
  const chatInFlight = new Set<string>();
  const chatSessions = new Map<string, Session>();
  let connectionState: RelayConnectionStatus['state'] = 'connecting';
  let lastChangedAt = Date.now();
  let effectiveGatewayId = options.gatewayId;
  const relaySender = new RelaySender((frame) => send(frame), () => effectiveGatewayId);
  const getStoredSession = (sessionId: string) => options.ptySessions?.getSession(sessionId) ?? chatSessions.get(sessionId);
  const chatRunnerOptions: ChatRunnerOptions = {
    gatewayId: () => effectiveGatewayId,
    onSessionCreated: (clientId, sessionId) => {
      relaySender.sessionCreated(clientId, sessionId);
      void sendSessions();
    },
    onChatSessionCreated: (clientId, metadata) => {
      const now = Date.now();
      chatSessions.set(metadata.id, {
        id: metadata.id,
        provider: metadata.provider,
        title: metadata.title ?? metadata.provider,
        projectPath: metadata.projectPath,
        accountId: metadata.accountId,
        userId: metadata.userId,
        gatewayId: metadata.gatewayId,
        status: 'running',
        attachState: 'detached',
        tmuxSessionName: '',
        command: metadata.provider,
        transport: 'chat',
        agentSessionId: metadata.agentSessionId,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now
      });
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
      chatInFlight.delete(sessionId);
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
      chatInFlight.delete(sessionId);
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
      const session = chatSessions.get(sessionId);
      if (session) {
        session.agentSessionId = agentSessionId;
        session.updatedAt = Date.now();
        session.lastActiveAt = session.updatedAt;
      }
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

  const sendProviders = async (clientId: string) => {
    const providers = [
      isInstalled('claude') ? { provider: 'claude', models: await providerModels('claude') } : undefined,
      isInstalled('codex') ? { provider: 'codex', models: await providerModels('codex') } : undefined,
      isCopilotInstalled() ? { provider: 'copilot', models: await providerModels('copilot') } : undefined
    ].filter((provider): provider is { provider: string; models: string[] } => provider !== undefined);
    sendChatEvent(0, '', 'gateway.providers', { clientId, providers });
  };

  const sendSessions = async () => {
    relaySender.sessions((await listRelaySessions()).map(toRelaySession));
  };

  const handleFrame = (frame: RelayServerToGatewayFrame) => {
    switch (frame.type) {
      case 'gateway.auth.ok':
        setConnectionState('connected');
        void sendSessions();
        return;
      case 'gateway.sessions-restore':
        for (const relaySession of frame.sessions) {
          const pid = 'pid' in relaySession && typeof relaySession.pid === 'number' ? relaySession.pid : undefined;
          const status = pid ? (isPidAlive(pid) ? 'running' : 'lost') : relaySession.status;
          options.ptySessions?.restoreSession({
            ...relaySession,
            status
          });
        }
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
        void writeInput(frame.clientId, frame.sessionId, frame.data);
        return;
      case 'client.resize':
        void resizePty(frame.clientId, frame.sessionId, frame.cols, frame.rows);
        return;
      case 'client.stop':
        void stopPty(frame.clientId, frame.sessionId);
        return;
      case 'client.unsubscribe':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
      case 'client.detach':
        removeSubscription(frame.clientId, frame.sessionId);
        return;
      case 'client.chat': {
        if (frame.sessionId === null) {
          const runner = runnerForProvider(frame.provider);
          if (!runner) {
            relaySender.error(frame.clientId, '', 'provider_not_supported', `provider is not supported: ${frame.provider}`);
            return;
          }
          void runner.run({
            clientId: frame.clientId,
            sessionId: null,
            provider: frame.provider,
            model: frame.model,
            cwd: frame.cwd,
            message: frame.message,
            accountId: frame.accountId,
            userId: frame.userId
          });
          return;
        }
        if (chatInFlight.has(frame.sessionId)) {
          sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
          return;
        }
        if (!frame.session) {
          relaySender.error(frame.clientId, frame.sessionId, 'missing_session_metadata', 'trusted session metadata is missing from relay frame');
          return;
        }
        const now = Date.now();
        chatSessions.set(frame.sessionId, {
          id: frame.session.id,
          provider: frame.session.provider,
          title: frame.session.title ?? frame.session.provider,
          projectPath: frame.session.projectPath,
          accountId: frame.session.accountId,
          userId: frame.session.userId,
          gatewayId: frame.session.gatewayId,
          status: 'running',
          attachState: 'detached',
          tmuxSessionName: '',
          command: frame.session.provider,
          transport: 'chat',
          agentSessionId: frame.session.agentSessionId,
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now
        });
        const runner = runnerForProvider(frame.session.provider);
        if (!runner) {
          relaySender.error(frame.clientId, frame.sessionId, 'provider_not_supported', `provider is not supported: ${frame.session.provider}`);
          return;
        }
        chatInFlight.add(frame.sessionId);
        void runner.run({
          clientId: frame.clientId,
          sessionId: frame.sessionId,
          message: frame.message,
          model: frame.model,
          session: frame.session
        }).catch((err: unknown) => {
          chatInFlight.delete(frame.sessionId);
          sendError(frame.clientId, frame.sessionId, 'chat_runner_failed', String(err));
        });
        return;
      }
      case 'client.list-providers':
        void sendProviders(frame.clientId);
        return;
      case 'client.cwd-suggest':
        void sendCwdSuggestions(frame.clientId, frame.cwd);
        return;
      case 'client.switch-model':
        relaySender.chatCatchup(frame.clientId, frame.sessionId, '模型切换功能将在后续版本中实现');
        relaySender.error(frame.clientId, frame.sessionId, 'switch_not_implemented', '模型切换功能将在后续版本中实现');
        return;
      case 'client.permission_response': {
        const session = getStoredSession(frame.sessionId);
        if (session) {
          runnerForProvider(session.provider)?.respondToPermission(frame.sessionId, frame.requestId, frame.decision);
        }
        return;
      }
      case 'client.new-pty-session':
        if (!options.onNewPtySession) {
          relaySender.error(frame.clientId, '', 'session_create_not_supported', 'gateway cannot create PTY sessions over relay');
          return;
        }
        void options.onNewPtySession({
          clientId: frame.clientId,
          provider: frame.provider,
          command: frame.command,
          cwd: frame.cwd,
          cols: frame.cols,
          rows: frame.rows,
          title: frame.title,
          providerArgs: frame.providerArgs
        }).then(({ sessionId }) => {
          relaySender.sessionCreated(frame.clientId, sessionId);
          void sendSessions();
        }).catch((error: unknown) => {
          relaySender.error(frame.clientId, '', 'session_create_failed', error instanceof Error ? error.message : String(error));
        });
        return;
      }
  };

  const listRelaySessions = async (): Promise<Session[]> => {
    const ptyList = (options.ptySessions?.listSessions() ?? []).filter(s => !chatSessions.has(s.id));
    const sessions = [...chatSessions.values(), ...ptyList];
    const result: Session[] = [];
    for (const session of sessions) {
      if (session.status === 'lost') {
        continue;
      }
      if (session.transport === 'chat') {
        result.push(session);
        continue;
      }
      if (options.ptySessions?.isRestoredSession(session.id)) {
        result.push(session);
        continue;
      }
      if (session.status !== 'running' || session.transport !== 'pty-event-stream') {
        continue;
      }
      const alive = await isLiveSession(session);
      if (alive) {
        result.push(session);
        continue;
      }
      markSessionLost(session.id);
      const updated = getStoredSession(session.id);
      result.push(updated ?? { ...session, status: 'lost' });
    }
    return result;
  };

  const sendCwdSuggestions = async (clientId: string, cwd: string) => {
    sendChatEvent(0, '', 'gateway.cwd-suggestions', {
      clientId,
      cwd,
      suggestions: await directorySuggestions(cwd)
    });
  };

  const isLiveSession = async (session: Session): Promise<boolean> => {
    const runnerClient = options.runnerClientForSession?.(session);
    if (runnerClient?.ping) {
      try {
        const pong = await runnerClient.ping();
        return pong?.sessionId === session.id;
      } catch {
        return false;
      }
    }
    if (options.ptySessions) {
      return options.ptySessions.hasLiveSession(session.id);
    }
    return true;
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
    const key = subscriptionKey(clientId, sessionId);
    const previousSubscription = subscriptions.get(key);
    if (previousSubscription) {
      await previousSubscription.unsubscribe?.();
      subscriptions.delete(key);
    }
    if (session.transport === 'pty-event-stream' && session.status !== 'running') {
      deferLostError(clientId, sessionId);
      return;
    }
    subscriptions.set(key, { mode });
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
            markSessionLost(sessionId);
            return false;
          }
        );
        if (!resized) {
          subscriptions.delete(key);
          deferLostError(clientId, sessionId);
          return;
        }
      } else {
        const ok = options.ptySessions?.resize(sessionId, clientId, nextCols, nextRows) ?? false;
        if (!ok) {
          markSessionLost(sessionId);
          subscriptions.delete(key);
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
        markSessionLost(sessionId);
        subscriptions.delete(key);
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
    subscriptions.set(key, { mode, unsubscribe: wrappedUnsubscribe });
  };

  const markSessionLost = (sessionId: string): void => {
    const session = getStoredSession(sessionId);
    if (session?.status === 'running') {
      options.ptySessions?.updateSessionStatus(sessionId, 'lost');
      const event = createSessionEvent(sessionId, 'session.error', {
        code: 'session_lost',
        message: 'Gateway relay client lost the session runner'
      });
      relaySender.event(toRelayEvent(event));
    }
  };

  const replayEvents = (clientId: string, sessionId: string, after: number, tail?: number): number => {
    void tail;
    relaySender.replay(clientId, sessionId, [], after);
    return after;
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
    const session = getStoredSession(sessionId);
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
    const session = getStoredSession(sessionId);
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
    const session = getStoredSession(sessionId);
    const runnerClient = session ? options.runnerClientForSession?.(session) : undefined;
    if (runnerClient) {
      await runnerClient.stop('relay-stop').catch(() => {
        options.ptySessions?.updateSessionStatus(sessionId, 'lost');
        sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
      });
      return;
    }
    const ok = options.ptySessions?.stop(sessionId) ?? false;
    if (!ok) {
      options.ptySessions?.updateSessionStatus(sessionId, 'lost');
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  };

  const sendError = (clientId: string, sessionId: string, code: string, message: string) => {
    relaySender.error(clientId, sessionId, code, message);
  };

  const deferLostError = (clientId: string, sessionId: string) => {
    setTimeout(() => {
      sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }, 0);
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

function subscriptionKey(clientId: string, sessionId: string): string {
  return `${clientId}:${sessionId}`;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function toRelaySession(session: Session): RelaySession {
  return {
    id: session.id,
    provider: session.provider,
    title: session.title,
    projectPath: session.projectPath,
    accountId: session.accountId,
    gatewayId: undefined,
    userId: session.userId,
    agentSessionId: session.agentSessionId,
    status: session.status,
    transport: session.transport,
    lastActiveAt: session.lastActiveAt
  };
}

async function providerModels(provider: string): Promise<string[]> {
  const env = providerEffectiveEnv(provider, process.cwd());
  switch (provider) {
    case 'claude':
      return claudeModels();
    case 'codex':
      return codexModels(env);
    case 'copilot':
      return copilotModels(env);
    default:
      return [];
  }
}

function codexModels(env: NodeJS.ProcessEnv): string[] {
  return uniqueStrings([
    env.CODEX_MODEL,
    readCodexConfiguredModel(env),
    ...readCodexCachedModels(env),
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2'
  ]);
}

function readCodexConfiguredModel(env: NodeJS.ProcessEnv): string | undefined {
  const configDir = env.CODEX_HOME ? resolveHomePath(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  try {
    const content = readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    const match = content.match(/(?:^|\n)\s*model\s*=\s*["']([^"'\n]+)["']/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function readCodexCachedModels(env: NodeJS.ProcessEnv): string[] {
  const configDir = env.CODEX_HOME ? resolveHomePath(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  try {
    const parsed = JSON.parse(readFileSync(path.join(configDir, 'models_cache.json'), 'utf8')) as { models?: unknown };
    if (!Array.isArray(parsed.models)) {
      return [];
    }
    return parsed.models.flatMap((model) => {
      if (!model || typeof model !== 'object') {
        return [];
      }
      const slug = (model as { slug?: unknown }).slug;
      return typeof slug === 'string' ? [slug] : [];
    });
  } catch {
    return [];
  }
}

function copilotModels(env: NodeJS.ProcessEnv): string[] {
  return uniqueStrings([
    env.COPILOT_MODEL,
    env.COPILOT_PROVIDER_MODEL_ID,
    readCopilotConfiguredModel(),
    ...copilotModelsFromHelp(),
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.2',
    'claude-sonnet-4'
  ]);
}

function readCopilotConfiguredModel(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(os.homedir(), '.copilot', 'settings.json'), 'utf8')) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

function copilotModelsFromHelp(): string[] {
  const result = spawnSync('gh', ['copilot', 'help', 'config'], { encoding: 'utf8', timeout: 2000 });
  const help = typeof result.stdout === 'string' ? result.stdout : '';
  const models: string[] = [];
  for (const line of help.split('\n')) {
    const match = line.match(/^\s*-\s+"([^"]+)"/);
    if (match?.[1]) {
      models.push(match[1]);
    }
  }
  return models;
}

async function claudeModels(): Promise<string[]> {
  const env = providerEffectiveEnv('claude', process.cwd());
  const envModels = claudeModelsFromEnv(env);
  if (envModels.length > 0) {
    return envModels;
  }
  const gatewayModels = await claudeModelsFromGateway(env);
  if (gatewayModels.length > 0) {
    return gatewayModels;
  }
  return claudeModelAliases(env);
}

function claudeModelsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return uniqueStrings([
    env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  ]);
}

async function claudeModelsFromGateway(env: NodeJS.ProcessEnv): Promise<string[]> {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl || env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY !== '1') {
    return [];
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/models`;
    url.search = 'limit=1000';
  } catch {
    return [];
  }
  const headers: Record<string, string> = {};
  if (env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  }
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return [];
    }
    const json = (await response.json()) as { data?: unknown };
    if (!Array.isArray(json.data)) {
      return [];
    }
    return uniqueStrings(
      json.data.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const id = (item as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      })
    );
  } catch {
    return [];
  }
}

function claudeModelAliases(env: NodeJS.ProcessEnv): string[] {
  const result = spawnSync('claude', ['--help'], { encoding: 'utf8', timeout: 2000, env });
  const help = typeof result.stdout === 'string' ? result.stdout : '';
  const modelLine = help.split('\n').find((line) => line.includes('--model'));
  if (!modelLine) {
    return ['sonnet', 'opus', 'haiku'];
  }
  const aliasExample = modelLine.match(/alias[^()]*\(e\.g\.\s*([^)]+)\)/i)?.[1] ?? modelLine;
  const aliases = Array.from(aliasExample.matchAll(/'([^']+)'/g))
    .map((match) => match[1])
    .filter((model): model is string => Boolean(model && /^[a-z][a-z0-9_-]*$/i.test(model) && !model.startsWith('claude-')));
  const normalized = uniqueStrings([...aliases, 'haiku']);
  return normalized.length > 0 ? normalized : ['sonnet', 'opus', 'haiku'];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isInstalled(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0 || result.error === undefined;
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

function isCopilotInstalled(): boolean {
  const result = spawnSync('gh', ['copilot', '--help'], { stdio: 'ignore', timeout: 2000 });
  return result.status === 0;
}

async function directorySuggestions(input: string): Promise<string[]> {
  const trimmed = input.trim();
  const expanded = resolveInputPath(trimmed);
  const shouldListChildren = !trimmed || trimmed.endsWith('/') || trimmed === '~';
  const baseDir = shouldListChildren ? expanded : path.dirname(expanded);
  const prefix = shouldListChildren ? '' : path.basename(expanded).toLowerCase();
  const showHidden = prefix.startsWith('.') || path.basename(baseDir).startsWith('.');
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => showHidden || !entry.name.startsWith('.'))
      .filter((entry) => !prefix || entry.name.toLowerCase().startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 20)
      .map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function resolveInputPath(input: string): string {
  if (!input) {
    return os.homedir();
  }
  return path.resolve(resolveHomePath(input));
}

function resolveHomePath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
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
