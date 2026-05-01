import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import type { RelayGatewayToServerFrame, RelayServerToClientFrame } from '@tether/protocol';
import { startRelayServer } from '../../relay/src/relay.js';
import { createSessionId } from './ids.js';
import { PtySessionManager } from './pty.js';
import { startRelayClient } from './relay-client.js';
import { Store } from './store.js';

const SECRET = 'relay-client-test-secret';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-relay-client-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('gateway relay client registers sessions', async () => {
  const { store, cleanup } = tempStore();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4911, secret: SECRET });
  const now = Date.now();
  store.insertSession({
    id: 'tth_relay_registered',
    provider: 'codex',
    title: 'registered',
    projectPath: process.cwd(),
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_register', store });
  const client = await connectRelayClient(relay.url);

  try {
    client.send(JSON.stringify({ type: 'client.list' }));
    const sessions = await waitForFrame(client, (frame) => frame.type === 'sessions');
    assert.equal(sessions.type, 'sessions');
    assert.equal(sessions.sessions.some((session) => session.id === 'tth_relay_registered'), true);
  } finally {
    client.close();
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client replays and forwards output', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4912, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const replayed = store.appendEvent(sessionId, 'terminal.output', { data: 'from replay\r\n', encoding: 'utf8' });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_replay', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayPromise = waitForFrame(
      client,
      (frame) => frame.type === 'event' && frame.event.type === 'terminal.output' && frame.event.payload.data === 'from replay\r\n'
    );
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: replayed.id - 1, mode: 'control' }));
    const replayFrame = await replayPromise;
    assert.equal(replayFrame.type, 'event');
    await replayDonePromise;

    const livePromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'terminal.output' &&
        typeof frame.event.payload.data === 'string' &&
        frame.event.payload.data.includes('from live')
    );
    assert.equal(ptySessions.write(sessionId, { clientId: 'local-test', data: 'from live\r' }), true);
    const liveFrame = await livePromise;
    assert.equal(liveFrame.type, 'event');
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client forwards control input to pty', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4913, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_input', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await replayDonePromise;
    const outputPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'terminal.output' &&
        typeof frame.event.payload.data === 'string' &&
        frame.event.payload.data.includes('relay input')
    );
    client.send(JSON.stringify({ type: 'client.input', sessionId, data: 'relay input\r' }));
    await waitFor(() =>
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'user.input' && event.payload.data === 'relay input\r')
    );
    const output = await outputPromise;
    assert.equal(output.type, 'event');
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client forwards control resize to pty', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4916, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_resize', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await replayDonePromise;
    client.send(JSON.stringify({ type: 'client.resize', sessionId, cols: 100, rows: 30 }));
    await waitFor(() =>
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'terminal.resize' && event.payload.cols === 100 && event.payload.rows === 30)
    );
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client blocks observe input', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4914, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'observe' }));
    await waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.input', sessionId, data: 'blocked input\r' }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'observe_only');
    assert.equal(error.type, 'error');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'user.input' && event.payload.data === 'blocked input\r'),
      false
    );
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client blocks observe resize', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4917, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe_resize', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'observe' }));
    await waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.resize', sessionId, cols: 100, rows: 30 }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'observe_only');
    assert.equal(error.type, 'error');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'terminal.resize' && event.payload.cols === 100),
      false
    );
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client blocks unsubscribed input', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4915, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.input', sessionId, data: 'blocked input\r' }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'not_subscribed');
    assert.equal(error.type, 'error');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'user.input' && event.payload.data === 'blocked input\r'),
      false
    );
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client blocks unsubscribed resize', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4918, secret: SECRET });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed_resize', store, ptySessions });
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.resize', sessionId, cols: 100, rows: 30 }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'not_subscribed');
    assert.equal(error.type, 'error');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'terminal.resize' && event.payload.cols === 100),
      false
    );
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client rejects invalid resize dimensions', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 4919 });
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const relayClient = startRelayClient({ url: 'ws://127.0.0.1:4919', secret: SECRET, gatewayId: 'gw_test_bad_resize', store, ptySessions });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_test_bad_resize' }));
    gatewaySocket.send(JSON.stringify({ type: 'client.subscribe', clientId: 'relay_bad_resize', sessionId, after: 0, mode: 'control' }));
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.replay' && frame.clientId === 'relay_bad_resize');
    gatewaySocket.send(JSON.stringify({ type: 'client.resize', clientId: 'relay_bad_resize', sessionId, cols: 0, rows: 0 }));
    const error = await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.error' && frame.code === 'bad_resize');
    assert.equal(error.type, 'gateway.error');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'terminal.resize' && event.payload.cols === 0),
      false
    );
  } finally {
    ptySessions.stop(sessionId);
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});

async function connectRelayClient(relayUrl: string): Promise<WebSocket> {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/client';
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'client.auth', secret: SECRET }));
  await waitForFrame(ws, (frame) => frame.type === 'client.auth.ok');
  return ws;
}

async function waitForSessionList(ws: WebSocket, sessionId: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'client.list' }));
  await waitForFrame(
    ws,
    (frame) => frame.type === 'sessions' && frame.sessions.some((session) => session.id === sessionId)
  );
}

async function waitForFrame(
  ws: WebSocket,
  predicate: (frame: RelayServerToClientFrame) => boolean,
  timeoutMs = 1500
): Promise<RelayServerToClientFrame> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for relay frame'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString()) as RelayServerToClientFrame;
      if (predicate(frame)) {
        cleanup();
        resolve(frame);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function waitForGatewaySocket(server: WebSocketServer): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for gateway socket')), 1500);
    server.once('connection', (socket) => {
      clearTimeout(timer);
      resolve(socket);
    });
    server.once('error', reject);
  });
}

async function waitForGatewayFrame(
  ws: WebSocket,
  predicate: (frame: RelayGatewayToServerFrame) => boolean,
  timeoutMs = 1500
): Promise<RelayGatewayToServerFrame> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for gateway frame'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString()) as RelayGatewayToServerFrame;
      if (predicate(frame)) {
        cleanup();
        resolve(frame);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.close();
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}
