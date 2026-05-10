import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import type { RelayAuthScope, RelayServerToClientFrame, RelaySession } from '@tether/protocol';
import { startRelayServer } from '../src/relay.js';

const SECRET = 'test-relay-secret';
const GATEWAY_TOKEN = 'gateway-token';
const CLIENT_TOKEN = 'client-token';
const CLIENT_TICKET = 'client-ticket';

function createRelay(options?: { allowLegacySecret?: boolean; omitGatewayIdInScope?: boolean; heartbeatIntervalMs?: number; heartbeatTimeoutMs?: number }) {
  return startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    allowLegacySecret: options?.allowLegacySecret,
    heartbeatIntervalMs: options?.heartbeatIntervalMs,
    heartbeatTimeoutMs: options?.heartbeatTimeoutMs,
    validateToken: async (token) => {
      if (token === GATEWAY_TOKEN) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: options?.omitGatewayIdInScope ? undefined : 'gateway-test',
          userId: 'user_1',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_gateway'
        };
      }
      if (token === CLIENT_TOKEN) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          userId: 'user_1',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_client'
        };
      }
      if (token === CLIENT_TICKET) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: 'gateway-test',
          sessionId: 'tth_ticket_test',
          mode: 'observe',
          tokenClass: 'ws_ticket',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_ticket'
        };
      }
      return undefined;
    }
  });
}

test('relay sends websocket heartbeat pings to connected sockets', async () => {
  const relay = await createRelay({ heartbeatIntervalMs: 20, heartbeatTimeoutMs: 100 });
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await waitForOpen(client);
    await waitForPing(client);
  } finally {
    client.close();
    await relay.close();
  }
});

test('relay rejects unauthenticated sockets', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await waitForOpen(client);
    client.send(JSON.stringify({ type: 'client.list' }));
    const close = await waitForClose(client);
    assert.equal(close.code, 1008);
  } finally {
    client.close();
    await relay.close();
  }
});

test('relay closes sockets that never send auth frame', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await waitForOpen(client);
    const close = await waitForClose(client, 7000);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'authentication timeout');
  } finally {
    client.close();
    await relay.close();
  }
});

test('relay forwards session list from gateway to client', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessions: RelaySession[] = [
    {
      id: 'tth_relay_test',
      provider: 'codex',
      title: 'Relay Test',
      projectPath: process.cwd(),
      accountId: 'acct_1',
      workspaceId: 'ws_1',
      gatewayId: 'gateway-test',
      userId: 'user_1',
      status: 'running',
      transport: 'pty-event-stream',
      lastActiveAt: Date.now()
    }
  ];

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.list' }));
    const listRequest = await waitForJson(gateway, (message) => message.type === 'client.list');
    assert.equal(listRequest.clientId, clientId);

    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions }));
    const sessionMessage = await waitForJson(client, (message) => message.type === 'sessions');
    assert.deepEqual(sessionMessage.sessions, sessions);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay HTTP APIs proxy session data and commands through gateway RPC', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const session: RelaySession = {
    id: 'tth_http_rpc',
    provider: 'codex',
    title: 'HTTP RPC',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-test',
    userId: 'user_1',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  };

  try {
    await authenticateGateway(gateway);
    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions: [session] }));

    const sessionsPromise = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.path === '/api/sessions');
    const sessionsResponsePromise = fetch(`${relay.url}/api/sessions`, { headers: authHeader() });
    const sessionsRequest = await sessionsPromise;
    gateway.send(JSON.stringify({
      type: 'gateway.http.response',
      gatewayId: 'gateway-test',
      requestId: sessionsRequest.requestId,
      status: 200,
      body: { sessions: [session] }
    }));
    const sessionsResponse = await sessionsResponsePromise;
    assert.equal(sessionsResponse.status, 200);
    assert.deepEqual((await sessionsResponse.json()).sessions, [session]);

    const conversationPromise = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.path === '/api/sessions/:id/conversation');
    const conversationResponsePromise = fetch(`${relay.url}/api/sessions/${session.id}/conversation`, { headers: authHeader() });
    const conversationRequest = await conversationPromise;
    assert.equal(conversationRequest.sessionId, session.id);
    gateway.send(JSON.stringify({
      type: 'gateway.http.response',
      gatewayId: 'gateway-test',
      requestId: conversationRequest.requestId,
      status: 200,
      body: { turns: [{ turnIndex: 0, role: 'user', content: 'hello' }] }
    }));
    const conversationResponse = await conversationResponsePromise;
    assert.equal(conversationResponse.status, 200);
    assert.deepEqual(await conversationResponse.json(), { turns: [{ turnIndex: 0, role: 'user', content: 'hello' }] });

    const eventsPromise = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.path === '/api/sessions/:id/events');
    const eventsResponsePromise = fetch(`${relay.url}/api/sessions/${session.id}/events?after=3&limit=9`, { headers: authHeader() });
    const eventsRequest = await eventsPromise;
    assert.deepEqual(eventsRequest.query, { after: '3', limit: '9' });
    gateway.send(JSON.stringify({
      type: 'gateway.http.response',
      gatewayId: 'gateway-test',
      requestId: eventsRequest.requestId,
      status: 200,
      body: { events: [] }
    }));
    assert.equal((await eventsResponsePromise).status, 200);

    const inputPromise = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.path === '/api/sessions/:id/input');
    const inputResponsePromise = fetch(`${relay.url}/api/sessions/${session.id}/input`, {
      method: 'POST',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'hi\r' })
    });
    const inputRequest = await inputPromise;
    assert.deepEqual(inputRequest.body, { data: 'hi\r' });
    gateway.send(JSON.stringify({
      type: 'gateway.http.response',
      gatewayId: 'gateway-test',
      requestId: inputRequest.requestId,
      status: 200,
      body: { ok: true }
    }));
    assert.equal((await inputResponsePromise).status, 200);

    const stopPromise = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.path === '/api/sessions/:id/stop');
    const stopResponsePromise = fetch(`${relay.url}/api/sessions/${session.id}/stop`, { method: 'POST', headers: authHeader() });
    const stopRequest = await stopPromise;
    gateway.send(JSON.stringify({
      type: 'gateway.http.response',
      gatewayId: 'gateway-test',
      requestId: stopRequest.requestId,
      status: 200,
      body: { ok: true }
    }));
    assert.equal((await stopResponsePromise).status, 200);
  } finally {
    gateway.close();
    await relay.close();
  }
});

test('relay HTTP conversation enforces scope, gateway availability and timeout', async () => {
  const unavailableRelay = await createRelay();
  try {
    const unavailable = await fetch(`${unavailableRelay.url}/api/sessions/tth_missing/conversation`, {
      headers: authHeader()
    });
    assert.equal(unavailable.status, 503);
  } finally {
    await unavailableRelay.close();
  }

  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const forbiddenSession: RelaySession = {
    id: 'tth_forbidden_http',
    provider: 'codex',
    title: 'Forbidden HTTP',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-test',
    userId: 'user_2',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  };
  const timeoutSession: RelaySession = {
    ...forbiddenSession,
    id: 'tth_timeout_http',
    title: 'Timeout HTTP',
    userId: 'user_1'
  };

  try {
    await authenticateGateway(gateway);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [forbiddenSession, timeoutSession]
    }));

    const forbidden = await fetch(`${relay.url}/api/sessions/${forbiddenSession.id}/conversation`, {
      headers: authHeader()
    });
    assert.equal(forbidden.status, 403);

    const timeoutRequest = waitForJson(gateway, (message) => message.type === 'gateway.http.request' && message.sessionId === timeoutSession.id);
    const timeoutResponsePromise = fetch(`${relay.url}/api/sessions/${timeoutSession.id}/conversation`, {
      headers: authHeader()
    });
    await timeoutRequest;
    const timeoutResponse = await timeoutResponsePromise;
    assert.equal(timeoutResponse.status, 504);
  } finally {
    gateway.close();
    await relay.close();
  }

});

test('relay accepts gateway.sessions when gateway token has no gatewayId in scope', async () => {
  const relay = await createRelay({ omitGatewayIdInScope: true });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessions: RelaySession[] = [
    {
      id: 'tth_relay_scope_missing',
      provider: 'codex',
      title: 'Relay Scope Missing',
      projectPath: process.cwd(),
      accountId: 'acct_1',
      workspaceId: 'ws_1',
      gatewayId: 'gateway-test',
      userId: 'user_1',
      status: 'running',
      transport: 'pty-event-stream',
      lastActiveAt: Date.now()
    }
  ];

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions }));
    const sessionMessage = await waitForJson(client, (message) => message.type === 'sessions');
    assert.deepEqual(sessionMessage.sessions, sessions);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay clears visible sessions when gateway disconnects', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_gateway_disconnect',
        provider: 'codex',
        title: 'Gateway Disconnect',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    const initialSessions = await waitForJson(client, (message) => message.type === 'sessions');
    assert.equal((initialSessions.sessions as RelaySession[]).some((session) => session.id === 'tth_gateway_disconnect'), true);

    const emptySessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions) && message.sessions.length === 0
    );
    const errorPromise = waitForJson(client, (message) => message.type === 'error' && message.code === 'gateway_unavailable');
    gateway.terminate();
    const emptySessions = await emptySessionsPromise;
    assert.deepEqual(emptySessions.sessions, []);
    const error = await errorPromise;
    assert.equal(error.message, 'gateway is not connected');

    const listEmptyPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions) && message.sessions.length === 0
    );
    const listErrorPromise = waitForJson(client, (message) => message.type === 'error' && message.code === 'gateway_unavailable');
    client.send(JSON.stringify({ type: 'client.list' }));
    const listEmpty = await listEmptyPromise;
    assert.deepEqual(listEmpty.sessions, []);
    const listError = await listErrorPromise;
    assert.equal(listError.message, 'gateway is not connected');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay reports gateway unavailable when subscribing to an uncached session', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateClient(client);

    const emptySessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions) && message.sessions.length === 0
    );
    const unavailablePromise = waitForJson(
      client,
      (message) => message.type === 'error' && message.code === 'gateway_unavailable'
    );
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_missing_cache', mode: 'control' }));

    const emptySessions = await emptySessionsPromise;
    assert.deepEqual(emptySessions.sessions, []);
    const unavailable = await unavailablePromise;
    assert.equal(unavailable.message, 'gateway is not connected');
  } finally {
    client.close();
    await relay.close();
  }
});

test('relay keeps cached running sessions when gateway sends a transient empty list', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessions: RelaySession[] = [{
    id: 'tth_transient_empty',
    provider: 'codex',
    title: 'Transient Empty',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-test',
    userId: 'user_1',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  }];

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions }));
    const initialSessions = await waitForJson(client, (message) => message.type === 'sessions');
    assert.deepEqual(initialSessions.sessions, sessions);

    const cachedSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions: [] }));
    const cachedSessions = await cachedSessionsPromise;
    assert.deepEqual(cachedSessions.sessions, sessions);

    client.send(JSON.stringify({ type: 'client.list' }));
    const listRequest = await waitForJson(gateway, (message) => message.type === 'client.list');
    assert.equal(typeof listRequest.clientId, 'string');
    const listSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    gateway.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions: [] }));
    const listSessions = await listSessionsPromise;
    assert.deepEqual(listSessions.sessions, sessions);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay does not clear one gateway sessions when another gateway disconnects', async () => {
  const relay = await createRelay({ omitGatewayIdInScope: true });
  const gatewayOne = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const gatewayTwo = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessionOne: RelaySession = {
    id: 'tth_gateway_one',
    provider: 'codex',
    title: 'Gateway One',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-test',
    userId: 'user_1',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  };
  const sessionTwo: RelaySession = {
    id: 'tth_gateway_two',
    provider: 'codex',
    title: 'Gateway Two',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-two',
    userId: 'user_1',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  };

  try {
    await authenticateGateway(gatewayOne);
    await authenticateGateway(gatewayTwo, 'gateway-two');
    await authenticateClient(client);

    const firstSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    gatewayOne.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-test', sessions: [sessionOne] }));
    const firstSessions = await firstSessionsPromise;
    assert.deepEqual(firstSessions.sessions, [sessionOne]);

    const scopedSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    gatewayTwo.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-two', sessions: [sessionTwo] }));
    const scopedSessions = await scopedSessionsPromise;
    assert.deepEqual(scopedSessions.sessions, [sessionOne]);

    const listRequestPromise = waitForJson(gatewayOne, (message) => message.type === 'client.list');
    client.send(JSON.stringify({ type: 'client.list' }));
    const listRequest = await listRequestPromise;
    assert.equal(typeof listRequest.clientId, 'string');

    const remainingSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    gatewayTwo.terminate();
    const remainingSessions = await remainingSessionsPromise;
    assert.deepEqual(remainingSessions.sessions, [sessionOne]);
  } finally {
    gatewayOne.close();
    gatewayTwo.close();
    client.close();
    await relay.close();
  }
});

test('relay forwards subscribed input and resize to gateway', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_input_test',
        provider: 'codex',
        title: 'Input Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_input_test', after: 7, mode: 'control', cols: 120, rows: 32 }));
    const subscribe = await waitForJson(gateway, (message) => message.type === 'client.subscribe');
    assert.deepEqual(subscribe, {
      type: 'client.subscribe',
      clientId,
      sessionId: 'tth_input_test',
      after: 7,
      mode: 'control',
      cols: 120,
      rows: 32
    });

    client.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_input_test', data: 'hello\r' }));
    const input = await waitForJson(gateway, (message) => message.type === 'client.input');
    assert.deepEqual(input, {
      type: 'client.input',
      clientId,
      sessionId: 'tth_input_test',
      data: 'hello\r'
    });

    client.send(JSON.stringify({ type: 'client.resize', sessionId: 'tth_input_test', cols: 100, rows: 30 }));
    const resize = await waitForJson(gateway, (message) => message.type === 'client.resize');
    assert.deepEqual(resize, {
      type: 'client.resize',
      clientId,
      sessionId: 'tth_input_test',
      cols: 100,
      rows: 30
    });

    client.send(JSON.stringify({ type: 'client.stop', sessionId: 'tth_input_test' }));
    const stop = await waitForJson(gateway, (message) => message.type === 'client.stop');
    assert.deepEqual(stop, {
      type: 'client.stop',
      clientId,
      sessionId: 'tth_input_test'
    });
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay forwards subscribed chat messages to gateway', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_chat_test',
        provider: 'codex',
        title: 'Chat Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_chat_test', after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe');

    client.send(JSON.stringify({ type: 'client.chat', sessionId: 'tth_chat_test', message: 'hello world' }));
    const chat = await waitForJson(gateway, (message) => message.type === 'client.chat');
    assert.deepEqual(chat, {
      type: 'client.chat',
      clientId,
      sessionId: 'tth_chat_test',
      message: 'hello world'
    });
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay waits for final paged replay frame before replay.done', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  let replayDoneCount = 0;
  client.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as RelayServerToClientFrame;
    if (frame.type === 'replay.done') {
      replayDoneCount += 1;
    }
  });

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_paged_replay_test',
        provider: 'codex',
        title: 'Paged Replay Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_paged_replay_test', after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe' && message.clientId === clientId);

    const firstReplayOutputPromise = waitForJson(client, (message) => message.type === 'replay.output' && message.latestEventId === 1);
    gateway.send(JSON.stringify({
      type: 'gateway.replay',
      gatewayId: 'gateway-test',
      clientId,
      sessionId: 'tth_paged_replay_test',
      events: [{
        id: 1,
        sessionId: 'tth_paged_replay_test',
        type: 'terminal.output',
        ts: Date.now(),
        payload: { data: 'page 1\r\n', encoding: 'utf8' }
      }],
      done: false,
      latestEventId: 1
    }));
    const firstReplayOutput = await firstReplayOutputPromise;
    assert.equal(firstReplayOutput.data, 'page 1\r\n');
    assert.equal(replayDoneCount, 0);

    const secondReplayOutputPromise = waitForJson(client, (message) => message.type === 'replay.output' && message.latestEventId === 2);
    const donePromise = waitForJson(client, (message) => message.type === 'replay.done' && message.sessionId === 'tth_paged_replay_test');
    gateway.send(JSON.stringify({
      type: 'gateway.replay',
      gatewayId: 'gateway-test',
      clientId,
      sessionId: 'tth_paged_replay_test',
      events: [{
        id: 2,
        sessionId: 'tth_paged_replay_test',
        type: 'terminal.output',
        ts: Date.now(),
        payload: { data: 'page 2\r\n', encoding: 'utf8' }
      }],
      done: true,
      latestEventId: 2
    }));
    const secondReplayOutput = await secondReplayOutputPromise;
    assert.equal(secondReplayOutput.data, 'page 2\r\n');
    const done = await donePromise;
    assert.equal(done.latestEventId, 2);
    assert.equal(replayDoneCount, 1);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects unsubscribed input and resize', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_unsubscribed_test',
        provider: 'codex',
        title: 'Unsubscribed Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_unsubscribed_test', data: 'blocked\r' }));
    const inputError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'not_subscribed');
    assert.equal(inputError.sessionId, 'tth_unsubscribed_test');

    client.send(JSON.stringify({ type: 'client.resize', sessionId: 'tth_unsubscribed_test', cols: 90, rows: 25 }));
    const resizeError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'not_subscribed');
    assert.equal(resizeError.sessionId, 'tth_unsubscribed_test');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects control frames after session scope changes', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_scope_drift',
        provider: 'codex',
        title: 'Scope Drift',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_scope_drift', after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe' && message.clientId === clientId);

    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_scope_drift',
        provider: 'codex',
        title: 'Scope Drift Moved',
        projectPath: process.cwd(),
        accountId: 'acct_2',
        workspaceId: 'ws_2',
        gatewayId: 'gateway-test',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_scope_drift', data: 'blocked\r' }));
    const inputError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(inputError.sessionId, 'tth_scope_drift');

    client.send(JSON.stringify({ type: 'client.resize', sessionId: 'tth_scope_drift', cols: 100, rows: 30 }));
    const resizeError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(resizeError.sessionId, 'tth_scope_drift');

    client.send(JSON.stringify({ type: 'client.stop', sessionId: 'tth_scope_drift' }));
    const stopError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(stopError.sessionId, 'tth_scope_drift');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects observe input and resize', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_observe_test',
        provider: 'codex',
        title: 'Observe Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_observe_test', after: 0, mode: 'observe' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe');

    client.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_observe_test', data: 'blocked\r' }));
    const inputError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'observe_only');
    assert.equal(inputError.sessionId, 'tth_observe_test');

    client.send(JSON.stringify({ type: 'client.resize', sessionId: 'tth_observe_test', cols: 90, rows: 25 }));
    const resizeError = await waitForJson(client, (message) => message.type === 'error' && message.code === 'observe_only');
    assert.equal(resizeError.sessionId, 'tth_observe_test');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects invalid resize frames', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.resize', sessionId: 'tth_invalid_resize_test', cols: 0, rows: 0 }));
    const close = await waitForClose(client);
    assert.equal(close.code, 1008);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects command-shaped frames', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_command_test', data: 'hello\r', command: 'rm' }));
    const close = await waitForClose(client);
    assert.equal(close.code, 1008);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects cross-account session list and wrong-session ticket subscribe', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const ticketClient = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    await authenticateClient(ticketClient, { token: CLIENT_TICKET });

    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [
        { id: 'tth_ticket_test', provider: 'codex', title: 'ok', projectPath: process.cwd(), accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gateway-test', status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() },
        { id: 'tth_other_account', provider: 'codex', title: 'no', projectPath: process.cwd(), accountId: 'acct_2', workspaceId: 'ws_2', gatewayId: 'gateway-test', status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() }
      ]
    }));

    const sessions = await waitForJson(client, (message) => message.type === 'sessions');
    assert.equal(Array.isArray(sessions.sessions), true);
    assert.equal((sessions.sessions as RelaySession[]).some((session) => session.id === 'tth_other_account'), false);

    ticketClient.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_other_account', after: 0, mode: 'observe' }));
    const error = await waitForJson(ticketClient, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.sessionId, 'tth_other_account');
  } finally {
    gateway.close();
    client.close();
    ticketClient.close();
    await relay.close();
  }
});

test('relay hides unscoped sessions from token clients', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [
        { id: 'tth_unscoped', provider: 'codex', title: 'unscoped', projectPath: process.cwd(), status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() }
      ]
    }));

    const sessions = await waitForJson(client, (message) => message.type === 'sessions');
    assert.deepEqual(sessions.sessions, []);

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_unscoped', after: 0, mode: 'control' }));
    const error = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.sessionId, 'tth_unscoped');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects unscoped sessions for legacy secret clients', async () => {
  const relay = await createRelay({ allowLegacySecret: true });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const legacyScope: RelayAuthScope = {
    accountId: 'acct_legacy',
    workspaceId: 'ws_legacy',
    userId: 'user_legacy',
    tokenClass: 'normal_client_access',
    expiresAt: Date.now() + 60_000,
    jti: 'jti_legacy'
  };

  try {
    await authenticateGateway(gateway);
    await authenticateLegacyClient(client, legacyScope);

    const sessionsPromise = waitForJson(client, (message) => message.type === 'sessions');
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [
        { id: 'tth_legacy_unscoped', provider: 'codex', title: 'legacy', projectPath: process.cwd(), status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() }
      ]
    }));

    const sessions = await sessionsPromise;
    assert.deepEqual(sessions.sessions, []);

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_legacy_unscoped', after: 0, mode: 'control' }));
    const error = await waitForJson(client, (message) => message.type === 'error' && message.code === 'gateway_unavailable');
    assert.equal(error.message, 'gateway is not connected');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects observe tickets that send control frames', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const ticketClient = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(ticketClient, { token: CLIENT_TICKET });

    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [
        { id: 'tth_ticket_test', provider: 'codex', title: 'ticket', projectPath: process.cwd(), accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gateway-test', status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() }
      ]
    }));
    await waitForJson(ticketClient, (message) => message.type === 'sessions');

    ticketClient.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_ticket_test', after: 0, mode: 'observe' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe');

    ticketClient.send(JSON.stringify({ type: 'client.input', sessionId: 'tth_ticket_test', data: 'blocked\r' }));
    const error = await waitForJson(ticketClient, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.sessionId, 'tth_ticket_test');
  } finally {
    gateway.close();
    ticketClient.close();
    await relay.close();
  }
});

test('relay gateway.event syncToServer failure does not block frame forwarding', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    serverSyncUrl: 'http://127.0.0.1:1',
    runtimeSyncSecret: 'test-sync-secret',
    validateToken: async (token) => {
      if (token === GATEWAY_TOKEN) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: 'gateway-test',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_sync_test'
        };
      }
      if (token === CLIENT_TOKEN) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          userId: 'user_1',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_sync_client'
        };
      }
      return undefined;
    }
  } as Parameters<typeof startRelayServer>[0]);
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_sync_fail_test',
        provider: 'codex',
        title: 'Sync Fail Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        workspaceId: 'ws_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_sync_fail_test', after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe');

    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-test',
      event: {
        id: 1,
        sessionId: 'tth_sync_fail_test',
        type: 'terminal.output',
        ts: Date.now(),
        payload: { data: 'hello\r\n', encoding: 'utf8' }
      }
    }));

    const receivedEvent = await waitForJson(client, (message) => message.type === 'event');
    assert.equal((receivedEvent.event as Record<string, unknown>)?.type, 'terminal.output');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay routes client frames to matching account gateway only', async () => {
  const GW_TOKEN_1 = 'gw-token-acct1';
  const GW_TOKEN_2 = 'gw-token-acct2';
  const CLIENT_TOKEN_1 = 'client-token-acct1';

  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === GW_TOKEN_1) return { accountId: 'acct_1', workspaceId: 'ws_1', userId: 'user_1', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw1' };
      if (token === GW_TOKEN_2) return { accountId: 'acct_2', workspaceId: 'ws_2', userId: 'user_2', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw2' };
      if (token === CLIENT_TOKEN_1) return { accountId: 'acct_1', workspaceId: 'ws_1', userId: 'user_1', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_cl1' };
      return undefined;
    }
  });

  const wsUrl = relay.url.replace('http', 'ws');
  // Connect acct_2 gateway FIRST to reproduce the pre-fix bug (firstConnectedGateway would return it)
  const gateway2 = new WebSocket(`${wsUrl}/ws/gateway`);
  const gateway1 = new WebSocket(`${wsUrl}/ws/gateway`);
  const client = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gateway2);
    gateway2.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-acct2', token: GW_TOKEN_2 }));
    await waitForJson(gateway2, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(gateway1);
    gateway1.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-acct1', token: GW_TOKEN_1 }));
    await waitForJson(gateway1, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(client);
    client.send(JSON.stringify({ type: 'client.auth', token: CLIENT_TOKEN_1 }));
    await waitForJson(client, (m) => m.type === 'client.auth.ok');

    // cwd-suggest must arrive at acct_1 gateway
    client.send(JSON.stringify({ type: 'client.cwd-suggest', cwd: '~' }));
    const frame = await waitForJson(gateway1, (m) => m.type === 'client.cwd-suggest');
    assert.equal(frame.type, 'client.cwd-suggest');

    // acct_2 gateway must NOT receive anything from acct_1 client
    const leakCheck = await Promise.race([
      waitForJson(gateway2, (m) => m.type === 'client.cwd-suggest').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gateway1.close();
    gateway2.close();
    client.close();
    await relay.close();
  }
});

test('relay prefers matching user gateway within the same account', async () => {
  const GW_TOKEN_USER_3 = 'gw-token-user3';
  const GW_TOKEN_USER_5 = 'gw-token-user5';
  const CLIENT_TOKEN_USER_3 = 'client-token-user3';

  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === GW_TOKEN_USER_3) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: 'gateway-user3',
          userId: 'user_3',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_gw_user3'
        };
      }
      if (token === GW_TOKEN_USER_5) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: 'gateway-user5',
          userId: 'user_5',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_gw_user5'
        };
      }
      if (token === CLIENT_TOKEN_USER_3) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          userId: 'user_3',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_client_user3'
        };
      }
      return undefined;
    }
  });

  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayUser5 = new WebSocket(`${wsUrl}/ws/gateway`);
  const gatewayUser3 = new WebSocket(`${wsUrl}/ws/gateway`);
  const client = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayUser5);
    gatewayUser5.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-user5', token: GW_TOKEN_USER_5 }));
    await waitForJson(gatewayUser5, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(gatewayUser3);
    gatewayUser3.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-user3', token: GW_TOKEN_USER_3 }));
    await waitForJson(gatewayUser3, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(client);
    const helloPromise = waitForJson(client, (m) => m.type === 'hello');
    client.send(JSON.stringify({ type: 'client.auth', token: CLIENT_TOKEN_USER_3 }));
    await waitForJson(client, (m) => m.type === 'client.auth.ok');
    const hello = await helloPromise;
    assert.equal(hello.gatewayId, 'gateway-user3');

    client.send(JSON.stringify({ type: 'client.cwd-suggest', cwd: '~' }));
    const frame = await waitForJson(gatewayUser3, (m) => m.type === 'client.cwd-suggest');
    assert.equal(frame.type, 'client.cwd-suggest');

    const leakCheck = await Promise.race([
      waitForJson(gatewayUser5, (m) => m.type === 'client.cwd-suggest').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayUser3.close();
    gatewayUser5.close();
    client.close();
    await relay.close();
  }
});

test('relay does not bind a normal client to another user gateway in the same workspace', async () => {
  const GW_TOKEN_USER_5 = 'gw-token-only-user5';
  const CLIENT_TOKEN_USER_3 = 'client-token-only-user3';

  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === GW_TOKEN_USER_5) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: 'gateway-user5',
          userId: 'user_5',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_gw_only_user5'
        };
      }
      if (token === CLIENT_TOKEN_USER_3) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          userId: 'user_3',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_client_only_user3'
        };
      }
      return undefined;
    }
  });

  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayUser5 = new WebSocket(`${wsUrl}/ws/gateway`);
  const client = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayUser5);
    gatewayUser5.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-user5', token: GW_TOKEN_USER_5 }));
    await waitForJson(gatewayUser5, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(client);
    const helloPromise = waitForJson(client, (m) => m.type === 'hello');
    client.send(JSON.stringify({ type: 'client.auth', token: CLIENT_TOKEN_USER_3 }));
    await waitForJson(client, (m) => m.type === 'client.auth.ok');
    const hello = await helloPromise;
    assert.equal(hello.gatewayId, undefined);

    const statusCheck = await Promise.race([
      waitForJson(client, (m) => m.type === 'gateway.status' && m.status === 'connected').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(statusCheck, 'isolated');

    client.send(JSON.stringify({ type: 'client.list-providers' }));
    const unavailable = await waitForJson(client, (m) => m.type === 'error' && m.code === 'gateway_unavailable');
    assert.equal(unavailable.message, 'gateway is not connected');

    const leakCheck = await Promise.race([
      waitForJson(gatewayUser5, (m) => m.type === 'client.list-providers').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayUser5.close();
    client.close();
    await relay.close();
  }
});

test('relay rebinds client to subscribed session gateway', async () => {
  const GW_TOKEN_1 = 'gw-token-session1';
  const GW_TOKEN_2 = 'gw-token-session2';
  const CLIENT_TOKEN_USER_3 = 'client-token-session-user3';

  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === GW_TOKEN_1) {
        return { accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gateway-1', userId: 'user_3', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_session1' };
      }
      if (token === GW_TOKEN_2) {
        return { accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gateway-2', userId: 'user_3', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_session2' };
      }
      if (token === CLIENT_TOKEN_USER_3) {
        return { accountId: 'acct_1', workspaceId: 'ws_1', userId: 'user_3', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_session_user3' };
      }
      return undefined;
    }
  });

  const wsUrl = relay.url.replace('http', 'ws');
  const gateway2 = new WebSocket(`${wsUrl}/ws/gateway`);
  const gateway1 = new WebSocket(`${wsUrl}/ws/gateway`);
  const client = new WebSocket(`${wsUrl}/ws/client`);
  const session: RelaySession = {
    id: 'tth_rebind_session_gateway',
    provider: 'claude',
    title: 'Rebind',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    gatewayId: 'gateway-1',
    userId: 'user_3',
    status: 'running',
    transport: 'chat',
    lastActiveAt: Date.now()
  };

  try {
    await waitForOpen(gateway2);
    gateway2.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-2', token: GW_TOKEN_2 }));
    await waitForJson(gateway2, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(gateway1);
    gateway1.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-1', token: GW_TOKEN_1 }));
    await waitForJson(gateway1, (m) => m.type === 'gateway.auth.ok');
    gateway1.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-1', sessions: [session] }));

    await waitForOpen(client);
    const initialHelloPromise = waitForJson(client, (m) => m.type === 'hello');
    client.send(JSON.stringify({ type: 'client.auth', token: CLIENT_TOKEN_USER_3 }));
    await waitForJson(client, (m) => m.type === 'client.auth.ok');
    const initialHello = await initialHelloPromise;
    assert.equal(initialHello.gatewayId, 'gateway-2');

    const reboundHelloPromise = waitForJson(client, (m) => m.type === 'hello' && m.gatewayId === 'gateway-1');
    const reboundStatusPromise = waitForJson(client, (m) => m.type === 'gateway.status' && m.gatewayId === 'gateway-1');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: session.id, mode: 'control' }));
    const subscribe = await waitForJson(gateway1, (m) => m.type === 'client.subscribe' && m.sessionId === session.id);
    assert.equal(subscribe.type, 'client.subscribe');
    await reboundHelloPromise;
    await reboundStatusPromise;
  } finally {
    gateway1.close();
    gateway2.close();
    client.close();
    await relay.close();
  }
});

async function authenticateGateway(ws: WebSocket, gatewayId = 'gateway-test'): Promise<void> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'gateway.auth', gatewayId, token: GATEWAY_TOKEN }));
  await waitForJson(ws, (message) => message.type === 'gateway.auth.ok');
}

async function authenticateClient(ws: WebSocket, options?: { token?: string; scope?: RelayAuthScope }): Promise<string> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'client.auth', token: options?.token ?? CLIENT_TOKEN, scope: options?.scope }));
  const auth = await waitForJson(ws, (message) => message.type === 'client.auth.ok');
  assert.equal(typeof auth.clientId, 'string');
  return auth.clientId as string;
}

async function authenticateLegacyClient(ws: WebSocket, scope: RelayAuthScope): Promise<string> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'client.auth', secret: SECRET, scope }));
  const auth = await waitForJson(ws, (message) => message.type === 'client.auth.ok');
  assert.equal(typeof auth.clientId, 'string');
  return auth.clientId as string;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${CLIENT_TOKEN}` };
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket open')), 1000);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', reject);
  });
}

async function waitForJson(ws: WebSocket, predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    let lastMessage = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for websocket message; last=${lastMessage}`)), 1000);
    ws.on('message', (raw) => {
      lastMessage = raw.toString();
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        clearTimeout(timer);
        resolve(message);
      }
    });
    ws.on('error', reject);
  });
}

async function waitForPing(ws: WebSocket, timeoutMs = 1000): Promise<void> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for websocket ping'));
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

async function waitForClose(ws: WebSocket, timeoutMs = 1000): Promise<{ code: number; reason: string }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket close')), timeoutMs);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', reject);
  });
}
