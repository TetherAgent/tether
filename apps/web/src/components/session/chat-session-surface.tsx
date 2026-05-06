import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TerminalSquare } from 'lucide-react';
import { Button, Textarea } from '@tether/design';

import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { gatewayAuthHeaders, requestGatewayWsTicket } from '../../lib/api.js';
import { ChatBubble } from './chat-bubble.js';
import { ChatMarkdown } from './chat-markdown.js';
import { SessionDetailHeader, TerminalSurfaceSkeleton } from './session-detail-chrome.js';

type ConnectionMode = 'direct' | 'relay';
type WebMessages = ReturnType<typeof useI18n>['t'];

export type ChatSessionSurfaceProps = {
  sessionId: string;
  connectionSettings: {
    connectionMode: ConnectionMode;
    relayUrl: string;
    relaySecret: string;
  };
  onConnectionSettingsChange: (settings: {
    connectionMode: ConnectionMode;
    relayUrl: string;
    relaySecret: string;
  }) => void;
};

type SessionEvent = {
  id: number;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
};

type StreamFrame =
  | { type: 'hello'; sessionId: string; clientId: string; latestEventId: number; controllerClientId: string | null }
  | { type: 'replay.done'; latestEventId: number }
  | { type: 'event'; event: SessionEvent }
  | { type: 'error'; code: string; message: string };

type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };

type ToolInfo = { name: string; inputSummary: string };
type ChatMessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolInfo[];
  status?: ChatMessageStatus;
};
type AgentRuntimeStatus = 'idle' | 'submitted' | 'running' | 'responding' | 'done' | 'exited' | 'disconnected';
type ConversationTurn = {
  id: number;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string;
  tools: string | null;
  createdAt: number;
};

const FULL_REPLAY_EVENT_PAGE_LIMIT = 5000;
const RELAY_VIRTUAL_COLS = 200;
const RELAY_VIRTUAL_ROWS = 50;
const CHAT_ENTER_DELAY_MS = 120;
const PENDING_TIMEOUT_MS = 5000;
const SCROLL_FOLLOW_THRESHOLD_PX = 80;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function upsertChatMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex !== -1) {
    const next = [...messages];
    next[existingIndex] = { ...message, status: message.status ?? 'delivered' };
    return next;
  }
  if (message.role === 'user') {
    const pendingIndex = messages.findIndex(
      (item) =>
        item.role === 'user' &&
        item.id.startsWith('pending:') &&
        (item.status === 'pending' || item.status === 'sent')
    );
    if (pendingIndex !== -1) {
      const next = [...messages];
      next[pendingIndex] = { ...message, status: 'delivered' };
      return next;
    }
  }
  return [...messages, message];
}

function agentStatusLabel(status: unknown, t: WebMessages): string | undefined {
  switch (status) {
    case 'idle':
      return t.agentStatusIdle;
    case 'submitted':
      return t.agentStatusSubmitted;
    case 'running':
      return t.agentStatusRunning;
    case 'responding':
      return t.agentStatusResponding;
    case 'done':
      return t.agentStatusDone;
    case 'exited':
    case 'disconnected':
      return t.agentStatusDisconnected;
    default:
      return undefined;
  }
}

function isAgentRuntimeStatus(status: unknown): status is AgentRuntimeStatus {
  return (
    status === 'idle' ||
    status === 'submitted' ||
    status === 'running' ||
    status === 'responding' ||
    status === 'done' ||
    status === 'exited' ||
    status === 'disconnected'
  );
}

function buildRelayClientUrl(relayUrl: string, fillRelayUrlMsg: string, protocolInvalidMsg: string): string {
  const value = relayUrl.trim();
  if (!value) {
    throw new Error(fillRelayUrlMsg);
  }
  const url = new URL(value);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(protocolInvalidMsg);
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildGatewayStreamUrl(sessionId: string, query: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/stream?${query}`;
}

function parseWsFrame(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== 'string') {
    return undefined;
  }
  try {
    const frame = JSON.parse(data) as unknown;
    if (frame && typeof frame === 'object' && !Array.isArray(frame)) {
      return frame as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function gatewayRequest(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const authHeaders = gatewayAuthHeaders();
  if (authHeaders) {
    for (const [key, value] of new Headers(authHeaders).entries()) {
      headers.set(key, value);
    }
  }
  return fetch(input, { ...init, headers });
}

function displayMessage(message: string, t: WebMessages): string {
  switch (message) {
    case 'authentication failed':
      return t.authFailed;
    case 'gateway is not connected':
      return t.gatewayNotConnected;
    case 'client is not subscribed to this session':
      return t.sessionNotSubscribed;
    case 'observer clients cannot send input':
      return t.observeCannotSend;
    default:
      return message;
  }
}

export function ChatSessionSurface({ sessionId, connectionSettings }: ChatSessionSurfaceProps) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const locationState = location.state as { agentSessionId?: string; provider?: string } | null;

  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [typingVisible, setTypingVisible] = React.useState(false);
  const [selectOptions, setSelectOptions] = React.useState<Array<{ index: number; label: string }>>([]);
  const [selectRaw, setSelectRaw] = React.useState('');
  const [inputText, setInputText] = React.useState('');
  const [status, setStatus] = React.useState<string>(t.statusConnecting);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = React.useState<AgentRuntimeStatus>('idle');
  const [isReady, setIsReady] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(locationState?.agentSessionId);
  const [sessionProvider, setSessionProvider] = React.useState<string | undefined>(locationState?.provider);
  const [unreadCount, setUnreadCount] = React.useState(0);

  const socket = React.useRef<WebSocket | undefined>(undefined);
  const chatScrollRef = React.useRef<HTMLDivElement>(null);
  const isNearBottomRef = React.useRef(true);
  const lastMessageCountRef = React.useRef(0);
  // tRef holds the latest i18n table so the WS effect can read translated status
  // strings without listing `t` as a dependency (which would tear down and rebuild
  // the entire stream on language switch).
  const tRef = React.useRef(t);
  React.useEffect(() => {
    tRef.current = t;
  }, [t]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      console.info('[tether] structured chat reply not available yet', { sessionId });
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [sessionId]);

  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distance <= SCROLL_FOLLOW_THRESHOLD_PX;
      isNearBottomRef.current = nearBottom;
      if (nearBottom) {
        setUnreadCount(0);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    const previousCount = lastMessageCountRef.current;
    const currentCount = chatMessages.length;
    lastMessageCountRef.current = currentCount;
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnreadCount(0);
    } else if (currentCount > previousCount) {
      setUnreadCount((prev) => prev + (currentCount - previousCount));
    }
  }, [chatMessages]);

  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [typingVisible, selectOptions]);

  const scrollToBottom = React.useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    isNearBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  const refreshConversation = React.useCallback(async () => {
    try {
      const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/conversation`);
      if (response.status === 401) {
        logoutNormal();
        return;
      }
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { turns: ConversationTurn[] };
      setChatMessages((prev) => {
        let next = prev;
        for (const turn of data.turns) {
          next = upsertChatMessage(next, {
            id: `turn:${turn.turnIndex}`,
            role: turn.role,
            content: turn.content,
            tools: turn.tools ? (JSON.parse(turn.tools) as ToolInfo[]) : []
          });
        }
        return next;
      });
    } catch {
      // WebSocket replay remains the primary live path.
    }
  }, [logoutNormal, sessionId]);

  const updateMessageStatus = React.useCallback(
    (localId: string, status: ChatMessageStatus, predicate?: (current: ChatMessage) => boolean) => {
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.id === localId && (!predicate || predicate(msg))
            ? { ...msg, status }
            : msg
        )
      );
    },
    []
  );

  const sendChatText = React.useCallback(
    async (value: string) => {
      const displayValue = value.trim();
      if (!displayValue) {
        return;
      }
      if (agentRuntimeStatus === 'exited' || agentRuntimeStatus === 'disconnected') {
        setStatus(t.composerDisabledSessionClosed);
        return;
      }
      if (isSending) {
        setStatus(t.composerDisabledSending);
        return;
      }
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus(t.statusWsUnavailable);
        return;
      }
      // Display preserves newlines so user sees what they typed; wire flattens to
      // single-line so PTY agents (notably Codex) don't enter multi-line edit mode.
      const wireValue = displayValue.replace(/\s*\r?\n\s*/g, ' ');
      setSelectOptions([]);
      setSelectRaw('');
      const sendFrame = (data: string) => {
        ws.send(JSON.stringify(
          connectionSettings.connectionMode === 'relay'
            ? { type: 'client.input', sessionId, data }
            : { type: 'input', data }
        ));
      };
      const localId = `pending:${
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      }`;
      setChatMessages((prev) => [
        ...prev,
        {
          id: localId,
          role: 'user',
          content: displayValue,
          tools: [],
          status: 'pending'
        }
      ]);
      setInputText('');
      setIsSending(true);
      try {
        sendFrame(wireValue);
        await wait(CHAT_ENTER_DELAY_MS);
        sendFrame('\r');
        updateMessageStatus(localId, 'sent', (m) => m.status === 'pending');
      } catch {
        updateMessageStatus(localId, 'failed', (m) => m.status !== 'delivered');
      } finally {
        setIsSending(false);
      }
      window.setTimeout(() => {
        updateMessageStatus(localId, 'failed', (m) =>
          m.status === 'pending' || m.status === 'sent'
        );
      }, PENDING_TIMEOUT_MS);
    },
    [agentRuntimeStatus, connectionSettings.connectionMode, isSending, sessionId, t, updateMessageStatus]
  );

  React.useEffect(() => {
    let disposed = false;
    let replayComplete = false;
    let reconnectAttempt = 0;
    let reconnectStopped = false;
    let closeWasExpected = false;
    let reconnectTimer: number | undefined;
    let ws: WebSocket | undefined;
    let after = 0;

    const handleEvent = (event: SessionEvent) => {
      if (event.sessionId !== sessionId) {
        return;
      }
      if (event.id <= after) {
        return;
      }
      after = Math.max(after, event.id);

      if (event.type === 'agent.status') {
        if (isAgentRuntimeStatus(event.payload.status)) {
          setAgentRuntimeStatus(event.payload.status);
        }
        const label = agentStatusLabel(event.payload.status, tRef.current);
        if (label) {
          setStatus(label);
        }
        return;
      }

      if (event.type === 'agent.turn') {
        const turn = event.payload as { role?: string; content?: string; tools?: ToolInfo[]; turnIndex?: number };
        const message: ChatMessage = {
          id: typeof turn.turnIndex === 'number' ? `turn:${turn.turnIndex}` : `event:${event.id}`,
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: typeof turn.content === 'string' ? turn.content : '',
          tools: Array.isArray(turn.tools) ? turn.tools : []
        };
        setChatMessages((prev) => upsertChatMessage(prev, message));
        setTypingVisible(false);
        return;
      }
      if (event.type === 'agent.typing') {
        setTypingVisible(true);
        return;
      }
      if (event.type === 'agent.select') {
        const payload = event.payload as { options?: Array<{ index: number; label: string }>; raw?: string };
        setSelectOptions(Array.isArray(payload.options) ? payload.options : []);
        setSelectRaw(typeof payload.raw === 'string' ? payload.raw : '');
        return;
      }
      if (event.type === 'session.exited') {
        setAgentRuntimeStatus('exited');
        setStatus(tRef.current.statusExited);
      }
    };

    const fetchReplayPage = async (query: string): Promise<SessionEvent[]> => {
      const response = await gatewayRequest(
        `/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`
      );
      if (response.status === 401) {
        logoutNormal();
      }
      if (response.status === 404) {
        if (connectionSettings.connectionMode !== 'relay') {
          reconnectStopped = true;
        }
        throw new Error(tRef.current.statusSessionDetached);
      }
      if (!response.ok) {
        throw new Error(`events HTTP ${response.status}`);
      }
      const data = (await response.json()) as { events: SessionEvent[] };
      return data.events;
    };

    const replayEvents = async () => {
      setStatus(tRef.current.statusReplaying);
      let keepLoading = true;
      try {
        while (!disposed && keepLoading) {
          const beforePageCursor = after;
          const events = await fetchReplayPage(`after=${after}&limit=${FULL_REPLAY_EVENT_PAGE_LIMIT}`);
          for (const event of events) {
            handleEvent(event);
          }
          keepLoading = events.length === FULL_REPLAY_EVENT_PAGE_LIMIT && after > beforePageCursor;
        }
      } catch (error) {
        if (connectionSettings.connectionMode === 'relay') {
          replayComplete = false;
          return;
        }
        throw error;
      }
      replayComplete = true;
      setIsReady(true);
    };

    const probeGatewaySession = async (): Promise<boolean> => {
      if (connectionSettings.connectionMode === 'relay') {
        return true;
      }
      try {
        const response = await gatewayRequest(
          `/api/sessions/${encodeURIComponent(sessionId)}/snapshot`
        );
        if (response.status === 401) {
          logoutNormal();
        }
        if (response.status === 404) {
          reconnectStopped = true;
          setStatus(tRef.current.statusSessionDetached);
          setIsReady(true);
          return false;
        }
        if (!response.ok) {
          setStatus(tRef.current.statusGatewayRestarting);
          return false;
        }
        const data = (await response.json()) as { session?: { provider?: string; agentSessionId?: string } };
        if (data.session?.agentSessionId) {
          setAgentSessionId(data.session.agentSessionId);
        }
        if (data.session?.provider) {
          setSessionProvider(data.session.provider);
        }
        return true;
      } catch {
        setStatus(tRef.current.statusGatewayRestarting);
        return false;
      }
    };

    const reconnectDelay = () =>
      Math.min(5000, [1000, 2000, 3000, 5000][Math.min(reconnectAttempt, 3)]);

    const scheduleReconnect = () => {
      if (disposed || reconnectStopped) {
        return;
      }
      replayComplete = false;
      socket.current = undefined;
      setIsReady(false);
      setStatus(tRef.current.statusReconnecting);
      reconnectAttempt += 1;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connectStream(true).catch((error: unknown) => {
          if (disposed) {
            return;
          }
          if (reconnectStopped) {
            setStatus(error instanceof Error ? error.message : tRef.current.statusSessionDetached);
            setIsReady(true);
            return;
          }
          setStatus(tRef.current.statusGatewayRestarting);
          scheduleReconnect();
        });
      }, reconnectDelay());
    };

    const openStreamWebSocket = async (): Promise<WebSocket> => {
      if (connectionSettings.connectionMode === 'relay') {
        return new WebSocket(
          buildRelayClientUrl(
            connectionSettings.relayUrl,
            tRef.current.fillRelayUrl,
            tRef.current.relayProtocolInvalid
          )
        );
      }
      const { ticket } = await requestGatewayWsTicket({ sessionId, mode: 'control' });
      const streamQuery = `after=${after}&surface=web&mode=control`;
      return new WebSocket(buildGatewayStreamUrl(sessionId, streamQuery), [
        `tether-ticket.${ticket}`
      ]);
    };

    const connectStream = async (isReconnect = false) => {
      closeWasExpected = false;
      if (isReconnect) {
        setStatus(tRef.current.statusGatewayRestarting);
        const canReconnect = await probeGatewaySession();
        if (!canReconnect) {
          throw new Error(
            reconnectStopped ? tRef.current.statusSessionDetached : tRef.current.statusGatewayRestarting
          );
        }
      }
      await replayEvents();
      const nextWs = await openStreamWebSocket();
      ws = nextWs;
      socket.current = nextWs;

      nextWs.addEventListener('open', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        if (connectionSettings.connectionMode === 'relay') {
          setStatus(tRef.current.statusRelayAuth);
          nextWs.send(
            JSON.stringify(
              normalAuth?.accessToken
                ? { type: 'client.auth', token: normalAuth.accessToken }
                : { type: 'client.auth', secret: connectionSettings.relaySecret }
            )
          );
          return;
        }
        setStatus(tRef.current.statusSyncingWs);
        reconnectAttempt = 0;
      });

      nextWs.addEventListener('message', (message) => {
        if (disposed || socket.current !== ws) {
          return;
        }
        const parsedFrame = parseWsFrame(message.data);
        if (!parsedFrame || typeof parsedFrame.type !== 'string') {
          setStatus(tRef.current.statusStreamBadFrame);
          nextWs.close();
          return;
        }
        if (connectionSettings.connectionMode === 'relay') {
          const frame = parsedFrame as RelayServerToClientFrame;
          if (frame.type === 'client.auth.ok') {
            setStatus(`${tRef.current.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
            reconnectAttempt = 0;
            nextWs.send(
              JSON.stringify({
                type: 'client.subscribe',
                sessionId,
                after,
                mode: 'control',
                cols: RELAY_VIRTUAL_COLS,
                rows: RELAY_VIRTUAL_ROWS
              })
            );
            return;
          }
          if (frame.type === 'client.auth.failed') {
            reconnectStopped = true;
            logoutNormal();
            setStatus(displayMessage(frame.message, tRef.current));
            nextWs.close();
            return;
          }
          if (frame.type === 'hello') {
            setStatus(`${tRef.current.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
            return;
          }
          if (frame.type === 'error') {
            setStatus(displayMessage(frame.message, tRef.current));
            return;
          }
          if (frame.type === 'replay.done') {
            if (frame.sessionId !== sessionId) {
              return;
            }
            replayComplete = true;
            after = Math.max(after, frame.latestEventId);
            setIsReady(true);
            return;
          }
          if (frame.type === 'event') {
            handleEvent(frame.event);
          }
          return;
        }
        const frame = parsedFrame as StreamFrame;
        if (frame.type === 'hello') {
          setStatus(`${tRef.current.streamClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
          return;
        }
        if (frame.type === 'error') {
          setStatus(displayMessage(frame.message, tRef.current));
          return;
        }
        if (frame.type === 'replay.done') {
          replayComplete = true;
          setIsReady(true);
          return;
        }
        if (frame.type === 'event') {
          handleEvent(frame.event);
          if (frame.event.type === 'session.exited') {
            closeWasExpected = true;
            nextWs.close();
          }
        }
      });

      nextWs.addEventListener('close', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        if (closeWasExpected) {
          setAgentRuntimeStatus('exited');
          setStatus(tRef.current.statusExited);
          return;
        }
        scheduleReconnect();
      });

      nextWs.addEventListener('error', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        setStatus(tRef.current.statusStreamError);
      });
    };

    void refreshConversation();
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : tRef.current.statusStreamUnavailable);
        setIsReady(true);
        scheduleReconnect();
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket.current = undefined;
      if (connectionSettings.connectionMode === 'relay' && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'client.detach', sessionId }));
      }
      ws?.close();
    };
  }, [
    connectionSettings.connectionMode,
    connectionSettings.relaySecret,
    connectionSettings.relayUrl,
    logoutNormal,
    normalAuth?.accessToken,
    refreshConversation,
    sessionId
  ]);

  const sendChat = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      sendChatText(inputText);
    },
    [inputText, sendChatText]
  );

  const inputTextValue = inputText.trim();
  const isSessionClosed = agentRuntimeStatus === 'exited' || agentRuntimeStatus === 'disconnected';
  const composerDisabledReason = isSessionClosed
    ? t.composerDisabledSessionClosed
    : isSending
      ? t.composerDisabledSending
      : undefined;
  const isComposerInputDisabled = Boolean(composerDisabledReason);
  const isComposerSubmitDisabled = isComposerInputDisabled || inputTextValue.length === 0;
  const composerSubmitTitle = composerDisabledReason ?? (inputTextValue.length === 0 ? t.composerDisabledEmpty : t.agentChatSend);
  const composerPlaceholder =
    agentRuntimeStatus === 'submitted' || agentRuntimeStatus === 'running' || agentRuntimeStatus === 'responding'
      ? t.composerPlaceholderThinking
      : t.sendToAgent;
  const isAgentThinking =
    agentRuntimeStatus === 'submitted' || agentRuntimeStatus === 'running' || agentRuntimeStatus === 'responding';

  return (
    <div className="session-detail-page">
      <SessionDetailHeader
        sessionId={sessionId}
        connectionMode={connectionSettings.connectionMode}
        status={status}
        provider={sessionProvider}
        agentSessionId={agentSessionId}
      >
        <Button asChild variant="outline" size="sm" type="button">
          <Link to={`/remote/session/${encodeURIComponent(sessionId)}`}>
            <TerminalSquare aria-hidden="true" />
            {t.terminalView}
          </Link>
        </Button>
      </SessionDetailHeader>
      <div ref={chatScrollRef} className="chat-panel">
        {!isReady && chatMessages.length === 0 ? (
          <TerminalSurfaceSkeleton />
        ) : null}
        {chatMessages.map((msg, index) => {
          const previous = index > 0 ? chatMessages[index - 1] : undefined;
          const folded = previous?.role === msg.role;
          const status = (msg.status ?? 'delivered') as ChatMessageStatus;
          if (msg.role === 'user') {
            return (
              <ChatBubble
                key={msg.id}
                role="user"
                folded={folded}
                status={status}
                onRetry={
                  status === 'failed'
                    ? () => {
                        setChatMessages((prev) => prev.filter((item) => item.id !== msg.id));
                        void sendChatText(msg.content);
                      }
                    : undefined
                }
              >
                {msg.content}
              </ChatBubble>
            );
          }
          return (
            <ChatBubble
              key={msg.id}
              role="assistant"
              folded={folded}
              provider={sessionProvider}
              rawContent={msg.content}
            >
              {msg.content ? <ChatMarkdown content={msg.content} /> : null}
              {msg.tools.length > 0 ? (
                <div className="chat-tool-chips">
                  {msg.tools.map((tool, toolIndex) => (
                    <span key={`${msg.id}-tool-${toolIndex}`} className="chat-tool-chip">
                      <span className="chat-tool-chip-name">{tool.name}</span>
                      {tool.inputSummary ? (
                        <span className="chat-tool-chip-args">{tool.inputSummary}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </ChatBubble>
          );
        })}
        {typingVisible ? (
          <ChatBubble
            role="assistant"
            folded={chatMessages[chatMessages.length - 1]?.role === 'assistant'}
            provider={sessionProvider}
          >
            <span className="chat-typing-dots" aria-label={t.agentTypingIndicator}>
              <span />
              <span />
              <span />
            </span>
          </ChatBubble>
        ) : null}
        {unreadCount > 0 ? (
          <button
            type="button"
            className="chat-scroll-fab"
            onClick={scrollToBottom}
            title={t.chatScrollToLatest}
          >
            <span aria-hidden="true">↓</span>
            {unreadCount} {t.chatNewMessages}
          </button>
        ) : null}
      </div>
      {selectOptions.length > 0 ? (
        <div className="px-4 pb-2">
          <p className="mb-2 text-sm text-foreground">{t.agentSelectPrompt}</p>
          {selectRaw ? <pre className="mb-2 whitespace-pre-wrap rounded-md border border-input bg-card p-2 text-xs text-foreground">{selectRaw}</pre> : null}
          <div className="flex flex-wrap gap-2">
            {selectOptions.map((opt) => (
              <Button key={`${opt.index}-${opt.label}`} type="button" variant="outline" size="sm" onClick={() => sendChatText(String(opt.index))}>
                {opt.index}. {opt.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <form className="composer-form" onSubmit={sendChat}>
        <Textarea
          className={`composer-input${isAgentThinking ? ' composer-input-thinking' : ''}`}
          rows={1}
          autoComplete="off"
          placeholder={composerPlaceholder}
          value={inputText}
          disabled={isComposerInputDisabled}
          onChange={(event) => setInputText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) {
              return;
            }
            const composing =
              event.nativeEvent.isComposing ||
              (event as unknown as { keyCode?: number }).keyCode === 229;
            if (composing) {
              return;
            }
            event.preventDefault();
            sendChatText(inputText);
          }}
        />
        <div className="composer-actions">
          <span className={`composer-status${isAgentThinking ? ' composer-status-thinking' : ''}`} title={composerSubmitTitle}>
            {isAgentThinking ? t.agentTypingIndicator : status}
          </span>
          <Button
            type="button"
            size="sm"
            className="composer-submit"
            disabled={isComposerSubmitDisabled}
            title={composerSubmitTitle}
            onClick={() => sendChatText(inputText)}
          >
            {t.agentChatSend}
          </Button>
        </div>
      </form>
    </div>
  );
}
