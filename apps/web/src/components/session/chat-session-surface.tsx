import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Bot, Check, ChevronDown, Copy, MessageSquare, Moon, Send, Sun, TerminalSquare } from 'lucide-react';
import { Button, Textarea } from '@tether/design';

import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { gatewayAuthHeaders, readGatewayData, requestGatewayWsTicket } from '../../lib/api.js';
import { ChatBubble, ChatThinkingBubble } from './chat-bubble.js';
import { ChatMarkdown } from './chat-markdown.js';
import { TerminalSurfaceSkeleton } from './session-detail-chrome.js';

type WebMessages = ReturnType<typeof useI18n>['t'];

export type ChatSessionSurfaceProps = {
  sessionId: string;
  connectionSettings: {
    relayUrl: string;
    relaySecret: string;
  };
  onConnectionSettingsChange: (settings: {
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

type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'conversation'; sessionId: string; turns: RelayConversationTurn[] }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };

type ToolInfo = { name: string; inputSummary: string };
type ChatMessageStatus = 'pending' | 'sent' | 'delivered' | 'failed';
type SelectOption = { index: number; label: string };
type SelectPayload = {
  options: SelectOption[];
  raw: string;
  selectedIndex?: number;
};
type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolInfo[];
  status?: ChatMessageStatus;
  selectPayload?: SelectPayload;
  createdAt?: number;
};
type AgentRuntimeStatus = 'idle' | 'submitted' | 'running' | 'responding' | 'done' | 'exited' | 'disconnected';
type ChatActivityState = 'idle' | 'submitted' | 'processing' | 'thinking' | 'responding' | 'waiting' | 'done';
type ConversationTurn = {
  id: number;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string;
  tools: string | null;
  createdAt: number;
};
type RelayConversationTurn = Omit<ConversationTurn, 'tools'> & {
  tools: ToolInfo[];
};

const RELAY_VIRTUAL_COLS = 200;
const RELAY_VIRTUAL_ROWS = 50;
const CHAT_ENTER_DELAY_MS = 120;
const PENDING_TIMEOUT_MS = 5000;
const SCROLL_FOLLOW_THRESHOLD_PX = 80;
const TIME_SEPARATOR_GAP_MS = 5 * 60 * 1000;

function formatTimeSeparator(ts: number, locale: 'zh' | 'en'): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(d);
  if (sameDay) {
    return time;
  }
  const date = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric'
  }).format(d);
  return `${date} ${time}`;
}

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
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildGatewayStreamUrl(sessionId: string, query: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/server/sessions/${encodeURIComponent(sessionId)}/stream?${query}`;
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
    case 'PTY session is no longer running':
    case 'pty session is no longer running':
    case 'session runner no longer has a live PTY':
      return t.sessionEnded;
    default:
      return message;
  }
}

function isThinkingStatus(status: AgentRuntimeStatus): boolean {
  return status === 'responding';
}

function ChatToolCard({ tool, completedLabel }: { tool: ToolInfo; completedLabel: string }) {
  return (
    <div className="chat-tool-card chat-tool-card-ok">
      <div className="chat-tool-head">
        <span className="chat-tool-icon" aria-hidden="true">
          <Check />
        </span>
        <span className="chat-tool-name">{tool.name}</span>
        {tool.inputSummary ? <span className="chat-tool-args">{tool.inputSummary}</span> : null}
        <span className="chat-tool-meta">{completedLabel}</span>
        <ChevronDown className="chat-tool-chev" aria-hidden="true" />
      </div>
    </div>
  );
}

export function ChatSessionSurface({ sessionId, connectionSettings }: ChatSessionSurfaceProps) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t, locale } = useI18n();
  const { isDark, toggleTheme } = useUiPreferences();
  const location = useLocation();
  const locationState = location.state as { agentSessionId?: string; provider?: string } | null;

  const draftKey = `tether:draft:${sessionId}`;
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [typingVisible, setTypingVisible] = React.useState(false);
  const [inputText, setInputText] = React.useState<string>(() => {
    try {
      return sessionStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  });
  const historyIndexRef = React.useRef<number | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const userHistory = React.useMemo(
    () =>
      chatMessages
        .filter((m) => m.role === 'user' && !m.id.startsWith('pending:') && m.status !== 'failed')
        .map((m) => m.content),
    [chatMessages]
  );
  const [status, setStatus] = React.useState<string>(t.statusConnecting);
  const [agentRuntimeStatus, setAgentRuntimeStatus] = React.useState<AgentRuntimeStatus>('idle');
  const [activityState, setActivityState] = React.useState<ChatActivityState>('idle');
  const [isReady, setIsReady] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(locationState?.agentSessionId);
  const [sessionProvider, setSessionProvider] = React.useState<string | undefined>(locationState?.provider);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [connectionHealth, setConnectionHealth] = React.useState<
    'connecting' | 'ok' | 'reconnecting' | 'detached'
  >('connecting');
  const [reconnectKey, setReconnectKey] = React.useState(0);
  const triggerReconnect = React.useCallback(() => {
    setReconnectKey((k) => k + 1);
  }, []);

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
  }, [typingVisible]);

  const scrollToBottom = React.useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    isNearBottomRef.current = true;
    setUnreadCount(0);
  }, []);

  React.useEffect(() => {
    try {
      if (inputText) {
        sessionStorage.setItem(draftKey, inputText);
      } else {
        sessionStorage.removeItem(draftKey);
      }
    } catch {
      // ignore (private mode / storage full)
    }
  }, [draftKey, inputText]);

  // Auto-grow composer for browsers that don't honor `field-sizing: content`.
  React.useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const supportsFieldSizing =
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
        ? CSS.supports('field-sizing: content')
        : false;
    if (supportsFieldSizing) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [inputText]);

  // Tab-title unread counter for assistant replies that arrive while the page is hidden.
  const [tabUnread, setTabUnread] = React.useState(0);
  const lastSeenAssistantIdRef = React.useRef<string | null>(null);
  const baseTitleRef = React.useRef<string>('');
  React.useEffect(() => {
    baseTitleRef.current = document.title.replace(/^\(\d+\)\s*/, '');
  }, []);
  React.useEffect(() => {
    const lastAssistant = [...chatMessages]
      .reverse()
      .find((m) => m.role === 'assistant' && !m.selectPayload);
    if (!lastAssistant) return;
    if (lastSeenAssistantIdRef.current === null) {
      lastSeenAssistantIdRef.current = lastAssistant.id;
      return;
    }
    if (lastAssistant.id !== lastSeenAssistantIdRef.current) {
      lastSeenAssistantIdRef.current = lastAssistant.id;
      if (document.hidden) {
        setTabUnread((n) => n + 1);
      }
    }
  }, [chatMessages]);
  React.useEffect(() => {
    const base = baseTitleRef.current || document.title.replace(/^\(\d+\)\s*/, '');
    document.title = tabUnread > 0 ? `(${tabUnread}) ${base}` : base;
  }, [tabUnread]);
  React.useEffect(() => {
    const handler = () => {
      if (!document.hidden) {
        setTabUnread(0);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const refreshConversation = React.useCallback(async () => {
    try {
      const response = await gatewayRequest(`/api/server/sessions/${encodeURIComponent(sessionId)}/conversation`);
      if (response.status === 401) {
        logoutNormal();
        return;
      }
      if (!response.ok) {
        return;
      }
      const data = await readGatewayData<{ turns: Array<ConversationTurn | RelayConversationTurn> }>(response);
      setChatMessages((prev) => {
        let next = prev;
        for (const turn of data.turns) {
          const tools = Array.isArray(turn.tools)
            ? turn.tools
            : turn.tools
              ? (JSON.parse(turn.tools) as ToolInfo[])
              : [];
          next = upsertChatMessage(next, {
            id: `turn:${turn.turnIndex}`,
            role: turn.role,
            content: turn.content,
            tools,
            createdAt: turn.createdAt
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

  const sendInputFrame = React.useCallback(
    (data: string): boolean => {
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return false;
      }
      ws.send(JSON.stringify({ type: 'client.input', sessionId, data }));
      return true;
    },
    [sessionId]
  );

  const cancelGeneration = React.useCallback(() => {
    sendInputFrame('\x03');
  }, [sendInputFrame]);

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
          status: 'pending',
          createdAt: Date.now()
        }
      ]);
      setInputText('');
      historyIndexRef.current = null;
      setIsSending(true);
      try {
        if (!sendInputFrame(wireValue)) {
          updateMessageStatus(localId, 'failed', (m) => m.status !== 'delivered');
          setStatus(t.statusWsUnavailable);
          return;
        }
        await wait(CHAT_ENTER_DELAY_MS);
        if (!sendInputFrame('\r')) {
          updateMessageStatus(localId, 'failed', (m) => m.status !== 'delivered');
          setStatus(t.statusWsUnavailable);
          return;
        }
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
    [agentRuntimeStatus, isSending, sendInputFrame, t, updateMessageStatus]
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

    const clearActivity = () => {
      setTypingVisible(false);
      setActivityState('done');
    };

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
          const nextStatus = event.payload.status;
          setAgentRuntimeStatus(nextStatus);
          if (nextStatus === 'submitted') {
            setActivityState('submitted');
          } else if (nextStatus === 'running') {
            setActivityState((current) => current === 'thinking' || current === 'responding' ? current : 'processing');
          } else if (nextStatus === 'responding') {
            setActivityState('responding');
          } else if (nextStatus === 'done' || nextStatus === 'idle') {
            setActivityState('done');
          } else if (nextStatus === 'exited' || nextStatus === 'disconnected') {
            setActivityState('done');
          }
        }
        const label = agentStatusLabel(event.payload.status, tRef.current);
        if (label) {
          setStatus(label);
        }
        return;
      }

      if (event.type === 'agent.turn') {
        const turn = event.payload as {
          role?: string;
          content?: string;
          tools?: ToolInfo[];
          turnIndex?: number;
          createdAt?: number;
        };
        const message: ChatMessage = {
          id: typeof turn.turnIndex === 'number' ? `turn:${turn.turnIndex}` : `event:${event.id}`,
          role: turn.role === 'user' ? 'user' : 'assistant',
          content: typeof turn.content === 'string' ? turn.content : '',
          tools: Array.isArray(turn.tools) ? turn.tools : [],
          createdAt: turn.createdAt ?? Date.now()
        };
        setChatMessages((prev) => upsertChatMessage(prev, message));
        if (message.role === 'assistant') {
          setTypingVisible(false);
          setActivityState('done');
          setAgentRuntimeStatus('done');
        } else {
          setActivityState('submitted');
        }
        return;
      }
      if (event.type === 'agent.typing') {
        setTypingVisible(true);
        setActivityState('thinking');
        setAgentRuntimeStatus('responding');
        return;
      }
      if (event.type === 'terminal.output') {
        setActivityState((current) => current === 'thinking' || current === 'responding' ? current : 'processing');
        return;
      }
      if (event.type === 'agent.select') {
        const payload = event.payload as { options?: SelectOption[]; raw?: string };
        const options = Array.isArray(payload.options) ? payload.options : [];
        const raw = typeof payload.raw === 'string' ? payload.raw : '';
        setChatMessages((prev) => [
          ...prev,
          {
            id: `select:${event.id}`,
            role: 'assistant',
            content: '',
            tools: [],
            createdAt: Date.now(),
            selectPayload: { options, raw }
          }
        ]);
        return;
      }
      if (event.type === 'session.exited') {
        setAgentRuntimeStatus('exited');
        clearActivity();
        setStatus(tRef.current.statusExited);
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
      setConnectionHealth('reconnecting');
      setAgentRuntimeStatus('disconnected');
      clearActivity();
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
            setConnectionHealth('detached');
            setAgentRuntimeStatus('disconnected');
            clearActivity();
            return;
          }
          setStatus(tRef.current.statusGatewayRestarting);
          scheduleReconnect();
        });
      }, reconnectDelay());
    };

    const openStreamWebSocket = (): WebSocket => {
      return new WebSocket(
        buildRelayClientUrl(
          connectionSettings.relayUrl,
          tRef.current.fillRelayUrl,
          tRef.current.relayProtocolInvalid
        )
      );
    };

    const connectStream = async (isReconnect = false) => {
      closeWasExpected = false;
      if (isReconnect) {
        setStatus(tRef.current.statusGatewayRestarting);
        if (reconnectStopped) {
          throw new Error(tRef.current.statusSessionDetached);
        }
      }
      const nextWs = await openStreamWebSocket();
      ws = nextWs;
      socket.current = nextWs;

      nextWs.addEventListener('open', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        setStatus(tRef.current.statusRelayAuth);
        nextWs.send(
          JSON.stringify(
            normalAuth?.accessToken
              ? { type: 'client.auth', token: normalAuth.accessToken }
              : { type: 'client.auth', secret: connectionSettings.relaySecret }
          )
        );
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
        {
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
            setConnectionHealth('detached');
            setAgentRuntimeStatus('disconnected');
            clearActivity();
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
            setConnectionHealth('ok');
            return;
          }
          if (frame.type === 'event') {
            handleEvent(frame.event);
          }
        }
      });

      nextWs.addEventListener('close', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        if (closeWasExpected) {
          setAgentRuntimeStatus('exited');
          clearActivity();
          setStatus(tRef.current.statusExited);
          return;
        }
        scheduleReconnect();
      });

      nextWs.addEventListener('error', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        setAgentRuntimeStatus('disconnected');
        clearActivity();
        setStatus(tRef.current.statusStreamError);
      });
    };

    if (normalAuth?.accessToken) {
      void refreshConversation();
    }
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : tRef.current.statusStreamUnavailable);
        setIsReady(true);
        setAgentRuntimeStatus('disconnected');
        clearActivity();
        scheduleReconnect();
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket.current = undefined;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'client.detach', sessionId }));
      }
      ws?.close();
    };
  }, [
    connectionSettings.relaySecret,
    connectionSettings.relayUrl,
    logoutNormal,
    normalAuth?.accessToken,
    reconnectKey,
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
  const isAgentThinking = activityState === 'thinking' || activityState === 'responding' || isThinkingStatus(agentRuntimeStatus);
  const isAgentProcessing = activityState === 'submitted' || activityState === 'processing';
  const hasConnectionProblem = connectionHealth === 'reconnecting' || connectionHealth === 'detached';
  const showActivityBubble = !hasConnectionProblem && (isAgentThinking || isAgentProcessing);
  const activityBubbleMode = isAgentThinking ? 'thinking' : activityState === 'submitted' ? 'waiting' : 'processing';
  const composerPlaceholder = isAgentThinking ? t.composerPlaceholderThinking : t.sendToAgent;
  const headerStatus = connectionHealth === 'detached'
    ? t.statusSessionDetached
    : connectionHealth === 'reconnecting'
      ? t.statusReconnecting
      : isAgentThinking
        ? t.chatThinking
        : isAgentProcessing
          ? t.chatProcessing
          : status;

  return (
    <div className="session-detail-page chat-session-page">
      <header className="chat-header">
        <Button asChild variant="ghost" size="icon" type="button" className="chat-icon-button" title={t.backToSessions}>
          <Link to="/sessions">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <button
          type="button"
          className="chat-header-title"
          onClick={() => {
            void navigator.clipboard?.writeText(sessionId).catch(() => setStatus(t.clipboardWriteFailed));
          }}
          title={t.sessionIdLabel}
        >
          {sessionId}
          <Copy aria-hidden="true" />
        </button>
        <div className="chat-header-meta">
          <span className={`chat-chip${showActivityBubble ? ' chat-chip-running' : ''}`}>
            {showActivityBubble ? <span className="chat-chip-dot" aria-hidden="true" /> : null}
            {headerStatus}
          </span>
          {sessionProvider ? (
            <span className="chat-chip chat-provider-chip">
              <Bot aria-hidden="true" />
              {sessionProvider}
            </span>
          ) : null}
          <div className="chat-view-toggle" aria-label={t.currentMode}>
            <Button asChild variant="ghost" size="sm" type="button">
              <Link to={`/remote/session/${encodeURIComponent(sessionId)}`}>
                <TerminalSquare aria-hidden="true" />
                {t.terminalView}
              </Link>
            </Button>
            <Button variant="secondary" size="sm" type="button">
              <MessageSquare aria-hidden="true" />
              {t.chatView}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="chat-icon-button"
            aria-label={`${t.themeLabel}: ${isDark ? t.light : t.dark}`}
            title={`${t.themeLabel}: ${isDark ? t.light : t.dark}`}
            onClick={toggleTheme}
          >
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </div>
      </header>
      {agentSessionId ? (
        <div className="chat-session-subtitle">
          {t.agentSessionLabel}: {agentSessionId}
        </div>
      ) : null}
      {connectionHealth === 'reconnecting' || connectionHealth === 'detached' ? (
        <div className={`chat-error-banner chat-error-banner-${connectionHealth}`} role="alert">
          <span>
            {connectionHealth === 'reconnecting'
              ? t.chatErrorReconnect
              : t.statusSessionDetached}
          </span>
          {connectionHealth === 'reconnecting' ? (
            <button type="button" className="chat-error-banner-action" onClick={triggerReconnect}>
              {t.chatErrorReconnectNow}
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={chatScrollRef}
        className="chat-panel"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={t.chatLogLabel}
      >
        {!isReady && chatMessages.length === 0 ? (
          <TerminalSurfaceSkeleton />
        ) : null}
        {chatMessages.map((msg, index) => {
          const previous = index > 0 ? chatMessages[index - 1] : undefined;
          const folded = previous?.role === msg.role && !msg.selectPayload && !previous?.selectPayload;
          const status = (msg.status ?? 'delivered') as ChatMessageStatus;
          const showSeparator =
            !previous ||
            (typeof msg.createdAt === 'number' &&
              typeof previous.createdAt === 'number' &&
              msg.createdAt - previous.createdAt > TIME_SEPARATOR_GAP_MS);
          const separator =
            showSeparator && typeof msg.createdAt === 'number' ? (
              <div key={`sep:${msg.id}`} className="chat-time-sep" role="separator">
                {formatTimeSeparator(msg.createdAt, locale)}
              </div>
            ) : null;

          if (msg.selectPayload) {
            return (
              <React.Fragment key={msg.id}>
                {separator}
                <ChatBubble role="assistant" folded={false} provider={sessionProvider}>
                  {msg.content ? <ChatMarkdown content={msg.content} /> : null}
                  {msg.selectPayload.raw ? (
                    <pre className="chat-select-raw">{msg.selectPayload.raw}</pre>
                  ) : null}
                  <div className="chat-select-options">
                    {msg.selectPayload.options.map((opt) => {
                      const isSelected = msg.selectPayload?.selectedIndex === opt.index;
                      return (
                        <button
                          key={`${msg.id}-opt-${opt.index}`}
                          type="button"
                          className={`chat-select-option${isSelected ? ' chat-select-option-selected' : ''}`}
                          onClick={() => {
                            setChatMessages((prev) =>
                              prev.map((item) =>
                                item.id === msg.id && item.selectPayload
                                  ? {
                                      ...item,
                                      selectPayload: { ...item.selectPayload, selectedIndex: opt.index }
                                    }
                                  : item
                              )
                            );
                            void sendChatText(String(opt.index));
                          }}
                        >
                          <span className="chat-select-num">{opt.index}</span>
                          <span>{opt.label}</span>
                          {isSelected ? (
                            <span className="chat-select-tag">{t.chatSelectSelected}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </ChatBubble>
              </React.Fragment>
            );
          }

          if (msg.role === 'user') {
            return (
              <React.Fragment key={msg.id}>
                {separator}
                <ChatBubble
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
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={msg.id}>
              {separator}
              <ChatBubble
                role="assistant"
                folded={folded}
                provider={sessionProvider}
              >
                {msg.tools.length > 0 ? (
                  <div className="chat-tool-cards">
                    {msg.tools.map((tool, toolIndex) => (
                      <ChatToolCard key={`${msg.id}-tool-${toolIndex}`} tool={tool} completedLabel={t.chatToolCompleted} />
                    ))}
                  </div>
                ) : null}
                {msg.content ? <ChatMarkdown content={msg.content} /> : null}
              </ChatBubble>
            </React.Fragment>
          );
        })}
        {typingVisible || showActivityBubble ? (
          <ChatThinkingBubble
            folded={chatMessages[chatMessages.length - 1]?.role === 'assistant'}
            provider={sessionProvider}
            onCancel={cancelGeneration}
            mode={activityBubbleMode}
          />
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
      <form className="composer-form chat-composer" onSubmit={sendChat}>
        <div className="chat-composer-row">
          <Textarea
            ref={composerRef}
            className={`composer-input${isAgentThinking ? ' composer-input-thinking' : ''}`}
            rows={1}
            autoComplete="off"
            placeholder={composerPlaceholder}
            value={inputText}
            disabled={isComposerInputDisabled}
            onChange={(event) => {
              setInputText(event.target.value);
              historyIndexRef.current = null;
            }}
            onKeyDown={(event) => {
              const composing =
                event.nativeEvent.isComposing ||
                (event as unknown as { keyCode?: number }).keyCode === 229;
              if (event.key === 'Enter' && !event.shiftKey) {
                if (composing) {
                  return;
                }
                event.preventDefault();
                sendChatText(inputText);
                return;
              }
              if (event.key === 'ArrowUp' && !inputText && !composing && userHistory.length > 0) {
                event.preventDefault();
                const idx =
                  historyIndexRef.current === null
                    ? userHistory.length - 1
                    : Math.max(0, historyIndexRef.current - 1);
                historyIndexRef.current = idx;
                setInputText(userHistory[idx]);
                return;
              }
              if (event.key === 'ArrowDown' && historyIndexRef.current !== null && !composing) {
                event.preventDefault();
                const next = historyIndexRef.current + 1;
                if (next >= userHistory.length) {
                  historyIndexRef.current = null;
                  setInputText('');
                } else {
                  historyIndexRef.current = next;
                  setInputText(userHistory[next]);
                }
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setInputText('');
                historyIndexRef.current = null;
                return;
              }
              if (event.key === 'Escape' && (typingVisible || isAgentThinking)) {
                event.preventDefault();
                cancelGeneration();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="composer-submit"
            disabled={isComposerSubmitDisabled}
            title={composerSubmitTitle}
            onClick={() => sendChatText(inputText)}
          >
            {t.agentChatSend}
            <Send aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  );
}
