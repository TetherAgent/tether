import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import type { RelayAuthScope, RelayServerToClientFrame, RelaySession } from '@tether/protocol';
import { startRelayServer } from './relay.js';

const SECRET = 'test-relay-secret';
const GATEWAY_TOKEN = 'gateway-token';
const CLIENT_TOKEN = 'client-token';
const CLIENT_TICKET = 'client-ticket';

function createRelay(options?: { allowLegacySecret?: boolean; omitGatewayIdInScope?: boolean }) {
  return startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    allowLegacySecret: options?.allowLegacySecret,
    validateToken: async (token) => {
      if (token === GATEWAY_TOKEN) {
        return {
          accountId: 'acct_1',
          workspaceId: 'ws_1',
          gatewayId: options?.omitGatewayIdInScope ? undefined : 'gateway-test',
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

test('relay rejects unauthenticated sockets', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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

test('relay keeps cached running sessions when gateway sends a transient empty list', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
  const gatewayOne = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const gatewayTwo = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
  const ticketClient = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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

test('relay allows unscoped sessions only for legacy secret clients', async () => {
  const relay = await createRelay({ allowLegacySecret: true });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);
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
    const clientId = await authenticateLegacyClient(client, legacyScope);

    const sessionsPromise = waitForJson(client, (message) => message.type === 'sessions');
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [
        { id: 'tth_legacy_unscoped', provider: 'codex', title: 'legacy', projectPath: process.cwd(), status: 'running', transport: 'pty-event-stream', lastActiveAt: Date.now() }
      ]
    }));

    const sessions = await sessionsPromise;
    assert.equal((sessions.sessions as RelaySession[]).some((session) => session.id === 'tth_legacy_unscoped'), true);

    const subscribePromise = waitForJson(gateway, (message) => message.type === 'client.subscribe');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_legacy_unscoped', after: 0, mode: 'control' }));
    const subscribe = await subscribePromise;
    assert.equal(subscribe.clientId, clientId);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects observe tickets that send control frames', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/gateway`);
  const ticketClient = new WebSocket(`${relay.url.replace('http', 'ws')}/client`);

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
