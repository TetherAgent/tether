import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { startDaemon } from './daemon.js';
import { createSessionId } from './ids.js';
import { PtySessionManager } from './pty.js';
import { Store } from './store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-daemon-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('daemon marks running pty sessions lost when no live handle exists', async () => {
  const { store, cleanup } = tempStore();
  const now = Date.now();
  store.insertSession({
    id: 'tth_lost_test',
    provider: 'codex',
    title: 'lost',
    projectPath: process.cwd(),
    status: 'running',
    attachState: 'attached',
    tmuxSessionName: '',
    command: 'codex',
    pid: 999999,
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });

  const daemon = await startDaemon({ host: '127.0.0.1', port: 4891, store, ptySessions: new PtySessionManager(store) });
  try {
    assert.equal(store.getSession('tth_lost_test')?.status, 'lost');
    assert.equal(store.listEvents('tth_lost_test').some((event) => event.type === 'session.error'), true);
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('observe websocket clients cannot write input', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4892, store, ptySessions });

  try {
    const ticket = await requestTicket(4892);
    const ws = new WebSocket(`ws://127.0.0.1:4892/api/sessions/${sessionId}/stream?ticket=${ticket}&mode=observe&surface=test`);
    const message = await waitForMessage(ws, (text) => text.includes('replay.done'));
    assert.match(message, /replay\.done/);
    ws.send(JSON.stringify({ type: 'input', data: 'blocked\r' }));
    const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
    assert.match(error, /observe_only/);
    assert.equal(store.listEvents(sessionId).some((event) => event.type === 'user.input' && event.payload.data === 'blocked\r'), false);
    ws.close();
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('previous direct controller cannot write after control is claimed', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4894, store, ptySessions });

  try {
    const firstTicket = await requestTicket(4894);
    const first = new WebSocket(`ws://127.0.0.1:4894/api/sessions/${sessionId}/stream?ticket=${firstTicket}&mode=control&surface=test`);
    await waitForMessage(first, (text) => text.includes('replay.done'));

    const secondTicket = await requestTicket(4894);
    const second = new WebSocket(`ws://127.0.0.1:4894/api/sessions/${sessionId}/stream?ticket=${secondTicket}&mode=control&surface=test`);
    await waitForMessage(second, (text) => text.includes('replay.done'));

    first.send(JSON.stringify({ type: 'input', data: 'stale controller\r' }));
    const error = await waitForMessage(first, (text) => text.includes('not_controller'));
    assert.match(error, /not_controller/);
    assert.equal(store.listEvents(sessionId).some((event) => event.type === 'user.input' && event.payload.data === 'stale controller\r'), false);

    first.close();
    second.close();
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('stop endpoint terminates live pty session', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4893, store, ptySessions });

  try {
    const response = await fetch(`http://127.0.0.1:4893/api/sessions/${sessionId}/stop`, { method: 'POST' });
    assert.equal(response.ok, true);
    await waitFor(() => store.getSession(sessionId)?.status !== 'running', 1000);
    assert.equal(ptySessions.hasLiveSession(sessionId), false);
  } finally {
    await daemon.close();
    cleanup();
  }
});

async function requestTicket(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, { method: 'POST' });
  const body = (await response.json()) as { ticket?: unknown };
  assert.equal(typeof body.ticket, 'string');
  return body.ticket as string;
}

async function waitForMessage(ws: WebSocket, predicate: (text: string) => boolean): Promise<string> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket message')), 1000);
    ws.on('message', (raw) => {
      const text = raw.toString();
      if (predicate(text)) {
        clearTimeout(timer);
        resolve(text);
      }
    });
    ws.on('error', reject);
  });
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}
