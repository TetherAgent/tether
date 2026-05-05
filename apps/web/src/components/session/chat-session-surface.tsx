import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TerminalSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button, Textarea } from '@tether/design';

import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { gatewayAuthHeaders, requestGatewayWsTicket } from '../../lib/api.js';
import { SessionDetailHeader, TerminalSurfaceSkeleton } from './session-detail-chrome.js';

type ConnectionMode = 'direct' | 'relay';

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
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; tools: ToolInfo[] };
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
const genId = () => Math.random().toString(36).slice(2);

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

type WebMessages = ReturnType<typeof useI18n>['t'];

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
  const [fallbackVisible, setFallbackVisible] = React.useState(false);
  const [status, setStatus] = React.useState<string>(t.statusConnecting);
  const [isReady, setIsReady] = React.useState(false);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(locationState?.agentSessionId);
  const [sessionProvider, setSessionProvider] = React.useState<string | undefined>(locationState?.provider);

  const socket = React.useRef<WebSocket | undefined>(undefined);
  const chatScrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setFallbackVisible(true);
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [sessionId]);

  React.useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, typingVisible, selectOptions, fallbackVisible]);

  const sendChatText = React.useCallback(
    (value: string) => {
      const nextValue = value.trim();
      if (!nextValue) {
        return;
      }
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus(t.statusWsUnavailable);
        return;
      }
      setChatMessages((prev) => [...prev, { id: genId(), role: 'user', content: nextValue, tools: [] }]);
      setSelectOptions([]);
      setSelectRaw('');
      ws.send(JSON.stringify(
        connectionSettings.connectionMode === 'relay'
          ? { type: 'client.chat', sessionId, message: nextValue }
          : { type: 'chat', message: nextValue }
      ));
      setInputText('');
    },
    [connectionSettings.connectionMode, sessionId, t]
  );

  React.useEffect(() => {
    let disposed = false;
    let replayComplete = false;
    let reconnectAttempt = 0;
    let reconnectStopped = false;
    let closeWasExpected = false;
    let reconnectTimer: number | undefined;
    let ws: WebSocket | undefined;
    let after = Number(window.localStorage.getItem(`tether:${sessionId}:latestEventId`) ?? 0);

    const handleEvent = (event: SessionEvent) => {
      if (event.id <= after) {
        return;
      }
      window.localStorage.setItem(`tether:${sessionId}:latestEventId`, String(event.id));
      after = Math.max(after, event.id);

      if (event.type === 'agent.turn') {
        setFallbackVisible(false);
        const turn = event.payload as { role?: string; content?: string; tools?: ToolInfo[] };
        setChatMessages((prev) => [...prev, {
          id: genId(),
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: typeof turn.content === 'string' ? turn.content : '',
          tools: Array.isArray(turn.tools) ? turn.tools : []
        }]);
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
        setStatus(t.statusExited);
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
        reconnectStopped = true;
        throw new Error(t.statusSessionDetached);
      }
      if (!response.ok) {
        throw new Error(`events HTTP ${response.status}`);
      }
      const data = (await response.json()) as { events: SessionEvent[] };
      return data.events;
    };

    const replayEvents = async () => {
      if (connectionSettings.connectionMode === 'relay') {
        replayComplete = false;
        return;
      }
      setStatus(t.statusReplaying);
      let keepLoading = true;
      while (!disposed && keepLoading) {
        const beforePageCursor = after;
        const events = await fetchReplayPage(`after=${after}&limit=${FULL_REPLAY_EVENT_PAGE_LIMIT}`);
        for (const event of events) {
          handleEvent(event);
        }
        keepLoading = events.length === FULL_REPLAY_EVENT_PAGE_LIMIT && after > beforePageCursor;
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
          setStatus(t.statusSessionDetached);
          setIsReady(true);
          return false;
        }
        if (!response.ok) {
          setStatus(t.statusGatewayRestarting);
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
        setStatus(t.statusGatewayRestarting);
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
      setStatus(t.statusReconnecting);
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
            setStatus(error instanceof Error ? error.message : t.statusSessionDetached);
            setIsReady(true);
            return;
          }
          setStatus(t.statusGatewayRestarting);
          scheduleReconnect();
        });
      }, reconnectDelay());
    };

    const openStreamWebSocket = async (): Promise<WebSocket> => {
      if (connectionSettings.connectionMode === 'relay') {
        return new WebSocket(
          buildRelayClientUrl(
            connectionSettings.relayUrl,
            t.fillRelayUrl,
            t.relayProtocolInvalid
          )
        );
      }
      const { ticket } = await requestGatewayWsTicket({ sessionId, mode: 'control' });
      const streamQuery = `after=${after}&surface=web&mode=control`;
      return new WebSocket(buildGatewayStreamUrl(sessionId, streamQuery), [
        `tether-ticket.${ticket}`
      ]);
    };

    const loadHistory = async () => {
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
        setChatMessages(
          data.turns.map((turn) => ({
            id: genId(),
            role: turn.role,
            content: turn.content,
            tools: turn.tools ? (JSON.parse(turn.tools) as ToolInfo[]) : []
          }))
        );
      } catch {
        // wait for websocket events
      }
    };

    const connectStream = async (isReconnect = false) => {
      closeWasExpected = false;
      if (isReconnect) {
        setStatus(t.statusGatewayRestarting);
        const canReconnect = await probeGatewaySession();
        if (!canReconnect) {
          throw new Error(
            reconnectStopped ? t.statusSessionDetached : t.statusGatewayRestarting
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
          setStatus(t.statusRelayAuth);
          nextWs.send(
            JSON.stringify(
              normalAuth?.accessToken
                ? { type: 'client.auth', token: normalAuth.accessToken }
                : { type: 'client.auth', secret: connectionSettings.relaySecret }
            )
          );
          return;
        }
        setStatus(t.statusSyncingWs);
        reconnectAttempt = 0;
      });

      nextWs.addEventListener('message', (message) => {
        if (disposed || socket.current !== ws) {
          return;
        }
        const parsedFrame = parseWsFrame(message.data);
        if (!parsedFrame || typeof parsedFrame.type !== 'string') {
          setStatus(t.statusStreamBadFrame);
          nextWs.close();
          return;
        }
        if (connectionSettings.connectionMode === 'relay') {
          const frame = parsedFrame as RelayServerToClientFrame;
          if (frame.type === 'client.auth.ok') {
            setStatus(`${t.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
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
            setStatus(displayMessage(frame.message, t));
            nextWs.close();
            return;
          }
          if (frame.type === 'hello') {
            setStatus(`${t.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
            return;
          }
          if (frame.type === 'error') {
            setStatus(displayMessage(frame.message, t));
            return;
          }
          if (frame.type === 'replay.done') {
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
          setStatus(`${t.streamClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
          return;
        }
        if (frame.type === 'error') {
          setStatus(displayMessage(frame.message, t));
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
          setStatus(t.statusExited);
          return;
        }
        scheduleReconnect();
      });

      nextWs.addEventListener('error', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        setStatus(t.statusStreamError);
      });
    };

    void loadHistory();
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : t.statusStreamUnavailable);
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
    sessionId,
    t
  ]);

  const sendChat = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      sendChatText(inputText);
    },
    [inputText, sendChatText]
  );

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
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble-${msg.role === 'assistant' ? 'agent' : 'user'}`}>
            <div className="chat-bubble-content">
              {msg.role === 'assistant' ? (
                <div className="space-y-2">
                  {msg.content ? <ReactMarkdown>{msg.content}</ReactMarkdown> : null}
                  {msg.tools.map((tool, index) => (
                    <span key={`${msg.id}-tool-${index}`} className="inline-flex rounded-full border border-input px-2 py-0.5 text-xs text-foreground">
                      {t.agentToolChip} · {tool.name}
                    </span>
                  ))}
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {typingVisible ? (
          <div className="chat-bubble chat-bubble-agent">
            <div className="chat-bubble-content">{t.agentTypingIndicator}</div>
          </div>
        ) : null}
        {fallbackVisible ? (
          <div className="chat-bubble chat-bubble-agent">
            <div className="chat-bubble-content">{t.agentFallbackHint}</div>
          </div>
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
          className="composer-input"
          rows={1}
          autoComplete="off"
          placeholder={t.sendToAgent}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
        />
        <Button type="submit">{t.agentChatSend}</Button>
      </form>
    </div>
  );
}
