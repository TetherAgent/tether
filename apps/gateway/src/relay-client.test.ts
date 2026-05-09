import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket, { WebSocketServer } from 'ws';
import type { RelayAuthScope, RelayGatewayToServerFrame, RelayServerToClientFrame } from '@tether/protocol';
import { startRelayServer } from '../../relay/src/relay.js';
import { createSessionId } from './ids.js';
import { PtySessionManager } from './pty.js';
import { relayGatewayUrl, startRelayClient } from './relay-client.js';
import type { SessionRunnerClient } from './session-runner-client.js';
import { Store } from './store.js';

const SECRET = 'relay-client-test-secret';
const GATEWAY_SCOPE = {
  accountId: 'acct_test',
  workspaceId: 'ws_test',
  tokenClass: 'gateway_access',
  expiresAt: Date.now() + 60_000,
  jti: 'jti_gateway'
} satisfies RelayAuthScope;
const CLIENT_SCOPE = {
  accountId: 'acct_test',
  workspaceId: 'ws_test',
  userId: 'user_test',
  tokenClass: 'normal_client_access',
  expiresAt: Date.now() + 60_000,
  jti: 'jti_client'
} satisfies RelayAuthScope;

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

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-relay-client-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
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
    workspaceId: 'ws_test',
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
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_register', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_register' }, store });
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
    workspaceId: 'ws_test',
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
    store
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


test('gateway relay client replays and forwards output', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_replay' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_replay' }
  });
  const replayed = store.appendEvent(sessionId, 'terminal.output', { data: 'from replay\r\n', encoding: 'utf8' });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_replay', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_replay' }, store, ptySessions });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayPromise = waitForFrame(
      client,
      (frame) => frame.type === 'replay.output' && frame.data === 'from replay\r\n' && frame.latestEventId === replayed.id
    );
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: replayed.id - 1, mode: 'control' }));
    const replayFrame = await replayPromise;
    assert.equal(replayFrame.type, 'replay.output');
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

test('gateway relay client includes conversation turns in replay for mobile chat', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_replay_conversation' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_replay_conversation' }
  });
  store.appendEvent(sessionId, 'agent.turn', { role: 'user', content: '1', tools: [], turnIndex: 0 });
  store.appendEvent(sessionId, 'agent.turn', { role: 'assistant', content: '请选择一个任务', tools: [], turnIndex: 0 });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_replay_conversation',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_replay_conversation' },
    store,
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const userTurnPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'agent.turn' &&
        frame.event.payload.role === 'user' &&
        frame.event.payload.content === '1'
    );
    const assistantTurnPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'agent.turn' &&
        frame.event.payload.role === 'assistant' &&
        frame.event.payload.content === '请选择一个任务'
    );
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await userTurnPromise;
    await assistantTurnPromise;
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client serves structured conversation on request', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_conversation_request' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_conversation_request' }
  });
  store.appendEvent(sessionId, 'agent.turn', { role: 'user', content: '1', tools: [], turnIndex: 0 });
  store.appendEvent(sessionId, 'agent.turn', { role: 'assistant', content: '结构化回复', tools: [], turnIndex: 0 });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_conversation_request',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_conversation_request' },
    store,
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const conversationPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'conversation' &&
        frame.sessionId === sessionId &&
        frame.turns.length === 2 &&
        frame.turns[0]?.role === 'user' &&
        frame.turns[0]?.content === '1' &&
        frame.turns[1]?.role === 'assistant' &&
        frame.turns[1]?.content === '结构化回复'
    );
    client.send(JSON.stringify({ type: 'client.conversation', sessionId }));
    assert.equal((await conversationPromise).type, 'conversation');
  } finally {
    client.close();
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client serves HTTP RPC conversation, events, input and stop without subscription', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_http_rpc' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_http_rpc' }
  });
  store.appendEvent(sessionId, 'agent.turn', { role: 'user', content: 'hello http', tools: [], turnIndex: 0 });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_http_rpc',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_http_rpc' },
    store,
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);

  try {
    const headers = { Authorization: 'Bearer client-token' };
    const conversation = await fetch(`${relay.url}/api/sessions/${sessionId}/conversation`, { headers });
    assert.equal(conversation.status, 200);
    const conversationBody = (await conversation.json()) as { turns?: Array<{ content?: string }> };
    assert.equal(conversationBody.turns?.[0]?.content, 'hello http');

    const events = await fetch(`${relay.url}/api/sessions/${sessionId}/events?after=0&limit=10`, { headers });
    assert.equal(events.status, 200);
    const eventsBody = (await events.json()) as { events?: Array<{ type?: string }> };
    assert.equal(eventsBody.events?.some((event) => event.type === 'agent.turn'), true);

    const input = await fetch(`${relay.url}/api/sessions/${sessionId}/input`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'http input\r' })
    });
    assert.equal(input.status, 200);
    await waitFor(() => store.listEvents(sessionId, 0, 100).some((event) => event.type === 'user.input' && event.payload.data === 'http input\r'));

    const stop = await fetch(`${relay.url}/api/sessions/${sessionId}/stop`, { method: 'POST', headers });
    assert.equal(stop.status, 200);
  } finally {
    ptySessions.stop(sessionId);
    await relayClient.close();
    await relay.close();
    cleanup();
  }
});

test('gateway relay client paginates full relay replay before live subscription cursor', async () => {
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
    workspaceId: 'ws_test',
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
  for (let i = 1; i <= 5001; i += 1) {
    store.appendEvent(sessionId, 'terminal.output', { data: `line ${i}\r\n`, encoding: 'utf8' });
  }
  const relayClient = startRelayClient({
    url: `ws://127.0.0.1:${port}`,
    secret: SECRET,
    gatewayId: 'gw_test_paged_replay',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_paged_replay' },
    store
  });

  try {
    const gatewaySocket = await gatewaySocketPromise;
    await waitForGatewayFrame(gatewaySocket, (frame) => frame.type === 'gateway.auth');
    gatewaySocket.send(JSON.stringify({ type: 'gateway.auth.ok', gatewayId: 'gw_test_paged_replay' }));
    gatewaySocket.send(JSON.stringify({ type: 'client.subscribe', clientId: 'relay_paged_replay', sessionId, after: 0, mode: 'control' }));
    const replayFrames = await waitForGatewayReplayPages(gatewaySocket, sessionId);

    assert.equal(replayFrames.length, 2);
    assert.equal(replayFrames[0].events.length, 5000);
    assert.equal(replayFrames[0].done, false);
    assert.equal(replayFrames[1].events.length, 1);
    assert.equal(replayFrames[1].done, true);
    assert.equal(replayFrames[0].events[0]?.payload.data, 'line 1\r\n');
    assert.equal(replayFrames[1].events[0]?.payload.data, 'line 5001\r\n');
    assert.equal(replayFrames[1].latestEventId, 5001);
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
    workspaceId: 'ws_test',
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
    store,
    runnerClientForSession: () => missingRunner
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'observe' }));
    const error = await waitForFrame(client, (frame) => frame.type === 'error' && frame.code === 'session_lost');
    assert.equal(error.type, 'error');
    assert.equal(store.getSession(sessionId)?.status, 'lost');
    assert.equal(
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'session.error' && event.payload.code === 'session_lost'),
      true
    );
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
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_input' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_input' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_input', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_input' }, store, ptySessions });
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

test('gateway relay client forwards chat as user turn and agent.typing events', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_chat' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_chat' }
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_chat',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_chat' },
    store,
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);

    const userTurnPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'agent.turn' &&
        frame.event.payload.role === 'user' &&
        frame.event.payload.content === 'hello relay chat'
    );
    const typingPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'agent.typing' &&
        frame.event.sessionId === sessionId
    );
    const outputPromise = waitForFrame(
      client,
      (frame) =>
        frame.type === 'event' &&
        frame.event.type === 'terminal.output' &&
        typeof frame.event.payload.data === 'string' &&
        frame.event.payload.data.includes('hello relay chat')
    );
    client.send(JSON.stringify({ type: 'client.chat', sessionId, message: 'hello relay chat' }));
    const userTurn = await userTurnPromise;
    assert.equal(userTurn.type, 'event');
    const event = await typingPromise;
    assert.equal(event.type, 'event');
    assert.equal((await outputPromise).type, 'event');
    const turns = store.listAgentTurns(sessionId);
    assert.equal(turns.at(-1)?.role, 'user');
    assert.equal(turns.at(-1)?.content, 'hello relay chat');
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
  const relay = await relayAuthServer({ gatewayId: 'gw_test_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_resize' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_resize' }, store, ptySessions });
  await waitForRelayClientConnected(relayClient);
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

test('gateway relay client applies subscribe resize before replay', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_subscribe_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_subscribe_resize' }
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_subscribe_resize',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_subscribe_resize' },
    store,
    ptySessions
  });
  await waitForRelayClientConnected(relayClient);
  const client = await connectRelayClient(relay.url);

  try {
    await waitForSessionList(client, sessionId);
    const replayDonePromise = waitForFrame(client, (frame) => frame.type === 'replay.done' && frame.sessionId === sessionId);
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control', cols: 132, rows: 40 }));
    await waitFor(() =>
      store
        .listEvents(sessionId, 0, 5000)
        .some((event) => event.type === 'terminal.resize' && event.payload.cols === 132 && event.payload.rows === 40)
    );
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
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_stop' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_stop' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_stop', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_stop' }, store, ptySessions });
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
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_immediate_stop' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_immediate_stop' }
  });
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_immediate_stop',
    token: 'gateway-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_immediate_stop' },
    store,
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
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  const relay = await relayAuthServer({ gatewayId: 'gw_test_observe' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_observe' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_observe' }, store, ptySessions });
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
  const relay = await relayAuthServer({ gatewayId: 'gw_test_observe_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_observe_resize' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_observe_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_observe_resize' }, store, ptySessions });
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
  const relay = await relayAuthServer({ gatewayId: 'gw_test_unsubscribed' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_unsubscribed' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_unsubscribed' }, store, ptySessions });
  await waitForRelayClientConnected(relayClient);
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
  const relay = await relayAuthServer({ gatewayId: 'gw_test_unsubscribed_resize' });
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: { accountId: 'acct_test', workspaceId: 'ws_test', userId: 'user_test', gatewayId: 'gw_test_unsubscribed_resize' }
  });
  const relayClient = startRelayClient({ url: relay.url, secret: SECRET, gatewayId: 'gw_test_unsubscribed_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_unsubscribed_resize' }, store, ptySessions });
  await waitForRelayClientConnected(relayClient);
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
  const relayClient = startRelayClient({ url: 'ws://127.0.0.1:4919', secret: SECRET, gatewayId: 'gw_test_bad_resize', token: 'gateway-token', scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_bad_resize' }, store, ptySessions });

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

test('gateway relay client surfaces auth_failed for invalid token and points to relogin path', async () => {
  const { store, cleanup } = tempStore();
  const relay = await relayAuthServer();
  const relayClient = startRelayClient({
    url: relay.url,
    secret: SECRET,
    gatewayId: 'gw_test_auth_failed',
    token: 'invalid-token',
    scope: { ...GATEWAY_SCOPE, gatewayId: 'gw_test_auth_failed' },
    store
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
