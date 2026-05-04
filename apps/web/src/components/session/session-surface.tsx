import * as React from 'react';
import { Link } from 'react-router-dom';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Maximize2, Minimize2, Power } from 'lucide-react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@tether/design';

import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { gatewayAuthHeaders, requestGatewayWsTicket } from '../../lib/api.js';
import { SessionDetailHeader, TerminalSurfaceSkeleton } from './session-detail-chrome.js';

type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: string;
  transport?: string;
  lastActiveAt: number;
};

type Snapshot = {
  text: string;
  capturedAt: number;
  session?: Session;
};

type ClientMode = 'control' | 'observe';
type ConnectionMode = 'direct' | 'relay';
type ReplayMode = 'recent' | 'all';
type WebTransportMode = 'ws' | 'http';

type ConnectionSettings = {
  connectionMode: ConnectionMode;
  relayUrl: string;
  relaySecret: string;
};

type ClientInfo = {
  clientId: string;
  deviceName: string;
  surface: string;
  mode: ClientMode;
  attachedAt: number;
  lastSeenAt: number;
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
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };

type RelayClientToServerFrame =
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: ClientMode }
  | { type: 'client.stop'; sessionId: string };

const RECENT_REPLAY_EVENT_LIMIT = 100;
const FULL_REPLAY_EVENT_PAGE_LIMIT = 5000;
const WEB_TRANSPORT_KEY = 'tether:webTransportMode';
const WEB_CLIENT_MODE_KEY = 'tether:webClientMode';
const WEB_REPLAY_MODE_KEY = 'tether:webReplayMode';
const COMPOSER_ENTER_DELAY_MS = 40;
const TERMINAL_ENTER = '\r';

type WebMessages = ReturnType<typeof useI18n>['t'];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readWebTransportMode(): WebTransportMode {
  return window.localStorage.getItem(WEB_TRANSPORT_KEY) === 'http' ? 'http' : 'ws';
}

function readClientMode(): ClientMode {
  return window.localStorage.getItem(WEB_CLIENT_MODE_KEY) === 'observe' ? 'observe' : 'control';
}

function readReplayMode(): ReplayMode {
  return window.localStorage.getItem(WEB_REPLAY_MODE_KEY) === 'all' ? 'all' : 'recent';
}

function buildRelayClientUrl(relayUrl: string, t: WebMessages): string {
  const value = relayUrl.trim();
  if (!value) {
    throw new Error(t.fillRelayUrl);
  }
  const url = new URL(value);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(t.relayProtocolInvalid);
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

function sendRelayFrame(ws: WebSocket, frame: RelayClientToServerFrame): void {
  ws.send(JSON.stringify(frame));
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

function clientModeLabel(mode: ClientMode, t: WebMessages): string {
  return mode === 'observe' ? t.observe : t.control;
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
    case 'observer clients cannot resize':
      return t.observeCannotResize;
    default:
      return message;
  }
}

export type SessionSurfaceMode = 'control' | 'replay';

export type SessionSurfaceProps = {
  sessionId: string;
  surfaceMode: SessionSurfaceMode;
  connectionSettings: ConnectionSettings;
  onConnectionSettingsChange: (settings: ConnectionSettings) => void;
};

export function SessionSurface({
  sessionId,
  surfaceMode,
  connectionSettings,
  onConnectionSettingsChange
}: {
  sessionId: string;
  surfaceMode: 'control' | 'replay';
  connectionSettings: ConnectionSettings;
  onConnectionSettingsChange: (settings: ConnectionSettings) => void;
}) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ text: '', capturedAt: Date.now() });
  const [status, setStatus] = React.useState<string>(t.statusConnecting);
  const [text, setText] = React.useState('');
  const [transport, setTransport] = React.useState<string>();
  const scrollRef = React.useRef<HTMLElement>(null);

  const refresh = React.useCallback(async () => {
    if (connectionSettings.connectionMode === 'relay') {
      setTransport('pty-event-stream');
      setStatus(t.relay);
      return;
    }
    try {
      const scrollport = scrollRef.current;
      const wasNearBottom = scrollport
        ? scrollport.scrollTop + scrollport.clientHeight >= scrollport.scrollHeight - 48
        : true;
      const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`);
      if (response.status === 401) {
        logoutNormal();
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as Snapshot;
      setTransport(data.session?.transport);
      setSnapshot(data);
      setStatus(new Date(data.capturedAt).toLocaleTimeString());
      requestAnimationFrame(() => {
        if (wasNearBottom && scrollport) {
          scrollport.scrollTop = scrollport.scrollHeight;
        }
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusDisconnected);
    }
  }, [connectionSettings.connectionMode, logoutNormal, normalAuth?.accessToken, sessionId, t]);

  React.useEffect(() => {
    refresh();
    if (transport === 'pty-event-stream') {
      return undefined;
    }
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [refresh, transport]);

  if (transport === 'pty-event-stream') {
    return (
      <PtySessionView
        sessionId={sessionId}
        replayOnly={surfaceMode === 'replay'}
        initialStatus={status}
        connectionSettings={connectionSettings}
      />
    );
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    setStatus(t.statusSending);
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...gatewayAuthHeaders()
      },
      body: JSON.stringify({ text: value })
    });
    if (!response.ok) {
      if (response.status === 401) {
        logoutNormal();
      }
      setStatus(`${t.sendFailedPrefix}: ${t.httpStatusPrefix} ${response.status}`);
      setText(value);
      return;
    }
    await refresh();
  }

  const isSnapshotLoading = status === t.statusConnecting && snapshot.text.length === 0;

  return (
    <div className="session-detail-page">
      <SessionDetailHeader
        sessionId={sessionId}
        connectionMode={connectionSettings.connectionMode}
        status={status}
      />
      <main ref={scrollRef} className="scrollport terminal-panel" aria-label={t.terminalSurface}>
        {isSnapshotLoading ? <TerminalSurfaceSkeleton /> : <pre>{snapshot.text}</pre>}
      </main>
      {surfaceMode === 'control' ? (
        <form className="composer-form" onSubmit={send}>
          <Textarea
            className="composer-input"
            rows={1}
            autoComplete="off"
            placeholder={t.sendToAgent}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">{t.send}</Button>
        </form>
      ) : null}
    </div>
  );
}

function PtySessionView({
  sessionId,
  replayOnly,
  initialStatus,
  connectionSettings
}: {
  sessionId: string;
  replayOnly: boolean;
  initialStatus: string;
  connectionSettings: ConnectionSettings;
}) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const { isDark } = useUiPreferences();
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const terminal = React.useRef<Terminal | undefined>(undefined);
  const socket = React.useRef<WebSocket | undefined>(undefined);
  const transportMode = React.useMemo(readWebTransportMode, []);
  const [clientMode, setClientMode] = React.useState<ClientMode>(readClientMode);
  const [replayMode, setReplayMode] = React.useState<ReplayMode>(readReplayMode);
  const effectiveClientMode = replayOnly ? 'observe' : clientMode;
  const [isTerminalFullscreen, setTerminalFullscreen] = React.useState(false);
  const [clients, setClients] = React.useState<ClientInfo[]>([]);
  const [controllerClientId, setControllerClientId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState(initialStatus);
  const [isTerminalReady, setTerminalReady] = React.useState(false);
  const [text, setText] = React.useState('');

  const refreshClients = React.useCallback(async () => {
    if (connectionSettings.connectionMode === 'relay') {
      return;
    }
    const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/clients`);
    if (response.status === 401) {
      logoutNormal();
    }
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { controllerClientId: string | null; clients: ClientInfo[] };
    setControllerClientId(data.controllerClientId);
    setClients(data.clients);
  }, [connectionSettings.connectionMode, logoutNormal, normalAuth?.accessToken, sessionId]);

  const changeClientMode = React.useCallback((mode: ClientMode) => {
    window.localStorage.setItem(WEB_CLIENT_MODE_KEY, mode);
    setClientMode(mode);
  }, []);

  const changeReplayMode = React.useCallback((mode: ReplayMode) => {
    window.localStorage.setItem(WEB_REPLAY_MODE_KEY, mode);
    setReplayMode(mode);
  }, []);

  const sendHttpInput = React.useCallback(async (data: string): Promise<boolean> => {
    if (connectionSettings.connectionMode === 'relay') {
      return false;
    }
    if (effectiveClientMode === 'observe') {
      setStatus(t.statusObserveCannotInput);
      return false;
    }
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...gatewayAuthHeaders()
      },
      body: JSON.stringify({ data })
    });
    if (!response.ok) {
      if (response.status === 401) {
        logoutNormal();
      }
      setStatus(`${t.inputFailedPrefix}: ${t.httpStatusPrefix} ${response.status}`);
      return false;
    }
    return true;
  }, [effectiveClientMode, connectionSettings.connectionMode, logoutNormal, normalAuth?.accessToken, sessionId, t]);

  const sendWsInput = React.useCallback((data: string): boolean => {
    if (effectiveClientMode === 'observe') {
      setStatus(t.statusObserveCannotInput);
      return false;
    }
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus(t.statusWsUnavailable);
      return false;
    }
    ws.send(JSON.stringify(
      connectionSettings.connectionMode === 'relay'
        ? { type: 'client.input', sessionId, data }
        : { type: 'input', data }
    ));
    return true;
  }, [effectiveClientMode, connectionSettings.connectionMode, sessionId, t]);

  const sendTerminalInput = React.useCallback((data: string): void => {
    if (connectionSettings.connectionMode === 'direct' && transportMode === 'http') {
      sendHttpInput(data).catch(() => setStatus(t.statusInputFailed));
      return;
    }
    sendWsInput(data);
  }, [connectionSettings.connectionMode, sendHttpInput, sendWsInput, t.statusInputFailed, transportMode]);

  const sendLine = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text;
    if (!value) {
      return;
    }
    setStatus(t.statusSending);
    const isHttpFallback = connectionSettings.connectionMode === 'direct' && transportMode === 'http';
    const send = (async () => {
      const textSent = isHttpFallback ? await sendHttpInput(value) : sendWsInput(value);
      if (!textSent) {
        return false;
      }
      await wait(COMPOSER_ENTER_DELAY_MS);
      return isHttpFallback ? sendHttpInput(TERMINAL_ENTER) : sendWsInput(TERMINAL_ENTER);
    })();
    send
      .then((ok) => {
        if (!ok) return;
        setText('');
        setStatus(connectionSettings.connectionMode === 'relay' ? t.statusRelaySent : transportMode === 'http' ? t.statusHttpSent : t.statusWsSent);
        terminal.current?.focus();
      })
      .catch(() => setStatus(t.statusInputFailed));
  }, [connectionSettings.connectionMode, sendHttpInput, sendWsInput, t, text, transportMode]);

  React.useEffect(() => {
    const root = terminalRef.current;
    if (!root) {
      return undefined;
    }
    setTerminalReady(false);

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: isDark
        ? {
            background: '#0c0e10',
            foreground: '#e8ecef',
            cursor: '#8fd0ff'
          }
        : {
            background: '#f8faf9',
            foreground: '#111817',
            cursor: '#047857'
          }
    });
    const fitAddon = new FitAddon();
    let lastSize = { cols: 0, rows: 0 };
    let resizeFrame = 0;
    let disposed = false;
    let ws: WebSocket | undefined;
    let replayComplete = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    let reconnectStopped = false;
    let closeWasExpected = false;
    const sendResize = () => {
      if (term.cols === lastSize.cols && term.rows === lastSize.rows) {
        return;
      }
      lastSize = { cols: term.cols, rows: term.rows };
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(
          connectionSettings.connectionMode === 'relay'
            ? { type: 'client.resize', sessionId, cols: term.cols, rows: term.rows }
            : { type: 'resize', cols: term.cols, rows: term.rows }
        ));
      }
    };
    const fitAndResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        fitAddon.fit();
        sendResize();
      });
    };
    terminal.current = term;
    term.loadAddon(fitAddon);
    term.open(root);
    fitAddon.fit();
    sendResize();
    term.focus();

    const cursorKey = `tether:${sessionId}:latestEventId`;
    let after = 0;
    let tailTimer: number | undefined;

    const input = term.onData((data) => {
      if (!disposed && replayComplete) {
        sendTerminalInput(data);
      }
    });

    const writeEvent = (event: SessionEvent) => {
      if (event.id <= after) {
        return;
      }
      window.localStorage.setItem(cursorKey, String(event.id));
      after = Math.max(after, event.id);
      if (event.type === 'terminal.output') {
        const data = event.payload.data;
        if (typeof data === 'string') {
          setTerminalReady(true);
          term.write(data);
        }
        return;
      }
      if (event.type === 'session.exited') {
        setStatus(t.statusExited);
      }
    };

    const replayEvents = async () => {
      if (connectionSettings.connectionMode === 'relay') {
        replayComplete = false;
        return;
      }
      setStatus(t.statusReplaying);
      const shouldUseRecentReplay = replayOnly && replayMode === 'recent';
      const fetchReplayPage = async (query: string): Promise<SessionEvent[]> => {
        const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/events?${query}`);
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

      if (after > 0 || shouldUseRecentReplay) {
        const replayQuery = after > 0
          ? `after=${after}&limit=1000`
          : `after=0&tail=${RECENT_REPLAY_EVENT_LIMIT}`;
        const events = await fetchReplayPage(replayQuery);
        for (const event of events) {
          writeEvent(event);
        }
      } else {
        let keepLoading = true;
        while (!disposed && keepLoading) {
          const beforePageCursor = after;
          const events = await fetchReplayPage(`after=${after}&limit=${FULL_REPLAY_EVENT_PAGE_LIMIT}`);
          for (const event of events) {
            writeEvent(event);
          }
          keepLoading = events.length === FULL_REPLAY_EVENT_PAGE_LIMIT && after > beforePageCursor;
        }
      }
      replayComplete = true;
      setTerminalReady(true);
      fitAddon.fit();
      sendResize();
    };

    const pollTail = async () => {
      if (disposed) {
        return;
      }
      try {
        const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=${after}&limit=1000`);
        if (response.status === 401) {
          logoutNormal();
        }
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { events: SessionEvent[] };
        for (const event of data.events) {
          writeEvent(event);
        }
      } catch {
        // WS is the primary live path; polling is a best-effort browser fallback.
      }
    };

    const probeGatewaySession = async (): Promise<boolean> => {
      if (connectionSettings.connectionMode === 'relay') {
        return true;
      }
      try {
        const response = await gatewayRequest(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`);
        if (response.status === 401) {
          logoutNormal();
        }
        if (response.status === 404) {
          reconnectStopped = true;
          setStatus(t.statusSessionDetached);
          setTerminalReady(true);
          return false;
        }
        if (!response.ok) {
          setStatus(t.statusGatewayRestarting);
          return false;
        }
        return true;
      } catch {
        setStatus(t.statusGatewayRestarting);
        return false;
      }
    };

    const reconnectDelay = () => Math.min(5000, [1000, 2000, 3000, 5000][Math.min(reconnectAttempt, 3)]);

    const scheduleReconnect = () => {
      if (disposed || reconnectStopped) {
        return;
      }
      replayComplete = false;
      socket.current = undefined;
      setStatus(t.statusReconnecting);
      const delay = reconnectDelay();
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
            setTerminalReady(true);
            return;
          }
          setStatus(t.statusGatewayRestarting);
          scheduleReconnect();
        });
      }, delay);
    };

    const connectStream = async (isReconnect = false) => {
      closeWasExpected = false;
      if (tailTimer) {
        window.clearInterval(tailTimer);
        tailTimer = undefined;
      }
      if (isReconnect) {
        setStatus(t.statusGatewayRestarting);
        const canReconnect = await probeGatewaySession();
        if (!canReconnect) {
          throw new Error(reconnectStopped ? t.statusSessionDetached : t.statusGatewayRestarting);
        }
      }
      await replayEvents();
      if (connectionSettings.connectionMode === 'direct' && transportMode === 'http') {
        tailTimer = window.setInterval(pollTail, 500);
        setStatus(t.statusSyncingHttp);
        setTerminalReady(true);
        reconnectAttempt = 0;
        return;
      }
      const nextWs = await openStreamWebSocket();
      ws = nextWs;
      socket.current = nextWs;

      nextWs.addEventListener('open', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        if (connectionSettings.connectionMode === 'relay') {
          setStatus(t.statusRelayAuth);
          nextWs.send(JSON.stringify(
            normalAuth?.accessToken
              ? { type: 'client.auth', token: normalAuth.accessToken }
              : { type: 'client.auth', secret: connectionSettings.relaySecret }
          ));
          return;
        }
        setStatus(t.statusSyncingWs);
        reconnectAttempt = 0;
        sendResize();
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
            nextWs.send(JSON.stringify({
              type: 'client.subscribe',
              sessionId,
              after,
              tail: replayOnly && replayMode === 'recent' && after === 0 ? RECENT_REPLAY_EVENT_LIMIT : undefined,
              mode: effectiveClientMode
            }));
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
            setTerminalReady(true);
            fitAddon.fit();
            sendResize();
            return;
          }
          if (frame.type === 'event') {
            writeEvent(frame.event);
          }
          return;
        }
        const frame = parsedFrame as StreamFrame;
        if (frame.type === 'hello') {
          refreshClients().catch(() => undefined);
          setStatus(`${t.streamClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
          return;
        }
        if (frame.type === 'error') {
          setStatus(displayMessage(frame.message, t));
          return;
        }
        if (frame.type === 'replay.done') {
          replayComplete = true;
          setTerminalReady(true);
          fitAddon.fit();
          sendResize();
          return;
        }
        writeEvent(frame.event);
        if (frame.event.type === 'session.exited') {
          setStatus(t.statusExited);
          closeWasExpected = true;
          nextWs.close();
        }
        if (frame.event.type === 'client.attached' || frame.event.type === 'client.detached' || frame.event.type === 'client.control_changed') {
          refreshClients().catch(() => undefined);
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
    const openStreamWebSocket = async (): Promise<WebSocket> => {
      if (connectionSettings.connectionMode === 'relay') {
        return new WebSocket(buildRelayClientUrl(connectionSettings.relayUrl, t));
      }
      const { ticket } = await requestGatewayWsTicket({
        sessionId,
        mode: effectiveClientMode
      });
      const tailQuery = replayOnly && replayMode === 'recent' && after === 0 ? `&tail=${RECENT_REPLAY_EVENT_LIMIT}` : '';
      const streamQuery = `after=${after}&surface=web&mode=${effectiveClientMode}${tailQuery}`;
      return new WebSocket(
        buildGatewayStreamUrl(sessionId, streamQuery),
        [`tether-ticket.${ticket}`]
      );
    };
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : t.statusStreamUnavailable);
        setTerminalReady(true);
        scheduleReconnect();
      }
    });
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(root);
    const clientsTimer = connectionSettings.connectionMode === 'direct'
      ? window.setInterval(() => refreshClients().catch(() => undefined), 3000)
      : undefined;

    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      if (tailTimer) {
        window.clearInterval(tailTimer);
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      observer.disconnect();
      if (clientsTimer) {
        window.clearInterval(clientsTimer);
      }
      input.dispose();
      if (connectionSettings.connectionMode === 'relay' && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'client.detach', sessionId }));
      }
      ws?.close();
      term.dispose();
    };
  }, [
    connectionSettings.connectionMode,
    connectionSettings.relaySecret,
    connectionSettings.relayUrl,
    effectiveClientMode,
    isDark,
    logoutNormal,
    normalAuth?.accessToken,
    replayMode,
    refreshClients,
    sendTerminalInput,
    sessionId,
    t,
    transportMode
  ]);

  async function stopSession(): Promise<void> {
    if (connectionSettings.connectionMode === 'relay') {
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus(t.statusRelayUnavailable);
        return;
      }
      sendRelayFrame(ws, { type: 'client.subscribe', sessionId, mode: 'control' });
      sendRelayFrame(ws, { type: 'client.stop', sessionId });
      setStatus(t.statusStopRequested);
      return;
    }
    setStatus(t.statusStopping);
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      headers: gatewayAuthHeaders()
    });
    if (response.status === 401) {
      logoutNormal();
    }
    setStatus(response.ok ? t.sessionStopped : `${t.stopFailedPrefix}: ${t.httpStatusPrefix} ${response.status}`);
  }

  return (
    <div className="session-detail-page">
      <SessionDetailHeader
        sessionId={sessionId}
        connectionMode={connectionSettings.connectionMode}
        status={status}
      >
        {replayOnly ? (
          <>
            <div className="mode-select">
              <Label>{t.replay}</Label>
              <Select value={replayMode} onValueChange={(value) => changeReplayMode(value as ReplayMode)}>
                <SelectTrigger className="connection-select-trigger">
                  <SelectValue>{replayMode === 'recent' ? t.replayRecent : t.replayAll}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{t.replayRecent}</SelectItem>
                  <SelectItem value="all">{t.replayAll}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
            <div className="mode-select">
              <Label>{t.mode}</Label>
              <Select value={clientMode} onValueChange={(value) => changeClientMode(value as ClientMode)}>
                <SelectTrigger className="connection-select-trigger">
                  <SelectValue>{clientModeLabel(clientMode, t)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="control">{t.control}</SelectItem>
                  <SelectItem value="observe">{t.observe}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button asChild variant="outline" size="sm" type="button">
              <Link to={`/remote/session/${encodeURIComponent(sessionId)}/replay`}>{t.replay}</Link>
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={() => stopSession()}>
              <Power aria-hidden="true" />
              {t.stop}
            </Button>
          </>
        )}
      </SessionDetailHeader>
      <main
        className={`terminal-shell terminal-panel${isTerminalFullscreen ? ' terminal-panel-fullscreen' : ''}`}
        aria-label={t.terminalSurface}
        onMouseDown={() => terminal.current?.focus()}
      >
        <Button
          className="terminal-fullscreen-toggle"
          variant="outline"
          size="icon"
          type="button"
          aria-label={isTerminalFullscreen ? t.exitTerminalFullscreen : t.enterTerminalFullscreen}
          title={isTerminalFullscreen ? t.exitTerminalFullscreen : t.enterTerminalFullscreen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setTerminalFullscreen((value) => !value)}
        >
          {isTerminalFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </Button>
        <div ref={terminalRef} className="terminal-host" />
        {!isTerminalReady ? <TerminalSurfaceSkeleton /> : null}
        {clients.length > 0 ? (
          <aside className="client-strip">
            <span>{t.controllerLabel} {controllerClientId ? controllerClientId.slice(0, 8) : '-'}</span>
            <span>{clients.length} {t.clients}</span>
            <span>{transportMode.toUpperCase()}</span>
          </aside>
        ) : connectionSettings.connectionMode === 'relay' ? (
          <aside className="client-strip">
            <span>{t.relay}</span>
            <span>{clientModeLabel(effectiveClientMode, t)}</span>
          </aside>
        ) : null}
      </main>
      {!replayOnly ? (
        <form className="composer-form" onSubmit={sendLine}>
          <Textarea
            className="composer-input"
            rows={1}
            autoComplete="off"
            placeholder={t.sendToAgent}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">{t.send}</Button>
        </form>
      ) : null}
    </div>
  );
}
