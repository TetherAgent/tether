import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Snapshot = {
  text: string;
  capturedAt: number;
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
    return (
      <main className="empty">
        <h1>Tether</h1>
        <p>Select a session from the CLI output.</p>
      </main>
    );
  }

  return <SessionView sessionId={sessionId} />;
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
