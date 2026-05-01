import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Snapshot = {
  text: string;
  capturedAt: number;
};

type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: string;
  lastActiveAt: number;
};

type Gateway = {
  id: string;
  url: string;
  pid: number;
  lastSeenAt: number;
};

function sessionIdFromPath(): string | undefined {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'remote' && parts[1] === 'session') {
    return parts[2];
  }
  return undefined;
}

function App() {
  const sessionId = sessionIdFromPath();

  if (!sessionId) {
    return <SessionList />;
  }

  return <SessionView sessionId={sessionId} />;
}

function SessionList() {
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [gateways, setGateways] = React.useState<Gateway[]>([]);
  const [status, setStatus] = React.useState('Loading');

  const refresh = React.useCallback(async () => {
    try {
      const [sessionsResponse, gatewaysResponse] = await Promise.all([
        fetch('/api/sessions'),
        fetch('/api/gateways')
      ]);
      if (!sessionsResponse.ok) {
        throw new Error(`sessions HTTP ${sessionsResponse.status}`);
      }
      if (!gatewaysResponse.ok) {
        throw new Error(`gateways HTTP ${gatewaysResponse.status}`);
      }
      const sessionsData = (await sessionsResponse.json()) as { sessions: Session[] };
      const gatewaysData = (await gatewaysResponse.json()) as { gateways: Gateway[] };
      setSessions(sessionsData.sessions);
      setGateways(gatewaysData.gateways);
      setStatus(new Date().toLocaleTimeString());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Disconnected');
    }
  }, []);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <>
      <header>
        <h1>Tether</h1>
        <div className="status">{status}</div>
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
          sessions.map((session) => (
            <a className="session-card" href={`/remote/session/${encodeURIComponent(session.id)}`} key={session.id}>
              <span className="session-card-title">{session.title || session.provider}</span>
              <span className="session-card-meta">
                {session.provider} · {session.status} · {new Date(session.lastActiveAt).toLocaleTimeString()}
              </span>
              <span className="session-card-id">{session.id}</span>
              <span className="session-card-path">{session.projectPath}</span>
            </a>
          ))
        )}
      </main>
    </>
  );
}

function SessionView({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = React.useState<Snapshot>({ text: '', capturedAt: Date.now() });
  const [status, setStatus] = React.useState('Connecting');
  const [text, setText] = React.useState('');
  const scrollRef = React.useRef<HTMLElement>(null);

  const refresh = React.useCallback(async () => {
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
  }, [sessionId]);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

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

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
