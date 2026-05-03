import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Button, Toaster, toast } from '@tether/design';
import { eventBus } from '@tether/http';
import '@xterm/xterm/css/xterm.css';
import { AuthProvider } from './contexts/auth-context.js';
import { UiPreferencesProvider } from './contexts/ui-preferences-context.js';
import { useAuth } from './hooks/use-auth.js';
import { useI18n } from './hooks/use-i18n.js';
import { useUiPreferences } from './hooks/use-ui-preferences.js';
import { gatewayAuthHeaders, requestGatewayWsTicket } from './lib/api.js';
import { WebChromeControls } from './components/console/web-chrome-controls.js';
import { WebRoutes } from './routes.js';
import './styles.css';

type Snapshot = {
  text: string;
  capturedAt: number;
  session?: Session;
};

type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: string;
  transport?: string;
  lastActiveAt: number;
};

type Gateway = {
  id: string;
  url: string;
  pid: number;
  lastSeenAt: number;
};

type WebTransportMode = 'ws' | 'http';
type ClientMode = 'control' | 'observe';
type ConnectionMode = 'direct' | 'relay';

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

type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };

type RelayClientToServerFrame =
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; mode: ClientMode }
  | { type: 'client.stop'; sessionId: string };

const WEB_TRANSPORT_KEY = 'tether:webTransportMode';
const WEB_CLIENT_MODE_KEY = 'tether:webClientMode';
const CONNECTION_MODE_KEY = 'tether:connectionMode';
const RELAY_URL_KEY = 'tether:relayUrl';
const RELAY_SECRET_KEY = 'tether:relaySecret';

function readWebTransportMode(): WebTransportMode {
  return window.localStorage.getItem(WEB_TRANSPORT_KEY) === 'http' ? 'http' : 'ws';
}

function readClientMode(): ClientMode {
  return window.localStorage.getItem(WEB_CLIENT_MODE_KEY) === 'observe' ? 'observe' : 'control';
}

function readConnectionMode(): ConnectionMode {
  return window.localStorage.getItem(CONNECTION_MODE_KEY) === 'relay' ? 'relay' : 'direct';
}

function readConnectionSettings(): ConnectionSettings {
  return {
    connectionMode: readConnectionMode(),
    relayUrl: window.localStorage.getItem(RELAY_URL_KEY) ?? '',
    relaySecret: window.localStorage.getItem(RELAY_SECRET_KEY) ?? ''
  };
}

function splitActiveSessions(allSessions: Session[]): { active: Session[]; history: Session[] } {
  const active = allSessions.filter((session) => session.status === 'running');
  const activeIds = new Set(active.map((session) => session.id));
  return {
    active,
    history: allSessions.filter((session) => !activeIds.has(session.id)).slice(0, 8)
  };
}

type WebMessages = ReturnType<typeof useI18n>['t'];

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

function sessionStatusLabel(status: string, t: WebMessages): string {
  switch (status) {
    case 'running':
      return t.sessionRunning;
    case 'stopped':
      return t.sessionStopped;
    case 'completed':
      return t.sessionCompleted;
    case 'failed':
      return t.sessionFailed;
    case 'lost':
      return t.sessionLost;
    default:
      return status;
  }
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

function WebHeaderPreferences() {
  const { isDark, toggleTheme } = useUiPreferences();
  const { locale, setLocale } = useI18n();

  return (
    <WebChromeControls
      locale={locale}
      onLocaleChange={setLocale}
      isDark={isDark}
      onThemeToggle={toggleTheme}
    />
  );
}

function App() {
  const [connectionSettings, setConnectionSettings] = React.useState<ConnectionSettings>(readConnectionSettings);

  React.useEffect(() => {
    const onApiError = (message: string) => {
      toast.error(message);
    };
    eventBus.on('apiError', onApiError);
    return () => {
      eventBus.off('apiError', onApiError);
    };
  }, []);

  const updateConnectionSettings = React.useCallback((next: ConnectionSettings) => {
    window.localStorage.setItem(CONNECTION_MODE_KEY, next.connectionMode);
    window.localStorage.setItem(RELAY_URL_KEY, next.relayUrl);
    window.localStorage.setItem(RELAY_SECRET_KEY, next.relaySecret);
    setConnectionSettings(next);
  }, []);

  return (
    <UiPreferencesProvider>
      <AuthProvider>
        <BrowserRouter>
          <WebRoutes
            sessionListSurface={(
              <SessionList
                connectionSettings={connectionSettings}
                onConnectionSettingsChange={updateConnectionSettings}
              />
            )}
            renderSessionView={(sessionId) => (
              <SessionView
                sessionId={sessionId}
                connectionSettings={connectionSettings}
                onConnectionSettingsChange={updateConnectionSettings}
              />
            )}
          />
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </UiPreferencesProvider>
  );
}

function ConnectionSettingsControl({
  settings,
  onChange
}: {
  settings: ConnectionSettings;
  onChange: (settings: ConnectionSettings) => void;
}) {
  const { t } = useI18n();
  const update = React.useCallback((patch: Partial<ConnectionSettings>) => {
    onChange({ ...settings, ...patch });
  }, [onChange, settings]);

  return (
    <div className="connection-settings" aria-label={t.connectionSettingsLabel}>
      <label className="mode-select">
        {t.connection}
        <select value={settings.connectionMode} onChange={(event) => update({ connectionMode: event.target.value as ConnectionMode })}>
          <option value="direct">{t.direct}</option>
          <option value="relay">{t.relay}</option>
        </select>
      </label>
      {settings.connectionMode === 'relay' ? (
        <>
          <label className="relay-field">
            {t.relayUrl}
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder={t.relayUrlExample}
              value={settings.relayUrl}
              onChange={(event) => update({ relayUrl: event.target.value })}
            />
          </label>
          <label className="relay-field">
            {t.relaySecret}
            <input
              type="password"
              autoComplete="current-password"
              placeholder={t.relaySecretPlaceholder}
              value={settings.relaySecret}
              onChange={(event) => update({ relaySecret: event.target.value })}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

function SessionList({
  connectionSettings,
  onConnectionSettingsChange
}: {
  connectionSettings: ConnectionSettings;
  onConnectionSettingsChange: (settings: ConnectionSettings) => void;
}) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [history, setHistory] = React.useState<Session[]>([]);
  const [gateways, setGateways] = React.useState<Gateway[]>([]);
  const [webTransportMode, setWebTransportMode] = React.useState<WebTransportMode>(readWebTransportMode);
  const [status, setStatus] = React.useState<string>(t.statusLoading);
  const listSocket = React.useRef<WebSocket | undefined>(undefined);

  const changeWebTransportMode = React.useCallback((mode: WebTransportMode) => {
    window.localStorage.setItem(WEB_TRANSPORT_KEY, mode);
    setWebTransportMode(mode);
  }, []);

  const refreshDirect = React.useCallback(async () => {
    try {
      const [sessionsResponse, historyResponse, gatewaysResponse] = await Promise.all([
        fetch('/api/sessions'),
        fetch('/api/sessions?all=1'),
        fetch('/api/gateways')
      ]);
      if (!sessionsResponse.ok) {
        throw new Error(`sessions HTTP ${sessionsResponse.status}`);
      }
      if (!historyResponse.ok) {
        throw new Error(`history HTTP ${historyResponse.status}`);
      }
      if (!gatewaysResponse.ok) {
        throw new Error(`gateways HTTP ${gatewaysResponse.status}`);
      }
      const sessionsData = (await sessionsResponse.json()) as { sessions: Session[] };
      const historyData = (await historyResponse.json()) as { sessions: Session[] };
      const gatewaysData = (await gatewaysResponse.json()) as { gateways: Gateway[] };
      const active = sessionsData.sessions.filter((session) => session.status === 'running');
      const activeIds = new Set(active.map((session) => session.id));
      setSessions(active);
      setHistory(historyData.sessions.filter((session) => !activeIds.has(session.id)).slice(0, 8));
      setGateways(gatewaysData.gateways);
      setStatus(new Date().toLocaleTimeString());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusDisconnected);
    }
  }, [t.statusDisconnected]);

  React.useEffect(() => {
    if (connectionSettings.connectionMode !== 'direct') {
      return undefined;
    }
    refreshDirect();
    const timer = window.setInterval(refreshDirect, 3000);
    return () => window.clearInterval(timer);
  }, [connectionSettings.connectionMode, refreshDirect]);

  React.useEffect(() => {
    if (connectionSettings.connectionMode !== 'relay') {
      return undefined;
    }
    let disposed = false;
    let ws: WebSocket | undefined;
    let timer: number | undefined;
    setSessions([]);
    setHistory([]);
    setGateways([]);
    try {
      ws = new WebSocket(buildRelayClientUrl(connectionSettings.relayUrl, t));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusRelayInvalid);
      return undefined;
    }
    const sendList = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'client.list' }));
      }
    };
    ws.addEventListener('open', () => {
      if (disposed) return;
      listSocket.current = ws;
      setStatus(t.statusRelayAuth);
      ws?.send(JSON.stringify(
        normalAuth?.accessToken
          ? { type: 'client.auth', token: normalAuth.accessToken }
          : { type: 'client.auth', secret: connectionSettings.relaySecret }
      ));
    });
    ws.addEventListener('message', (message) => {
      if (disposed) return;
      const parsedFrame = parseWsFrame(message.data);
      if (!parsedFrame || typeof parsedFrame.type !== 'string') {
        setStatus(t.statusRelayBadFrame);
        ws?.close();
        return;
      }
      const frame = parsedFrame as RelayServerToClientFrame;
      if (frame.type === 'client.auth.ok') {
        setStatus(`${t.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
        sendList();
        timer = window.setInterval(sendList, 3000);
        return;
      }
      if (frame.type === 'client.auth.failed') {
        logoutNormal();
        setStatus(displayMessage(frame.message, t));
        ws?.close();
        return;
      }
      if (frame.type === 'sessions') {
        const next = splitActiveSessions(frame.sessions);
        setSessions(next.active);
        setHistory(next.history);
        setStatus(new Date().toLocaleTimeString());
        return;
      }
      if (frame.type === 'error') {
        setStatus(displayMessage(frame.message, t));
      }
    });
    ws.addEventListener('close', () => {
      if (!disposed) {
        setStatus(t.statusRelayClosed);
      }
    });
    ws.addEventListener('error', () => {
      if (!disposed) {
        setStatus(t.statusRelayError);
      }
    });
    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
      ws?.close();
      if (listSocket.current === ws) {
        listSocket.current = undefined;
      }
    };
  }, [connectionSettings.connectionMode, connectionSettings.relaySecret, connectionSettings.relayUrl, logoutNormal, normalAuth?.accessToken, t]);

  const stopSession = React.useCallback(async (sessionId: string) => {
    setStatus(t.statusStopping);
    if (connectionSettings.connectionMode === 'relay') {
      const ws = listSocket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus(t.statusRelayUnavailable);
        return;
      }
      sendRelayFrame(ws, { type: 'client.subscribe', sessionId, mode: 'control' });
      sendRelayFrame(ws, { type: 'client.stop', sessionId });
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setStatus(t.statusStopRequested);
      return;
    }
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
      headers: gatewayAuthHeaders(normalAuth?.accessToken)
    });
    if (!response.ok) {
      if (response.status === 401) {
        logoutNormal();
      }
      setStatus(`${t.stopFailedPrefix}: ${t.httpStatusPrefix} ${response.status}`);
      return;
    }
    await refreshDirect();
  }, [connectionSettings.connectionMode, logoutNormal, normalAuth?.accessToken, refreshDirect, t]);

  const stopAllSessions = React.useCallback(async () => {
    for (const session of sessions) {
      await stopSession(session.id);
    }
  }, [sessions, stopSession]);

  return (
    <>
      <header className="session-header">
        <h1>{t.appTitle}</h1>
        <div className="header-actions">
          <WebHeaderPreferences />
          <ConnectionSettingsControl settings={connectionSettings} onChange={onConnectionSettingsChange} />
          <Button variant="outline" size="sm" type="button" onClick={logoutNormal}>{t.signOut}</Button>
          {sessions.length > 0 ? (
            <Button variant="outline" size="sm" type="button" onClick={() => void stopAllSessions()}>{t.stopAll}</Button>
          ) : null}
          {connectionSettings.connectionMode === 'direct' ? (
            <label className="mode-select">
              {t.transport}
              <select value={webTransportMode} onChange={(event) => changeWebTransportMode(event.target.value as WebTransportMode)}>
                <option value="ws">WS</option>
                <option value="http">{t.httpFallback}</option>
              </select>
            </label>
          ) : null}
          <div className="status">{status}</div>
        </div>
      </header>
      <main className="session-list">
        {gateways.length > 0 ? (
          <section className="gateway-list" aria-label={t.gatewayList}>
            {gateways.map((gateway) => (
              <div className="gateway-row" key={gateway.id}>
                <span>{gateway.url}</span>
                <span>{t.pidLabel} {gateway.pid}</span>
              </div>
            ))}
          </section>
        ) : null}
        {sessions.length === 0 ? (
          <div className="empty">
            <h2>{t.noSessions}</h2>
            <p>{t.noSessionsDescription}</p>
          </div>
        ) : (
          <section className="session-section" aria-label={t.activeSessions}>
            <div className="section-heading">{t.activeSessions}</div>
            {sessions.map((session) => (
              <SessionCard session={session} key={session.id} onStop={stopSession} t={t} />
            ))}
          </section>
        )}
        {history.length > 0 ? (
          <details className="session-section history-section">
            <summary>{t.history}</summary>
            {history.map((session) => (
              <SessionCard session={session} key={session.id} t={t} />
            ))}
          </details>
        ) : null}
      </main>
    </>
  );
}

function SessionCard({ session, onStop, t }: { session: Session; onStop?: (sessionId: string) => void; t: WebMessages }) {
  return (
    <div className="session-card">
      <a href={`/remote/session/${encodeURIComponent(session.id)}`}>
        <span className="session-card-title">{session.title || session.provider}</span>
        <span className="session-card-meta">
          {session.provider} · {sessionStatusLabel(session.status, t)} · {session.transport ?? t.fallbackTmuxTransport} ·{' '}
          {new Date(session.lastActiveAt).toLocaleTimeString()}
        </span>
        <span className="session-card-id">{session.id}</span>
        <span className="session-card-path">{session.projectPath}</span>
      </a>
      {onStop ? (
        <Button className="justify-self-start" variant="outline" size="sm" type="button" onClick={() => onStop(session.id)}>{t.stop}</Button>
      ) : null}
    </div>
  );
}

function SessionView({
  sessionId,
  connectionSettings,
  onConnectionSettingsChange
}: {
  sessionId: string;
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
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/snapshot`);
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
  }, [connectionSettings.connectionMode, sessionId, t]);

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
        initialStatus={status}
        connectionSettings={connectionSettings}
        onConnectionSettingsChange={onConnectionSettingsChange}
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
        ...gatewayAuthHeaders(normalAuth?.accessToken)
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

  return (
    <>
      <header className="session-header">
        <h1>{t.appTitle}</h1>
        <div className="header-actions">
          <WebHeaderPreferences />
        </div>
        <div className="status">{status}</div>
      </header>
      <main ref={scrollRef} className="scrollport">
        <pre>{snapshot.text}</pre>
      </main>
      <form className="composer-form" onSubmit={send}>
        <textarea
          className="composer-input"
          rows={1}
          autoComplete="off"
          placeholder={t.sendToAgent}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit">{t.send}</Button>
      </form>
    </>
  );
}

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

function PtySessionView({
  sessionId,
  initialStatus,
  connectionSettings,
  onConnectionSettingsChange
}: {
  sessionId: string;
  initialStatus: string;
  connectionSettings: ConnectionSettings;
  onConnectionSettingsChange: (settings: ConnectionSettings) => void;
}) {
  const { logoutNormal, normalAuth } = useAuth();
  const { t } = useI18n();
  const { isDark } = useUiPreferences();
  const terminalRef = React.useRef<HTMLDivElement>(null);
  const terminal = React.useRef<Terminal | undefined>(undefined);
  const socket = React.useRef<WebSocket | undefined>(undefined);
  const transportMode = React.useMemo(readWebTransportMode, []);
  const [clientMode, setClientMode] = React.useState<ClientMode>(readClientMode);
  const [clients, setClients] = React.useState<ClientInfo[]>([]);
  const [controllerClientId, setControllerClientId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState(initialStatus);
  const [text, setText] = React.useState('');

  const refreshClients = React.useCallback(async () => {
    if (connectionSettings.connectionMode === 'relay') {
      return;
    }
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/clients`);
    if (!response.ok) {
      return;
    }
    const data = (await response.json()) as { controllerClientId: string | null; clients: ClientInfo[] };
    setControllerClientId(data.controllerClientId);
    setClients(data.clients);
  }, [connectionSettings.connectionMode, sessionId]);

  const changeClientMode = React.useCallback((mode: ClientMode) => {
    window.localStorage.setItem(WEB_CLIENT_MODE_KEY, mode);
    setClientMode(mode);
  }, []);

  const sendHttpInput = React.useCallback(async (data: string): Promise<boolean> => {
    if (connectionSettings.connectionMode === 'relay') {
      return false;
    }
    if (clientMode === 'observe') {
      setStatus(t.statusObserveCannotInput);
      return false;
    }
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...gatewayAuthHeaders(normalAuth?.accessToken)
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
  }, [clientMode, connectionSettings.connectionMode, logoutNormal, normalAuth?.accessToken, sessionId, t]);

  const sendWsInput = React.useCallback((data: string): boolean => {
    if (clientMode === 'observe') {
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
  }, [clientMode, connectionSettings.connectionMode, sessionId, t]);

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
    const send = connectionSettings.connectionMode === 'direct' && transportMode === 'http'
      ? sendHttpInput(`${value}\r`)
      : Promise.resolve(sendWsInput(`${value}\r`));
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
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=0&limit=5000`);
      if (!response.ok) {
        throw new Error(`events HTTP ${response.status}`);
      }
      const data = (await response.json()) as { events: SessionEvent[] };
      for (const event of data.events) {
        writeEvent(event);
      }
      replayComplete = true;
      fitAddon.fit();
      sendResize();
    };

    const pollTail = async () => {
      if (disposed) {
        return;
      }
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events?after=${after}&limit=1000`);
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

    const connectStream = async () => {
      await replayEvents();
      if (connectionSettings.connectionMode === 'direct' && transportMode === 'http') {
        tailTimer = window.setInterval(pollTail, 500);
        setStatus(t.statusSyncingHttp);
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
            nextWs.send(JSON.stringify({ type: 'client.subscribe', sessionId, after, mode: clientMode }));
            return;
          }
          if (frame.type === 'client.auth.failed') {
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
          fitAddon.fit();
          sendResize();
          return;
        }
        writeEvent(frame.event);
        if (frame.event.type === 'session.exited') {
          setStatus(t.statusExited);
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
        setStatus((current) => (current === t.statusExited ? current : t.statusDisconnected));
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
        mode: clientMode,
        accessToken: normalAuth?.accessToken ?? ''
      });
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return new WebSocket(
        `${scheme}://${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/stream?after=${after}&ticket=${encodeURIComponent(ticket)}&surface=web&mode=${clientMode}`
      );
    };
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : t.statusStreamUnavailable);
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
    clientMode,
    connectionSettings.connectionMode,
    connectionSettings.relaySecret,
    connectionSettings.relayUrl,
    isDark,
    logoutNormal,
    normalAuth?.accessToken,
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
      headers: gatewayAuthHeaders(normalAuth?.accessToken)
    });
    if (response.status === 401) {
      logoutNormal();
    }
    setStatus(response.ok ? t.sessionStopped : `${t.stopFailedPrefix}: ${t.httpStatusPrefix} ${response.status}`);
  }

  return (
    <>
      <header className="session-header">
        <h1>{t.appTitle}</h1>
        <div className="header-actions">
          <WebHeaderPreferences />
          <ConnectionSettingsControl settings={connectionSettings} onChange={onConnectionSettingsChange} />
          <label className="mode-select">
            {t.mode}
            <select value={clientMode} onChange={(event) => changeClientMode(event.target.value as ClientMode)}>
              <option value="control">{t.control}</option>
              <option value="observe">{t.observe}</option>
            </select>
          </label>
          <Button variant="outline" size="sm" type="button" onClick={() => stopSession()}>{t.stop}</Button>
          <div className="status">{status}</div>
        </div>
      </header>
      <main className="terminal-shell" onMouseDown={() => terminal.current?.focus()}>
        <div ref={terminalRef} className="terminal-host" />
        {clients.length > 0 ? (
          <aside className="client-strip">
            <span>{t.controllerLabel} {controllerClientId ? controllerClientId.slice(0, 8) : '-'}</span>
            <span>{clients.length} {t.clients}</span>
            <span>{transportMode.toUpperCase()}</span>
          </aside>
        ) : connectionSettings.connectionMode === 'relay' ? (
          <aside className="client-strip">
            <span>{t.relay}</span>
            <span>{clientModeLabel(clientMode, t)}</span>
          </aside>
        ) : null}
      </main>
      <form className="composer-form" onSubmit={sendLine}>
        <textarea
          className="composer-input"
          rows={1}
          autoComplete="off"
          placeholder={t.sendToAgent}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit">{t.send}</Button>
      </form>
    </>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
