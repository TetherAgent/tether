import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link } from 'react-router-dom';
import {
  Activity,
  Check,
  Clock3,
  ArrowRight,
  ClipboardCopy,
  LogOut,
  MonitorDot,
  Power,
  Router,
  Server,
  Settings,
  TerminalSquare,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Toaster,
  toast
} from '@tether/design';
import { eventBus } from '@tether/http';
import '@xterm/xterm/css/xterm.css';
import { AuthProvider } from './contexts/auth-context.js';
import { UiPreferencesProvider } from './contexts/ui-preferences-context.js';
import { useAuth } from './hooks/use-auth.js';
import { useI18n } from './hooks/use-i18n.js';
import { useUiPreferences } from './hooks/use-ui-preferences.js';
import { gatewayAuthHeaders, readGatewayData } from './lib/api.js';
import { WebChromeControls } from './components/console/web-chrome-controls.js';
import { SessionControlPage } from './pages/session-control-page.js';
import { SessionReplayPage } from './pages/session-replay-page.js';
import { SessionChatPage } from './pages/session-chat-page.js';
import { WebRoutes } from './routes.js';
import './styles.css';

type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: string;
  transport?: string;
  agentSessionId?: string;
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

type SessionEvent = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
};

type ConnectionSettings = {
  connectionMode: ConnectionMode;
  relayUrl: string;
  relaySecret: string;
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
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: ClientMode }
  | { type: 'client.stop'; sessionId: string };

const WEB_TRANSPORT_KEY = 'tether:webTransportMode';
const CONNECTION_MODE_KEY = 'tether:connectionMode';
const RELAY_URL_KEY = 'tether:relayUrl';
const RELAY_SECRET_KEY = 'tether:relaySecret';
const DEFAULT_CONNECTION_MODE = import.meta.env.VITE_TETHER_CONNECTION_MODE;
const PRODUCT_DEFAULT_RELAY_URL = 'wss://tether.earntools.me';
const DEFAULT_RELAY_URL = import.meta.env.VITE_TETHER_RELAY_URL ?? PRODUCT_DEFAULT_RELAY_URL;
function readWebTransportMode(): WebTransportMode {
  return window.localStorage.getItem(WEB_TRANSPORT_KEY) === 'http' ? 'http' : 'ws';
}

function readConnectionMode(): ConnectionMode {
  const stored = window.localStorage.getItem(CONNECTION_MODE_KEY);
  if (stored === 'relay' || stored === 'direct') {
    return stored;
  }
  return DEFAULT_CONNECTION_MODE === 'relay' ? 'relay' : 'direct';
}

function readConnectionSettings(): ConnectionSettings {
  return {
    connectionMode: readConnectionMode(),
    relayUrl: window.localStorage.getItem(RELAY_URL_KEY) ?? DEFAULT_RELAY_URL ?? '',
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

function formatSessionTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function statusTone(status: string): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'failed':
    case 'lost':
      return 'danger';
    case 'completed':
      return 'success';
    default:
      return 'muted';
  }
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
    case 'PTY session is no longer running':
    case 'pty session is no longer running':
    case 'session runner no longer has a live PTY':
      return t.sessionEnded;
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
            renderSessionView={(sessionId, mode) => {
              if (mode === 'replay') {
                return (
                  <SessionReplayPage
                    sessionId={sessionId}
                    connectionSettings={connectionSettings}
                    onConnectionSettingsChange={updateConnectionSettings}
                  />
                );
              }
              if (mode === 'chat') {
                return (
                  <SessionChatPage
                    sessionId={sessionId}
                    connectionSettings={connectionSettings}
                    onConnectionSettingsChange={updateConnectionSettings}
                  />
                );
              }
              return (
                <SessionControlPage
                  sessionId={sessionId}
                  connectionSettings={connectionSettings}
                  onConnectionSettingsChange={updateConnectionSettings}
                />
              );
            }}
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
  const modeLabel = settings.connectionMode === 'relay' ? t.relay : t.direct;

  return (
    <Dialog>
      <div className="connection-settings" aria-label={t.connectionSettingsLabel}>
        <DialogTrigger asChild>
          <Button className="connection-settings-button" variant="outline" size="icon-sm" type="button" aria-label={t.connectionSettingsLabel}>
            <Settings aria-hidden="true" />
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="connection-settings-dialog">
        <DialogHeader>
          <DialogTitle>{t.connectionSettingsLabel}</DialogTitle>
          <DialogDescription>{t.connectionSettingsDescription}</DialogDescription>
        </DialogHeader>
        <div className="connection-settings-form">
          <div className="mode-select">
            <Label>{t.connection}</Label>
            <Select value={settings.connectionMode} onValueChange={(value) => update({ connectionMode: value as ConnectionMode })}>
              <SelectTrigger className="connection-select-trigger">
                <SelectValue>{modeLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">{t.direct}</SelectItem>
                <SelectItem value="relay">{t.relay}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.connectionMode === 'relay' ? (
          <div className="relay-field">
            <Label>{t.relayUrl}</Label>
            <Input
              className="relay-url-input"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder={t.relayUrlExample}
              value={settings.relayUrl}
              onChange={(event) => update({ relayUrl: event.target.value })}
            />
          </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
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
  const [hasLoadedSessions, setHasLoadedSessions] = React.useState(false);
  const [relayGatewayUnavailable, setRelayGatewayUnavailable] = React.useState(false);
  const listSocket = React.useRef<WebSocket | undefined>(undefined);

  const changeWebTransportMode = React.useCallback((mode: WebTransportMode) => {
    window.localStorage.setItem(WEB_TRANSPORT_KEY, mode);
    setWebTransportMode(mode);
  }, []);

  const refreshDirect = React.useCallback(async () => {
    try {
      const [sessionsResponse, historyResponse, gatewaysResponse] = await Promise.all([
        gatewayRequest('/api/sessions'),
        gatewayRequest('/api/sessions?all=1'),
        gatewayRequest('/api/gateways')
      ]);
      if (sessionsResponse.status === 401 || historyResponse.status === 401 || gatewaysResponse.status === 401) {
        logoutNormal();
      }
      if (!sessionsResponse.ok) {
        throw new Error(`sessions HTTP ${sessionsResponse.status}`);
      }
      if (!historyResponse.ok) {
        throw new Error(`history HTTP ${historyResponse.status}`);
      }
      if (!gatewaysResponse.ok) {
        throw new Error(`gateways HTTP ${gatewaysResponse.status}`);
      }
      const sessionsData = await readGatewayData<{ sessions: Session[] }>(sessionsResponse);
      const historyData = await readGatewayData<{ sessions: Session[] }>(historyResponse);
      const gatewaysData = (await gatewaysResponse.json()) as { gateways: Gateway[] };
      const active = sessionsData.sessions.filter((session) => session.status === 'running');
      const activeIds = new Set(active.map((session) => session.id));
      setSessions(active);
      setHistory(historyData.sessions.filter((session) => !activeIds.has(session.id)).slice(0, 8));
      setGateways(gatewaysData.gateways);
      setRelayGatewayUnavailable(false);
      setStatus(new Date().toLocaleTimeString());
    } catch (error) {
      setRelayGatewayUnavailable(false);
      setStatus(error instanceof Error ? error.message : t.statusDisconnected);
    } finally {
      setHasLoadedSessions(true);
    }
  }, [logoutNormal, normalAuth?.accessToken, t.statusDisconnected]);

  const refreshRelaySessions = React.useCallback(async () => {
    try {
      const [sessionsResponse, historyResponse] = await Promise.all([
        gatewayRequest('/api/sessions'),
        gatewayRequest('/api/sessions?all=1')
      ]);
      if (sessionsResponse.status === 401 || historyResponse.status === 401) {
        logoutNormal();
      }
      if (!sessionsResponse.ok) {
        throw new Error(`sessions HTTP ${sessionsResponse.status}`);
      }
      if (!historyResponse.ok) {
        throw new Error(`history HTTP ${historyResponse.status}`);
      }
      const sessionsData = await readGatewayData<{ sessions: Session[] }>(sessionsResponse);
      const historyData = await readGatewayData<{ sessions: Session[] }>(historyResponse);
      const active = sessionsData.sessions.filter((session) => session.status === 'running');
      const activeIds = new Set(active.map((session) => session.id));
      setSessions(active);
      setHistory(historyData.sessions.filter((session) => !activeIds.has(session.id)).slice(0, 8));
      setGateways([]);
      setStatus(new Date().toLocaleTimeString());
      setHasLoadedSessions(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.statusDisconnected);
      setHasLoadedSessions(true);
    }
  }, [logoutNormal, t.statusDisconnected]);

  React.useEffect(() => {
    if (connectionSettings.connectionMode !== 'direct') {
      return undefined;
    }
    setHasLoadedSessions(false);
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
    const preferServerReads = Boolean(normalAuth?.accessToken);
    setHasLoadedSessions(false);
    setSessions([]);
    setHistory([]);
    setGateways([]);
    setRelayGatewayUnavailable(false);
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
        if (preferServerReads) {
          void refreshRelaySessions();
          sendList();
          timer = window.setInterval(() => {
            void refreshRelaySessions();
            sendList();
          }, 3000);
        } else {
          setRelayGatewayUnavailable(false);
          sendList();
          timer = window.setInterval(sendList, 3000);
        }
        return;
      }
      if (frame.type === 'client.auth.failed') {
        setRelayGatewayUnavailable(false);
        setStatus(displayMessage(frame.message, t));
        setHasLoadedSessions(true);
        ws?.close();
        return;
      }
      if (frame.type === 'sessions') {
        setRelayGatewayUnavailable(false);
        if (preferServerReads) {
          void refreshRelaySessions();
        } else {
          const next = splitActiveSessions(frame.sessions);
          setSessions(next.active);
          setHistory(next.history);
          setStatus(new Date().toLocaleTimeString());
          setHasLoadedSessions(true);
        }
        return;
      }
      if (frame.type === 'error') {
        if (frame.code === 'gateway_unavailable') {
          setRelayGatewayUnavailable(true);
          setStatus(t.gatewayNotConnected);
          setHasLoadedSessions(true);
          return;
        }
        setRelayGatewayUnavailable(false);
        setStatus(displayMessage(frame.message, t));
        setHasLoadedSessions(true);
      }
    });
    ws.addEventListener('close', () => {
      if (!disposed) {
        setStatus(t.statusRelayClosed);
        setRelayGatewayUnavailable(false);
        setHasLoadedSessions(true);
      }
    });
    ws.addEventListener('error', () => {
      if (!disposed) {
        setStatus(t.statusRelayError);
        setRelayGatewayUnavailable(false);
        setHasLoadedSessions(true);
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
  }, [connectionSettings.connectionMode, connectionSettings.relaySecret, connectionSettings.relayUrl, logoutNormal, normalAuth?.accessToken, refreshRelaySessions, t]);

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
      headers: gatewayAuthHeaders()
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

  const activeGateway = gateways[0];
  const isRelayMode = connectionSettings.connectionMode === 'relay';
  const isRelayGatewayUnavailable = isRelayMode && relayGatewayUnavailable && sessions.length === 0 && history.length === 0;
  const emptyStateIcon = isRelayGatewayUnavailable
    ? <WifiOff aria-hidden="true" />
    : <MonitorDot aria-hidden="true" />;
  const emptyStateTitle = isRelayGatewayUnavailable ? t.gatewayNotConnected : t.noSessions;
  const emptyStateDescription = isRelayGatewayUnavailable
    ? t.relayGatewayUnavailableDescription
    : t.noSessionsDescription;
  const statusIcon = isRelayGatewayUnavailable || status === t.statusDisconnected || status === t.statusRelayClosed || status === t.statusRelayError
    ? <WifiOff aria-hidden="true" />
    : <Wifi aria-hidden="true" />;

  return (
    <div className="session-list-page">
      <header className="session-list-topbar">
        <div className="session-list-brand">
          <span className="session-list-brand-icon"><TerminalSquare aria-hidden="true" /></span>
          <div>
            <h1>{t.sessionConsoleTitle}</h1>
            <p>{isRelayMode ? t.sessionConsoleRelay : t.sessionConsoleDirect}</p>
          </div>
        </div>
        <div className="session-list-controls">
          {connectionSettings.connectionMode === 'direct' ? (
            <div className="mode-select">
              <Label>{t.transport}</Label>
              <Select value={webTransportMode} onValueChange={(value) => changeWebTransportMode(value as WebTransportMode)}>
                <SelectTrigger className="connection-select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ws">WS</SelectItem>
                  <SelectItem value="http">{t.httpFallback}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="session-header-actions">
            <div className="status session-sync-status">
              {statusIcon}
              <span>{status}</span>
            </div>
            <WebHeaderPreferences />
            <ConnectionSettingsControl settings={connectionSettings} onChange={onConnectionSettingsChange} />
            <Button className="session-sign-out-button" variant="outline" size="sm" type="button" onClick={logoutNormal} aria-label={t.signOut}>
              <LogOut aria-hidden="true" />
              <span>{t.signOut}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="session-list">
        {!hasLoadedSessions ? (
          <SessionListSkeleton />
        ) : (
          <>
            <section className="session-overview" aria-label={t.sessionOverview}>
              <div className="session-overview-main">
                <span className="session-kicker">{t.sessionShell}</span>
                <h2>{t.sessionDashboardTitle}</h2>
                <p>{t.sessionDashboardDescription}</p>
              </div>
              <div className="session-metrics" aria-label={t.sessionStats}>
                <div className="session-metric">
                  <Activity aria-hidden="true" />
                  <span>{t.activeSessions}</span>
                  <strong>{sessions.length}</strong>
                </div>
                <div className="session-metric">
                  <Clock3 aria-hidden="true" />
                  <span>{t.history}</span>
                  <strong>{history.length}</strong>
                </div>
                <div className="session-metric">
                  <Router aria-hidden="true" />
                  <span>{t.gatewayList}</span>
                  <strong>{isRelayMode ? t.relay : gateways.length}</strong>
                </div>
              </div>
            </section>

            <div className="session-workbench-grid">
              <section className="session-panel session-section session-primary-panel" aria-label={t.activeSessions}>
                <div className="session-panel-heading">
                  <div>
                    <span>{t.activeSessions}</span>
                    <h2>{t.sessionActiveTitle}</h2>
                  </div>
                </div>
                {sessions.length === 0 ? (
                  <div className="empty session-empty-state">
                    {emptyStateIcon}
                    <h2>{emptyStateTitle}</h2>
                    <p>{emptyStateDescription}</p>
                  </div>
                ) : (
                  <div className="session-card-grid">
                    {sessions.map((session) => (
                      <SessionCard session={session} key={session.id} onStop={stopSession} t={t} />
                    ))}
                  </div>
                )}
              </section>

              <aside className="session-side-stack">
                <section className="session-panel gateway-list" aria-label={t.gatewayList}>
                  <div className="session-panel-heading">
                    <div>
                      <span>{t.activeGateway}</span>
                      <h2>{isRelayMode ? t.relay : activeGateway?.url ?? t.noGateways}</h2>
                    </div>
                    <span className="session-panel-badge">{connectionSettings.connectionMode}</span>
                  </div>
                  {gateways.length > 0 ? (
                    <div className="gateway-grid">
                      {gateways.map((gateway) => (
                        <div className="gateway-row" key={gateway.id}>
                          <Server aria-hidden="true" />
                          <span>{gateway.url}</span>
                          <span>{t.pidLabel} {gateway.pid}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="session-panel-empty">{isRelayMode ? t.relayGatewayHint : t.noGatewaysDescription}</p>
                  )}
                </section>

                {history.length > 0 ? (
                  <details className="session-panel session-section history-section" open>
                    <summary>
                      <span>
                        <Clock3 aria-hidden="true" />
                        {t.history}
                      </span>
                      <strong>{history.length}</strong>
                    </summary>
                    <div className="session-card-grid session-history-grid">
                      {history.map((session) => (
                        <SessionCard session={session} key={session.id} target="replay" t={t} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SessionListSkeleton() {
  return (
    <>
      <section className="session-overview session-skeleton-overview" aria-hidden="true">
        <div className="session-overview-main">
          <Skeleton className="session-skeleton-line session-skeleton-kicker" />
          <Skeleton className="session-skeleton-line session-skeleton-title" />
          <Skeleton className="session-skeleton-line session-skeleton-copy" />
        </div>
        <div className="session-metrics">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="session-metric session-skeleton-metric" key={index}>
              <Skeleton className="session-skeleton-icon" />
              <Skeleton className="session-skeleton-line session-skeleton-label" />
              <Skeleton className="session-skeleton-line session-skeleton-number" />
            </div>
          ))}
        </div>
      </section>
      <div className="session-workbench-grid" aria-hidden="true">
        <section className="session-panel session-section session-primary-panel">
          <div className="session-panel-heading">
            <div>
              <Skeleton className="session-skeleton-line session-skeleton-label" />
              <Skeleton className="session-skeleton-line session-skeleton-heading" />
            </div>
          </div>
          <div className="session-card-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <SessionCardSkeleton key={index} />
            ))}
          </div>
        </section>
        <aside className="session-side-stack">
          <section className="session-panel gateway-list">
            <div className="session-panel-heading">
              <div>
                <Skeleton className="session-skeleton-line session-skeleton-label" />
                <Skeleton className="session-skeleton-line session-skeleton-heading" />
              </div>
              <Skeleton className="session-skeleton-pill" />
            </div>
            <div className="gateway-grid">
              <Skeleton className="session-skeleton-row" />
              <Skeleton className="session-skeleton-row" />
            </div>
          </section>
          <section className="session-panel session-section history-section">
            <div className="history-skeleton-heading">
              <Skeleton className="session-skeleton-line session-skeleton-heading" />
              <Skeleton className="session-skeleton-number" />
            </div>
            <div className="session-card-grid session-history-grid">
              <SessionCardSkeleton />
              <SessionCardSkeleton />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function SessionCardSkeleton() {
  return (
    <div className="session-card session-card-skeleton">
      <Skeleton className="session-skeleton-card-icon" />
      <div className="session-skeleton-card-main">
        <Skeleton className="session-skeleton-line session-skeleton-card-title" />
        <Skeleton className="session-skeleton-line session-skeleton-card-path" />
      </div>
      <Skeleton className="session-skeleton-pill" />
      <Skeleton className="session-skeleton-pill" />
      <div className="session-card-meta">
        <Skeleton className="session-skeleton-chip" />
        <Skeleton className="session-skeleton-chip session-skeleton-chip-wide" />
        <Skeleton className="session-skeleton-chip" />
      </div>
      <Skeleton className="session-skeleton-line session-skeleton-card-id" />
      <Skeleton className="session-skeleton-pill" />
    </div>
  );
}

function resumeCommand(provider: string, agentSessionId: string): string {
  if (provider === 'claude' || provider === 'claude-proxy') return `claude --resume ${agentSessionId}`;
  if (provider === 'codex' || provider === 'codex-proxy') return `codex exec resume ${agentSessionId}`;
  if (provider === 'copilot') return `gh copilot resume ${agentSessionId}`;
  return agentSessionId;
}

function AgentSessionBadge({ provider, agentSessionId, t }: { provider: string; agentSessionId: string; t: WebMessages }) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(() => {
    void navigator.clipboard.writeText(resumeCommand(provider, agentSessionId)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [provider, agentSessionId]);
  return (
    <Button variant="outline" size="icon" type="button" title={`${agentSessionId.slice(0, 8)} · ${t.copyResumeCommand}`} onClick={copy}>
      {copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
    </Button>
  );
}

function SessionCard({
  session,
  onStop,
  target = 'control',
  t
}: {
  session: Session;
  onStop?: (sessionId: string) => void;
  target?: 'control' | 'replay';
  t: WebMessages;
}) {
  const [stopDialogOpen, setStopDialogOpen] = React.useState(false);
  const statusLabel = sessionStatusLabel(session.status, t);
  const transport = session.transport ?? t.fallbackTmuxTransport;
  const sessionPath = `/remote/session/${encodeURIComponent(session.id)}${target === 'replay' ? '/replay' : ''}`;
  const simpleSessionPath = `/remote/session/${encodeURIComponent(session.id)}/chat`;
  const openLabel = target === 'replay' ? t.replay : t.enterSession;
  const sessionName = session.title || session.provider || session.id;
  const confirmStop = React.useCallback(() => {
    if (!onStop) return;
    setStopDialogOpen(false);
    onStop(session.id);
  }, [onStop, session.id]);

  return (
    <div className={`session-card session-card-${statusTone(session.status)}`}>
      <span className="session-card-icon"><TerminalSquare aria-hidden="true" /></span>
      <span className="session-card-main">
        <span className="session-card-title-row">
          <span className="session-card-title">{session.title || session.provider}</span>
          {onStop ? (
            <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
              <Button className="session-card-stop" variant="ghost" size="icon" type="button" onClick={() => setStopDialogOpen(true)} aria-label={t.stop}>
                <Power aria-hidden="true" />
              </Button>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.stopSessionConfirmTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.stopSessionConfirmDescription.replace('{session}', sessionName)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={confirmStop}>
                    {t.confirmStop}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {session.agentSessionId ? (
            <AgentSessionBadge provider={session.provider} agentSessionId={session.agentSessionId} t={t} />
          ) : null}
        </span>
        <span className="session-card-path">{session.projectPath || t.unknownProjectPath}</span>
        <span className="session-card-id">{session.id}</span>
      </span>
      <span className="session-card-meta">
        <span>{session.provider}</span>
        <span>{transport}</span>
        <span>{formatSessionTime(session.lastActiveAt)}</span>
      </span>
      <span className={`session-status-pill session-status-${statusTone(session.status)}`}>{statusLabel}</span>
      <div className="session-card-actions">
        {target === 'control' ? (
          <Link
            className="session-card-open session-card-simple"
            to={simpleSessionPath}
            state={{ agentSessionId: session.agentSessionId, provider: session.provider }}
            aria-label={`${t.simpleView}: ${session.title || session.id}`}
          >
            {t.simpleView}
          </Link>
        ) : null}
        <Link
          className="session-card-open"
          to={sessionPath}
          state={{ agentSessionId: session.agentSessionId, provider: session.provider }}
          aria-label={`${t.openSession}: ${session.title || session.id}`}
        >
          {openLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
