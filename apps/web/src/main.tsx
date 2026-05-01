import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
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

function buildRelayClientUrl(relayUrl: string): string {
  const value = relayUrl.trim();
  if (!value) {
    throw new Error('Relay URL required');
  }
  const url = new URL(value);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Relay URL must use ws, wss, http, or https');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sessionIdFromPath(): string | undefined {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'remote' && parts[1] === 'session') {
    return parts[2];
  }
  return undefined;
}

function App() {
  const sessionId = sessionIdFromPath();
  const [connectionSettings, setConnectionSettings] = React.useState<ConnectionSettings>(readConnectionSettings);

  const updateConnectionSettings = React.useCallback((next: ConnectionSettings) => {
    window.localStorage.setItem(CONNECTION_MODE_KEY, next.connectionMode);
    window.localStorage.setItem(RELAY_URL_KEY, next.relayUrl);
    window.localStorage.setItem(RELAY_SECRET_KEY, next.relaySecret);
    setConnectionSettings(next);
  }, []);

  if (!sessionId) {
    return <SessionList connectionSettings={connectionSettings} onConnectionSettingsChange={updateConnectionSettings} />;
  }

  return (
    <SessionView
      sessionId={sessionId}
      connectionSettings={connectionSettings}
      onConnectionSettingsChange={updateConnectionSettings}
    />
  );
}

function ConnectionSettingsControl({
  settings,
  onChange
}: {
  settings: ConnectionSettings;
  onChange: (settings: ConnectionSettings) => void;
}) {
  const update = React.useCallback((patch: Partial<ConnectionSettings>) => {
    onChange({ ...settings, ...patch });
  }, [onChange, settings]);

  return (
    <div className="connection-settings" aria-label="Connection settings">
      <label className="mode-select">
        Connection
        <select value={settings.connectionMode} onChange={(event) => update({ connectionMode: event.target.value as ConnectionMode })}>
          <option value="direct">Direct</option>
          <option value="relay">Relay</option>
        </select>
      </label>
      {settings.connectionMode === 'relay' ? (
        <>
          <label className="relay-field">
            Relay URL
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="wss://relay.example.com"
              value={settings.relayUrl}
              onChange={(event) => update({ relayUrl: event.target.value })}
            />
          </label>
          <label className="relay-field">
            Secret
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Relay secret"
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
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [history, setHistory] = React.useState<Session[]>([]);
  const [gateways, setGateways] = React.useState<Gateway[]>([]);
  const [webTransportMode, setWebTransportMode] = React.useState<WebTransportMode>(readWebTransportMode);
  const [status, setStatus] = React.useState('Loading');

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
      const activeIds = new Set(sessionsData.sessions.map((session) => session.id));
      setSessions(sessionsData.sessions);
      setHistory(historyData.sessions.filter((session) => !activeIds.has(session.id)).slice(0, 8));
      setGateways(gatewaysData.gateways);
      setStatus(new Date().toLocaleTimeString());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Disconnected');
    }
  }, []);

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
      ws = new WebSocket(buildRelayClientUrl(connectionSettings.relayUrl));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invalid relay URL');
      return undefined;
    }
    const sendList = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'client.list' }));
      }
    };
    ws.addEventListener('open', () => {
      if (disposed) return;
      setStatus('Authenticating relay');
      ws?.send(JSON.stringify({ type: 'client.auth', secret: connectionSettings.relaySecret }));
    });
    ws.addEventListener('message', (message) => {
      if (disposed) return;
      const frame = JSON.parse(message.data as string) as RelayServerToClientFrame;
      if (frame.type === 'client.auth.ok') {
        setStatus(`Relay · ${frame.clientId.slice(0, 8)}`);
        sendList();
        timer = window.setInterval(sendList, 3000);
        return;
      }
      if (frame.type === 'client.auth.failed') {
        setStatus(frame.message);
        ws?.close();
        return;
      }
      if (frame.type === 'sessions') {
        setSessions(frame.sessions);
        setStatus(new Date().toLocaleTimeString());
        return;
      }
      if (frame.type === 'error') {
        setStatus(frame.message);
      }
    });
    ws.addEventListener('close', () => {
      if (!disposed) {
        setStatus('Relay disconnected');
      }
    });
    ws.addEventListener('error', () => {
      if (!disposed) {
        setStatus('Relay error');
      }
    });
    return () => {
      disposed = true;
      if (timer) {
        window.clearInterval(timer);
      }
      ws?.close();
    };
  }, [connectionSettings.connectionMode, connectionSettings.relaySecret, connectionSettings.relayUrl]);

  return (
    <>
      <header>
        <h1>Tether</h1>
        <div className="header-actions">
          <ConnectionSettingsControl settings={connectionSettings} onChange={onConnectionSettingsChange} />
          {connectionSettings.connectionMode === 'direct' ? (
            <label className="mode-select">
              Web
              <select value={webTransportMode} onChange={(event) => changeWebTransportMode(event.target.value as WebTransportMode)}>
                <option value="ws">WS</option>
                <option value="http">HTTP fallback</option>
              </select>
            </label>
          ) : null}
          <div className="status">{status}</div>
        </div>
      </header>
      <main className="session-list">
        {gateways.length > 0 ? (
          <section className="gateway-list" aria-label="Gateways">
            {gateways.map((gateway) => (
              <div className="gateway-row" key={gateway.id}>
                <span>{gateway.url}</span>
                <span>pid {gateway.pid}</span>
              </div>
            ))}
          </section>
        ) : null}
        {sessions.length === 0 ? (
          <div className="empty">
            <h2>No sessions</h2>
            <p>Start one with the CLI, then refresh this page.</p>
          </div>
        ) : (
          <section className="session-section" aria-label="Active sessions">
            <div className="section-heading">Active</div>
            {sessions.map((session) => (
              <SessionCard session={session} key={session.id} />
            ))}
          </section>
        )}
        {history.length > 0 ? (
          <details className="session-section history-section">
            <summary>History</summary>
            {history.map((session) => (
              <SessionCard session={session} key={session.id} />
            ))}
          </details>
        ) : null}
      </main>
    </>
  );
}

function SessionCard({ session }: { session: Session }) {
  return (
    <a className="session-card" href={`/remote/session/${encodeURIComponent(session.id)}`}>
      <span className="session-card-title">{session.title || session.provider}</span>
      <span className="session-card-meta">
        {session.provider} · {session.status} · {session.transport ?? 'tmux'} ·{' '}
        {new Date(session.lastActiveAt).toLocaleTimeString()}
      </span>
      <span className="session-card-id">{session.id}</span>
      <span className="session-card-path">{session.projectPath}</span>
    </a>
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
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ text: '', capturedAt: Date.now() });
  const [status, setStatus] = React.useState('Connecting');
  const [text, setText] = React.useState('');
  const [transport, setTransport] = React.useState<string>();
  const scrollRef = React.useRef<HTMLElement>(null);

  const refresh = React.useCallback(async () => {
    if (connectionSettings.connectionMode === 'relay') {
      setTransport('pty-event-stream');
      setStatus('Relay');
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
      setStatus(error instanceof Error ? error.message : 'Disconnected');
    }
  }, [connectionSettings.connectionMode, sessionId]);

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
    setStatus('Sending');
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: value })
    });
    if (!response.ok) {
      setStatus(`Send failed: HTTP ${response.status}`);
      setText(value);
      return;
    }
    await refresh();
  }

  return (
    <>
      <header>
        <h1>Tether</h1>
        <div className="status">{status}</div>
      </header>
      <main ref={scrollRef} className="scrollport">
        <pre>{snapshot.text}</pre>
      </main>
      <form onSubmit={send}>
        <textarea
          rows={1}
          autoComplete="off"
          placeholder="Send to agent"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit">Send</button>
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
      setStatus('Observe mode');
      return false;
    }
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data })
    });
    if (!response.ok) {
      setStatus(`Input failed: HTTP ${response.status}`);
      return false;
    }
    return true;
  }, [clientMode, connectionSettings.connectionMode, sessionId]);

  const sendWsInput = React.useCallback((data: string): boolean => {
    if (clientMode === 'observe') {
      setStatus('Observe mode');
      return false;
    }
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus('WS unavailable');
      return false;
    }
    ws.send(JSON.stringify(
      connectionSettings.connectionMode === 'relay'
        ? { type: 'client.input', sessionId, data }
        : { type: 'input', data }
    ));
    return true;
  }, [clientMode, connectionSettings.connectionMode, sessionId]);

  const sendTerminalInput = React.useCallback((data: string): void => {
    if (connectionSettings.connectionMode === 'direct' && transportMode === 'http') {
      sendHttpInput(data).catch(() => setStatus('Input failed'));
      return;
    }
    sendWsInput(data);
  }, [connectionSettings.connectionMode, sendHttpInput, sendWsInput, transportMode]);

  const sendLine = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text;
    if (!value) {
      return;
    }
    setStatus('Sending');
    const send = connectionSettings.connectionMode === 'direct' && transportMode === 'http'
      ? sendHttpInput(`${value}\r`)
      : Promise.resolve(sendWsInput(`${value}\r`));
    send
      .then((ok) => {
        if (!ok) return;
        setText('');
        setStatus(connectionSettings.connectionMode === 'relay' ? 'Sent · Relay' : transportMode === 'http' ? 'Sent · HTTP' : 'Sent · WS');
        terminal.current?.focus();
      })
      .catch(() => setStatus('Input failed'));
  }, [connectionSettings.connectionMode, sendHttpInput, sendWsInput, text, transportMode]);

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
      theme: {
        background: '#0c0e10',
        foreground: '#e8ecef',
        cursor: '#8fd0ff'
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
        setStatus('Exited');
      }
    };

    const replayEvents = async () => {
      if (connectionSettings.connectionMode === 'relay') {
        replayComplete = false;
        return;
      }
      setStatus('Replaying');
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
        setStatus('Streaming · HTTP fallback');
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
          setStatus('Authenticating relay');
          nextWs.send(JSON.stringify({ type: 'client.auth', secret: connectionSettings.relaySecret }));
          return;
        }
        setStatus('Streaming · WS');
        sendResize();
      });
      nextWs.addEventListener('message', (message) => {
        if (disposed || socket.current !== ws) {
          return;
        }
        const parsedFrame = JSON.parse(message.data as string);
        if (connectionSettings.connectionMode === 'relay') {
          const frame = parsedFrame as RelayServerToClientFrame;
          if (frame.type === 'client.auth.ok') {
            setStatus(`Relay · ${frame.clientId.slice(0, 8)}`);
            nextWs.send(JSON.stringify({ type: 'client.subscribe', sessionId, after, mode: clientMode }));
            return;
          }
          if (frame.type === 'client.auth.failed') {
            setStatus(frame.message);
            nextWs.close();
            return;
          }
          if (frame.type === 'hello') {
            setStatus(`Relay · ${frame.clientId.slice(0, 8)}`);
            return;
          }
          if (frame.type === 'error') {
            setStatus(frame.message);
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
          setStatus(`Streaming · ${frame.clientId.slice(0, 8)}`);
          return;
        }
        if (frame.type === 'error') {
          setStatus(frame.message);
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
          setStatus('Exited');
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
        setStatus((current) => (current === 'Exited' ? current : 'Disconnected'));
      });
      nextWs.addEventListener('error', () => {
        if (disposed || socket.current !== ws) {
          return;
        }
        setStatus('Stream error');
      });
    };
    const openStreamWebSocket = async (): Promise<WebSocket> => {
      if (connectionSettings.connectionMode === 'relay') {
        return new WebSocket(buildRelayClientUrl(connectionSettings.relayUrl));
      }
      const response = await fetch('/api/ws-ticket', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`ticket HTTP ${response.status}`);
      }
      const { ticket } = (await response.json()) as { ticket: string };
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return new WebSocket(
        `${scheme}://${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/stream?after=${after}&ticket=${encodeURIComponent(ticket)}&surface=web&mode=${clientMode}`
      );
    };
    connectStream().catch((error: unknown) => {
      if (!disposed) {
        setStatus(error instanceof Error ? error.message : 'Stream unavailable');
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
    refreshClients,
    sendTerminalInput,
    sessionId,
    transportMode
  ]);

  async function stopSession(): Promise<void> {
    if (connectionSettings.connectionMode === 'relay') {
      setStatus('Stop is direct-only');
      return;
    }
    setStatus('Stopping');
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
    setStatus(response.ok ? 'Stopped' : `Stop failed: HTTP ${response.status}`);
  }

  return (
    <>
      <header>
        <h1>Tether</h1>
        <div className="header-actions">
          <ConnectionSettingsControl settings={connectionSettings} onChange={onConnectionSettingsChange} />
          <label className="mode-select">
            Mode
            <select value={clientMode} onChange={(event) => changeClientMode(event.target.value as ClientMode)}>
              <option value="control">Control</option>
              <option value="observe">Observe</option>
            </select>
          </label>
          {connectionSettings.connectionMode === 'direct' ? (
            <button className="secondary-button" type="button" onClick={() => stopSession()}>Stop</button>
          ) : null}
          <div className="status">{status}</div>
        </div>
      </header>
      <main className="terminal-shell" onMouseDown={() => terminal.current?.focus()}>
        <div ref={terminalRef} className="terminal-host" />
        {clients.length > 0 ? (
          <aside className="client-strip">
            <span>controller {controllerClientId ? controllerClientId.slice(0, 8) : '-'}</span>
            <span>{clients.length} client{clients.length === 1 ? '' : 's'}</span>
            <span>{transportMode.toUpperCase()}</span>
          </aside>
        ) : connectionSettings.connectionMode === 'relay' ? (
          <aside className="client-strip">
            <span>Relay</span>
            <span>{clientMode}</span>
          </aside>
        ) : null}
      </main>
      <form onSubmit={sendLine}>
        <textarea
          rows={1}
          autoComplete="off"
          placeholder="Send to agent"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit">Send</button>
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
