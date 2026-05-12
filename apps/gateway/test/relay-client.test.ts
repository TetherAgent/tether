import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import type { RelayAuthScope, RelayGatewayToServerFrame, RelayServerToClientFrame } from '@tether/protocol';
import { startRelayServer } from '../../relay/src/relay.js';
import { createSessionId } from '../src/utils/ids.js';
import { PtySessionManager } from '../src/pty/manager.js';
import { relayGatewayUrl, startRelayClient } from '../src/relay-client.js';
import { CodexChatRunner } from '../src/chat/chat-session-runner.js';
import type { SessionRunnerClient } from '../src/pty/session-runner-client.js';
import { tempSessionState, type TestSessionState } from './helpers/test-session-state.js';

const SECRET = 'relay-client-test-secret';
const GATEWAY_SCOPE = {
  accountId: 'acct_test',
  tokenClass: 'gateway_access',
  expiresAt: Date.now() + 60_000,
  jti: 'jti_gateway'
} satisfies RelayAuthScope;
const CLIENT_SCOPE = {
  accountId: 'acct_test',
  userId: 'user_test',
  tokenClass: 'normal_client_access',
  expiresAt: Date.now() + 60_000,
  jti: 'jti_client'
} satisfies RelayAuthScope;

function testOwner(gatewayId: string) {
  return {
    accountId: GATEWAY_SCOPE.accountId,
    userId: CLIENT_SCOPE.userId,
    gatewayId
  };
}

function relayAuthServer(options?: { gatewayId?: string }) {
  return startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gateway-token') {
        return { ...GATEWAY_SCOPE, gatewayId: options?.gatewayId };
      }
      if (token === 'client-token') {
        return CLIENT_SCOPE;
      }
      return undefined;
    }
  });
}


test('gateway relay URL preserves wss and avoids duplicate gateway path', () => {
  assert.equal(relayGatewayUrl('wss://relay.example.com'), 'wss://relay.example.com/ws/gateway');
  assert.equal(relayGatewayUrl('wss://relay.example.com/ws/gateway'), 'wss://relay.example.com/ws/gateway');
  assert.equal(relayGatewayUrl('https://relay.example.com'), 'wss://relay.example.com/ws/gateway');
  assert.equal(relayGatewayUrl('http://127.0.0.1:4889'), 'ws://127.0.0.1:4889/ws/gateway');
});

test('gateway relay client sends websocket heartbeat pings', async () => {
  const { store, cleanup } = tempStore();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_test_heartbeat',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_heartbeat' },
    ptySessions: store.ptySessions,
    heartbeatIntervalMs: 20,
    heartbeatTimeoutMs: 100
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_test_heartbeat' }));
    await waitForGatewayPing(gatewaySocket);
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});

function tempStore(): { store: TestSessionState; cleanup: () => void } {
  return tempSessionState();
}

test('gateway relay client registers sessions', async () => {
  const { store, cleanup } = tempStore();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_register' });
  const now = Date.now();
  store.insertSession({
    id: 'tth_relay_registered',
    provider: 'codex',
    title: 'registered',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    userId: 'user_test',
    gatewayId: 'gw_test_register',
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_register', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_register' }, ptySessions: store.ptySessions });
  await waitForRelayClientConnected(relayClient);
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

test('gateway relay client uses authenticated gateway id for follow-up frames', async () => {
  const { store, cleanup } = tempStore();
  const relay = await relayAuthServer({ gatewayId: 'gw_authenticated' });
  const now = Date.now();
  store.insertSession({
    id: 'tth_relay_auth_gateway_id',
    provider: 'codex',
    title: 'auth gateway id',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    userId: 'user_test',
    gatewayId: 'gw_authenticated',
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_local_runtime',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_authenticated' },
    ptySessions: store.ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    client.send(JSON.stringify({ type: 'client.list' }));
    const sessions = await waitForFrame(client, (frame) => frame.type === 'sessions');
    assert.equal(sessions.type, 'sessions');
    assert.equal(sessions.sessions.some((session) => session.id === 'tth_relay_auth_gateway_id'), true);
  } finally {
    client.close();
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client restores sessions from relay without dropping restored metadata', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_restore_runtime',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_restore_runtime' },
    ptySessions
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_restore_runtime' }));
    gatewaySocket.send(JSON.stringify({
      type: 'gateway.sessions-restore',
      gatewayId: 'gw_restore_runtime',
      sessions: [{
        id: 'tth_restored_runtime',
        provider: 'codex',
        title: 'restored runtime',
        projectPath: process.cwd(),
        accountId: 'acct_test',
        gatewayId: 'gw_restore_runtime',
        userId: 'user_test',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));

    await waitFor(() => ptySessions.getSession('tth_restored_runtime') !== undefined);
    const restored = ptySessions.getSession('tth_restored_runtime');
    assert.equal(restored?.status, 'running');
    assert.equal(ptySessions.isRestoredSession('tth_restored_runtime'), true);
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});

test('gateway relay client creates PTY sessions from forwarded relay frames', async () => {
  const { store, cleanup } = tempStore();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  let newPtyParams: unknown;
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_create_runtime',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_create_runtime' },
    ptySessions: store.ptySessions,
    onNewPtySession: async (params) => {
      newPtyParams = params;
      return { sessionId: 'tth_created_from_relay' };
    }
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_create_runtime' }));
    gatewaySocket.send(JSON.stringify({
      type: 'client.new-pty-session',
      clientId: 'relay_client_01',
      provider: 'codex',
      command: 'codex',
      cwd: process.cwd(),
      cols: 120,
      rows: 40
    }));

    const created = await waitForGatewayFrame(
      gatewaySocket,
      (frame) => frame.type === 'gateway.session-created' && frame.sessionId === 'tth_created_from_relay'
    );
    assert.equal(created.type, 'gateway.session-created');
    assert.equal(Boolean(newPtyParams && typeof newPtyParams === 'object'), true);
    const params = newPtyParams as Record<string, unknown>;
    assert.equal('command' in params, false);
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});


test('gateway relay client replays and forwards output', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_replay' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_replay')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_replay', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_replay' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
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

test('gateway relay client returns an empty replay stub before live subscription cursor', async () => {
  const { store, cleanup } = tempStore();
  const sessionId = createSessionId();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const now = Date.now();
  store.insertSession({
    id: sessionId,
    provider: 'codex',
    title: 'paged replay',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    userId: 'user_test',
    gatewayId: 'gw_test_paged_replay',
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_test_paged_replay',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_paged_replay' },
    ptySessions: store.ptySessions
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_test_paged_replay' }));
    gatewaySocket.send(JSON.stringify({ type: 'client.subscribe', clientId: 'relay_paged_replay', sessionId, after: 0, mode: 'control' }));
    const replayFrame = await waitForGatewayFrame(
      gatewaySocket,
      (frame) => frame.type === 'gateway.replay' && frame.sessionId === sessionId
    );
    assert.equal(replayFrame.type, 'gateway.replay');
    assert.equal(replayFrame.events.length, 0);
    assert.equal(replayFrame.done, true);
    assert.equal(replayFrame.latestEventId, 0);
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});

test('gateway relay client marks missing runner lost instead of crashing on subscribe', async () => {
  const { store, cleanup } = tempStore();
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_missing_runner' });
  const now = Date.now();
  store.insertSession({
    id: sessionId,
    provider: 'codex',
    title: 'missing runner',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    userId: 'user_test',
    gatewayId: 'gw_test_missing_runner',
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    runnerSocketPath: '/tmp/tether-missing-runner.sock',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });
  const missingRunner = {
    subscribeEvents: async () => {
      throw new Error('connect ENOENT /tmp/tether-missing-runner.sock');
    }
  } as unknown as SessionRunnerClient;
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_missing_runner',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_missing_runner' },
    ptySessions: store.ptySessions,
    runnerClientForSession: () => missingRunner
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'observe' }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'session_lost');
    assert.equal(error.type, 'error');
    assert.equal(relayClient.status().state, 'connected');
  } finally {
    client.close();
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client forwards control input to pty', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_input' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_input')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_input', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_input' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
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
    const inputPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'user.input' &&
        frame.event.payload.data === 'relay input\r'
    );
    client.send(JSON.stringify({ type: 'client.input', sessionId, data: 'relay input\r' }));
    await inputPromise;
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
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_resize')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_resize' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    const resizePromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'terminal.resize' &&
        frame.event.payload.cols === 100 &&
        frame.event.payload.rows === 30
    );
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await replayDonePromise;
    client.send(JSON.stringify({ type: 'client.resize', sessionId, cols: 100, rows: 30 }));
    await resizePromise;
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client applies subscribe resize before replay', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_subscribe_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_subscribe_resize')
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_subscribe_resize',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_subscribe_resize' },
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control', cols: 132, rows: 40 }));
    await replayDonePromise;
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client forwards control stop to pty', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_stop' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_stop')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_stop', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_stop' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await replayDonePromise;
    client.send(JSON.stringify({ type: 'client.stop', sessionId }));
    await waitFor(() => !ptySessions.hasLiveSession(sessionId));
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client accepts stop immediately after subscribe', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_immediate_stop' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_immediate_stop')
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_immediate_stop',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_immediate_stop' },
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    client.send(JSON.stringify({ type: 'client.stop', sessionId }));
    await waitFor(() => !ptySessions.hasLiveSession(sessionId));
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
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_observe' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_observe')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_observe' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
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
        .listEvents(sessionId)
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
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_observe_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_observe_resize')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_observe_resize' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
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
        .listEvents(sessionId)
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
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_unsubscribed' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_unsubscribed')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_unsubscribed' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.input', sessionId, data: 'blocked input\r' }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'not_subscribed');
    assert.equal(error.type, 'error');
      assert.equal(
      store
        .listEvents(sessionId)
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
  const ptySessions = store.ptySessions;
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_unsubscribed_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: testOwner('gw_test_unsubscribed_resize')
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_unsubscribed_resize' }, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.resize', sessionId, cols: 100, rows: 30 }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'not_subscribed');
    assert.equal(error.type, 'error');
      assert.equal(
      store
        .listEvents(sessionId)
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
  const ptySessions = store.ptySessions;
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
  const relayClient = startRelayClient({ url: 'ws://127.0.0.1:4919', secret: SECRET, gatewayId: 'gw_test_bad_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_bad_resize' }, ptySessions });

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
        .listEvents(sessionId)
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

test('gateway relay client surfaces auth_failed for invalid token and points to relogin path', async () => {
  const { store, cleanup } = tempStore();
  const relay = await relayAuthServer();
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_auth_failed',
    token: 'invalid-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_auth_failed' },
    ptySessions: store.ptySessions
  });

  try {
    await waitFor(() => relayClient.status().state === 'auth_failed');
    assert.equal(relayClient.status().state, 'auth_failed');
  } finally {
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

async function connectRelayClient(relayUrl: string): Promise<WebSocket> {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/client';
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'client.auth', token: 'client-token' }));
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

async function waitForRelayClientConnected(
  relayClient: ReturnType<typeof startRelayClient>,
  timeoutMs = 1500
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (relayClient.status().state === 'connected') {
      return;
    }
    if (relayClient.status().state === 'auth_failed') {
      throw new Error('relay client auth failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for relay client to connect');
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

async function waitForWebSocketServerPort(server: WebSocketServer): Promise<number> {
  const existingAddress = server.address();
  if (existingAddress && typeof existingAddress !== 'string') {
    return existingAddress.port;
  }
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('websocket server did not bind to a TCP port');
  }
  return address.port;
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

async function waitForGatewayPing(ws: WebSocket, timeoutMs = 1500): Promise<void> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for gateway ping'));
    }, timeoutMs);
    const onPing = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('ping', onPing);
      ws.off('error', onError);
    };
    ws.on('ping', onPing);
    ws.on('error', onError);
  });
}

async function waitForGatewayReplayPages(
  ws: WebSocket,
  sessionId: string,
  timeoutMs = 1500
): Promise<Array<Extract<RelayGatewayToServerFrame, { type: 'gateway.replay' }>>> {
  return await new Promise((resolve, reject) => {
    const frames: Array<Extract<RelayGatewayToServerFrame, { type: 'gateway.replay' }>> = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for gateway replay pages'));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString()) as RelayGatewayToServerFrame;
      if (frame.type !== 'gateway.replay' || frame.sessionId !== sessionId) {
        return;
      }
      frames.push(frame);
      if (frame.done !== false) {
        cleanup();
        resolve(frames);
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

// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-A8: relay-client rejects new chat with non-whitelisted provider', async () => {
  const { store, cleanup } = tempStore();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_phase15_a8',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_phase15_a8' },
    ptySessions: store.ptySessions
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_phase15_a8' }));
    await waitForRelayClientConnected(relayClient);

    gatewaySocket.send(JSON.stringify({
      type: 'client.chat',
      clientId: 'client-a8',
      sessionId: null,
      provider: 'evil-provider',
      model: 'x',
      cwd: process.cwd(),
      message: 'hi'
    }));

    const error = await waitForGatewayFrame(
      gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'provider_not_supported'
    );
    assert.equal(error.type, 'gateway.error');
    assert.equal(error.clientId, 'client-a8');
  } finally {
    await relayClient.close();
    await closeWebSocketServer(fakeRelay);
    cleanup();
  }
});

// ─── Phase 17: Chat Multi-client Realtime Sync ──────────────────────────────

type CodexRun = typeof CodexChatRunner.prototype.run;
type CodexRespondToPermission = typeof CodexChatRunner.prototype.respondToPermission;

function phase17TrustedSession(sessionId: string) {
  return {
    id: sessionId,
    provider: 'codex',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    userId: 'user_test',
    gatewayId: 'gw_phase17',
    transport: 'chat' as const
  };
}

async function startPhase17RelayClient() {
  const { store, cleanup } = tempStore();
  const fakeRelay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const port = await waitForWebSocketServerPort(fakeRelay);
  const gatewaySocketPromise = waitForGatewaySocket(fakeRelay);
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_phase17',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_phase17' },
    ptySessions: store.ptySessions
  });
  const gatewaySocket = await gatewaySocketPromise;
  await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
  gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_phase17' }));
  await waitForRelayClientConnected(relayClient);
  return {
    gatewaySocket,
    close: async () => {
      await relayClient.close();
      await closeWebSocketServer(fakeRelay);
      cleanup();
    }
  };
}

function sendPhase17Chat(gatewaySocket: WebSocket, clientId: string, sessionId: string, message: string, withSession = true) {
  gatewaySocket.send(JSON.stringify({
    type: 'client.chat',
    clientId,
    sessionId,
    message,
    model: 'gpt-test',
    ...(withSession ? { session: phase17TrustedSession(sessionId) } : {})
  }));
}

function patchCodexRun(run: CodexRun): () => void {
  const original = CodexChatRunner.prototype.run;
  CodexChatRunner.prototype.run = run;
  return () => {
    CodexChatRunner.prototype.run = original;
  };
}

function patchCodexRespondToPermission(respondToPermission: CodexRespondToPermission): () => void {
  const original = CodexChatRunner.prototype.respondToPermission;
  CodexChatRunner.prototype.respondToPermission = respondToPermission;
  return () => {
    CodexChatRunner.prototype.respondToPermission = original;
  };
}

test('Phase17-GW-T1: relay-client rejects concurrent chat for the same session', async () => {
  const restore = patchCodexRun(function () {
    return new Promise<void>(() => {});
  } as CodexRun);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_lock', 'first');
    sendPhase17Chat(harness.gatewaySocket, 'client-2', 'tth_phase17_lock', 'second');
    const error = await waitForGatewayFrame(
      harness.gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'chat_in_progress'
    );
    assert.equal(error.type, 'gateway.error');
    assert.equal(error.clientId, 'client-2');
    assert.equal(error.sessionId, 'tth_phase17_lock');
  } finally {
    restore();
    await harness.close();
  }
});

test('Phase17-GW-T2: relay-client releases chat lock after agent.result', async () => {
  let runCount = 0;
  const restore = patchCodexRun(function (this: unknown, params: Parameters<CodexRun>[0]) {
    runCount += 1;
    const options = (this as { options: { onResult: (event: unknown) => void } }).options;
    const sessionId = params.sessionId ?? 'new-session';
    options.onResult({
      clientId: params.clientId,
      sessionId,
      event: { id: Date.now(), sessionId, type: 'agent.result', ts: Date.now(), payload: { text: 'ok', usage: { input_tokens: 1, output_tokens: 1 } } },
      text: 'ok',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    return Promise.resolve();
  } as CodexRun);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_result_unlock', 'first');
    await waitForGatewayFrame(harness.gatewaySocket, (frame) => frame.type === 'gateway.event' && frame.event.type === 'agent.result');
    sendPhase17Chat(harness.gatewaySocket, 'client-2', 'tth_phase17_result_unlock', 'second');
    await waitFor(() => runCount === 2);
    assert.equal(runCount, 2);
  } finally {
    restore();
    await harness.close();
  }
});

test('Phase17-GW-T3: relay-client releases chat lock after session.error', async () => {
  let runCount = 0;
  const restore = patchCodexRun(function (this: unknown, params: Parameters<CodexRun>[0]) {
    runCount += 1;
    const options = (this as { options: { onError: (event: unknown) => void } }).options;
    const sessionId = params.sessionId ?? 'new-session';
    options.onError({ clientId: params.clientId, sessionId, code: 'runner_error', message: 'failed' });
    return Promise.resolve();
  } as CodexRun);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_error_unlock', 'first');
    await waitForGatewayFrame(harness.gatewaySocket, (frame) => frame.type === 'gateway.error' && frame.code === 'runner_error');
    sendPhase17Chat(harness.gatewaySocket, 'client-2', 'tth_phase17_error_unlock', 'second');
    await waitFor(() => runCount === 2);
    assert.equal(runCount, 2);
  } finally {
    restore();
    await harness.close();
  }
});

test('Phase17-GW-T4: relay-client releases chat lock after runner.run reject', async () => {
  let runCount = 0;
  const restore = patchCodexRun(function () {
    runCount += 1;
    return runCount === 1 ? Promise.reject(new Error('boom')) : new Promise<void>(() => {});
  } as CodexRun);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_reject_unlock', 'first');
    const failed = await waitForGatewayFrame(
      harness.gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'chat_runner_failed'
    );
    assert.equal((failed as Extract<RelayGatewayToServerFrame, { type: 'gateway.error' }>).sessionId, 'tth_phase17_reject_unlock');
    sendPhase17Chat(harness.gatewaySocket, 'client-2', 'tth_phase17_reject_unlock', 'second');
    await waitFor(() => runCount === 2);
    assert.equal(runCount, 2);
  } finally {
    restore();
    await harness.close();
  }
});

test('Phase17-GW-T5: missing session metadata does not leak chat lock', async () => {
  let runCount = 0;
  const restore = patchCodexRun(function () {
    runCount += 1;
    return new Promise<void>(() => {});
  } as CodexRun);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_missing_metadata', 'first', false);
    await waitForGatewayFrame(
      harness.gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'missing_session_metadata'
    );
    sendPhase17Chat(harness.gatewaySocket, 'client-2', 'tth_phase17_missing_metadata', 'second');
    await waitFor(() => runCount === 1);
    assert.equal(runCount, 1);
  } finally {
    restore();
    await harness.close();
  }
});

test('Phase17-GW-T6: subscribed client can send permission_response', async () => {
  let runCount = 0;
  let responseCount = 0;
  const restoreRun = patchCodexRun(function () {
    runCount += 1;
    return new Promise<void>(() => {});
  } as CodexRun);
  const restoreRespond = patchCodexRespondToPermission(function (sessionId, requestId, decision) {
    responseCount += 1;
    assert.equal(sessionId, 'tth_phase17_permission_ok');
    assert.equal(requestId, 'req-ok');
    assert.equal(decision, 'allow');
  } as CodexRespondToPermission);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_permission_ok', 'first');
    await waitFor(() => runCount === 1);
    harness.gatewaySocket.send(JSON.stringify({
      type: 'client.subscribe',
      clientId: 'client-1',
      sessionId: 'tth_phase17_permission_ok',
      after: 0,
      mode: 'control'
    }));
    harness.gatewaySocket.send(JSON.stringify({
      type: 'client.permission_response',
      clientId: 'client-1',
      sessionId: 'tth_phase17_permission_ok',
      requestId: 'req-ok',
      decision: 'allow'
    }));
    await waitFor(() => responseCount === 1);
    assert.equal(responseCount, 1);
  } finally {
    restoreRespond();
    restoreRun();
    await harness.close();
  }
});

test('Phase17-GW-T7: unsubscribed client cannot send permission_response', async () => {
  let runCount = 0;
  let responseCount = 0;
  const restoreRun = patchCodexRun(function () {
    runCount += 1;
    return new Promise<void>(() => {});
  } as CodexRun);
  const restoreRespond = patchCodexRespondToPermission(function () {
    responseCount += 1;
  } as CodexRespondToPermission);
  const harness = await startPhase17RelayClient();
  try {
    sendPhase17Chat(harness.gatewaySocket, 'client-1', 'tth_phase17_permission_blocked', 'first');
    await waitFor(() => runCount === 1);
    harness.gatewaySocket.send(JSON.stringify({
      type: 'client.permission_response',
      clientId: 'client-2',
      sessionId: 'tth_phase17_permission_blocked',
      requestId: 'req-blocked',
      decision: 'allow'
    }));
    const error = await waitForGatewayFrame(
      harness.gatewaySocket,
      (frame) => frame.type === 'gateway.error' && frame.code === 'not_subscribed'
    );
    assert.equal(error.type, 'gateway.error');
    assert.equal(error.clientId, 'client-2');
    assert.equal(responseCount, 0);
  } finally {
    restoreRespond();
    restoreRun();
    await harness.close();
  }
});
