import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import WebSocket from 'ws';
import type { RelayAuthScope, RelayServerToClientFrame, RelaySession } from '@tether/protocol';
import { startRelayServer } from '../src/relay.js';

const SECRET = 'test-relay-secret';
const GATEWAY_TOKEN = 'gateway-token';
const CLIENT_TOKEN = 'client-token';
const CLIENT_TICKET = 'client-ticket';

function createRelay(options?: {
  allowLegacySecret?: boolean;
  omitGatewayIdInScope?: boolean;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  serverSyncUrl?: string;
  runtimeSyncSecret?: string;
}) {
  return startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    allowLegacySecret: options?.allowLegacySecret,
    serverSyncUrl: options?.serverSyncUrl,
    runtimeSyncSecret: options?.runtimeSyncSecret,
    heartbeatIntervalMs: options?.heartbeatIntervalMs,
    heartbeatTimeoutMs: options?.heartbeatTimeoutMs,
    validateToken: async (token) => {
      if (token === GATEWAY_TOKEN) {
        return {
          accountId: 'acct_1',
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
          userId: 'user_1',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_client'
        };
      }
      if (token === CLIENT_TICKET) {
        return {
          accountId: 'acct_1',
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

async function createMetadataServer(metadata: Record<string, Record<string, unknown>>) {
  const requests: Array<{ method?: string; url?: string; body: string }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      const match = request.url?.match(/^\/api\/relay\/gateway-sessions\/([^/]+)\/metadata$/);
      if (request.method === 'GET' && match) {
        const session = metadata[decodeURIComponent(match[1]!)];
        if (!session) {
          response.writeHead(404, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ code: 404, msg: 'not found', data: null }));
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 0, msg: 'success', data: session }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, msg: 'success', data: { ok: true } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
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

test('relay rejects nested forbidden command-shaped keys after authentication', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateClient(client);
    client.send(JSON.stringify({
      type: 'client.chat',
      sessionId: null,
      provider: 'codex',
      model: 'auto',
      cwd: process.cwd(),
      message: 'hi',
      gatewayId: 'gateway-test',
      metadata: {
        env: { OPENAI_API_KEY: 'sk-test' }
      }
    }));
    const close = await waitForClose(client);
    assert.equal(close.code, 1008);
    assert.equal(close.reason, 'invalid frame');
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

    client.send(JSON.stringify({ type: 'client.list' }));
    const cachedList = await waitForJson(client, (message) => message.type === 'sessions');
    assert.deepEqual(cachedList.sessions, sessions);
  } finally {
    gateway.close();
    client.close();
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

test('relay reports session_not_found without clearing sessions when subscribing to an uncached session', async () => {
  const relay = await createRelay();
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateClient(client);

    const notFoundPromise = waitForJson(
      client,
      (message) => message.type === 'error' && message.code === 'session_not_found'
    );
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_missing_cache', mode: 'control' }));

    const notFound = await notFoundPromise;
    assert.equal(notFound.sessionId, 'tth_missing_cache');
    const clearCheck = await Promise.race([
      waitForJson(client, (message) => message.type === 'sessions' && Array.isArray(message.sessions) && message.sessions.length === 0, 150)
        .then(() => 'cleared', () => 'not-cleared'),
      new Promise<string>((resolve) => setTimeout(() => resolve('not-cleared'), 200))
    ]);
    assert.equal(clearCheck, 'not-cleared');
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

    const listSessionsPromise = waitForJson(
      client,
      (message) => message.type === 'sessions' && Array.isArray(message.sessions)
    );
    client.send(JSON.stringify({ type: 'client.list' }));
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
    assert.deepEqual(scopedSessions.sessions, [sessionOne, sessionTwo]);

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
  const metadataServer = await createMetadataServer({
    tth_chat_test: {
      id: 'tth_chat_test',
      provider: 'codex',
      projectPath: process.cwd(),
      accountId: 'acct_1',
      gatewayId: 'gateway-test',
      userId: 'user_1',
      transport: 'chat'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
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
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'chat',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_chat_test', after: 0, mode: 'control' }));

    client.send(JSON.stringify({ type: 'client.chat', sessionId: 'tth_chat_test', message: 'hello world' }));
    const chat = await waitForJson(gateway, (message) => message.type === 'client.chat');
    assert.deepEqual(chat, {
      type: 'client.chat',
      clientId,
      sessionId: 'tth_chat_test',
      message: 'hello world',
      session: {
        id: 'tth_chat_test',
        provider: 'codex',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        transport: 'chat'
      }
    });
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('relay preserves first-message chat title when syncing new chat sessions', async () => {
  const metadataServer = await createMetadataServer({});
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);

    gateway.send(JSON.stringify({
      type: 'gateway.chat-session-created',
      gatewayId: 'gateway-test',
      clientId,
      session: {
        id: 'tth_first_message_title',
        provider: 'claude',
        title: '帮我看一下这个登录问题',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        transport: 'chat'
      }
    }));

    const sessions = await waitForJson(client, (message) =>
      message.type === 'sessions' &&
      (message.sessions as RelaySession[]).some((session) => session.id === 'tth_first_message_title')
    );
    const syncedRequest = metadataServer.requests.find((request) => request.url === '/api/relay/runtime-sync/gateway/sessions');
    assert(syncedRequest);
    const syncedBody = JSON.parse(syncedRequest.body) as { sessions: Array<{ title?: string }> };
    assert.equal(syncedBody.sessions[0]?.title, '帮我看一下这个登录问题');

    const created = (sessions.sessions as RelaySession[]).find((session) => session.id === 'tth_first_message_title');
    assert.equal(created?.title, '帮我看一下这个登录问题');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
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

test('relay unsubscribe removes only current client subscription', async () => {
  const relay = await createRelay();
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const clientA = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const clientB = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessionId = 'tth_unsubscribe_test';

  try {
    await authenticateGateway(gateway);
    const clientAId = await authenticateClient(clientA);
    await authenticateClient(clientB);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: sessionId,
        provider: 'codex',
        title: 'Unsubscribe Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(clientA, (message) => message.type === 'sessions');
    await waitForJson(clientB, (message) => message.type === 'sessions');

    clientA.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe' && message.clientId === clientAId);
    clientB.send(JSON.stringify({ type: 'client.subscribe', sessionId, after: 0, mode: 'control' }));
    await waitForJson(gateway, (message) => message.type === 'client.subscribe' && message.clientId !== clientAId);

    const unsubscribePromise = waitForJson(gateway, (message) => message.type === 'client.unsubscribe');
    clientA.send(JSON.stringify({ type: 'client.unsubscribe', sessionId }));
    const unsubscribe = await unsubscribePromise;
    assert.deepEqual(unsubscribe, { type: 'client.unsubscribe', clientId: clientAId, sessionId });

    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-test',
      event: {
        id: 1,
        sessionId,
        type: 'agent.status',
        ts: Date.now(),
        payload: { status: 'running' }
      }
    }));

    await waitForJson(clientB, (message) => message.type === 'event' && (message.event as { sessionId?: string })?.sessionId === sessionId);
    const clientALeak = await Promise.race([
      waitForJson(clientA, (message) => message.type === 'event' && (message.event as { sessionId?: string })?.sessionId === sessionId).then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 200))
    ]);
    assert.equal(clientALeak, 'isolated');
  } finally {
    gateway.close();
    clientA.close();
    clientB.close();
    await relay.close();
  }
});

test('relay does not forward cross-account unsubscribe to another session gateway', async () => {
  const relay = await createRelay({ allowLegacySecret: true });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const sessionId = 'tth_cross_account_unsubscribe';
  const gatewayFrames: Record<string, unknown>[] = [];

  try {
    await authenticateGateway(gateway);
    await authenticateLegacyClient(client, {
      accountId: 'acct_2',
      userId: 'user_2',
      tokenClass: 'normal_client_access',
      expiresAt: Date.now() + 60_000,
      jti: 'jti_cross_unsub'
    });
    gateway.on('message', (raw) => gatewayFrames.push(JSON.parse(raw.toString()) as Record<string, unknown>));
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: sessionId,
        provider: 'codex',
        title: 'Cross Account Unsubscribe Test',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'pty-event-stream',
        lastActiveAt: Date.now()
      }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    client.send(JSON.stringify({ type: 'client.unsubscribe', sessionId }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.equal(gatewayFrames.some((frame) => frame.type === 'client.unsubscribe'), false);
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
        {
          id: 'tth_other_account',
          provider: 'codex',
          title: 'Other Account',
          projectPath: process.cwd(),
          accountId: 'acct_2',
          gatewayId: 'gateway-test',
          userId: 'user_1',
          status: 'running',
          transport: 'pty-event-stream',
          lastActiveAt: Date.now()
        }
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
    const error = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.message, 'session is outside client scope');
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
        {
          id: 'tth_ticket_test',
          provider: 'codex',
          title: 'Ticket Test',
          projectPath: process.cwd(),
          accountId: 'acct_1',
          gatewayId: 'gateway-test',
          userId: 'user_1',
          status: 'running',
          transport: 'pty-event-stream',
          lastActiveAt: Date.now()
        }
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
          gatewayId: 'gateway-test',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_sync_test'
        };
      }
      if (token === CLIENT_TOKEN) {
        return {
          accountId: 'acct_1',
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
      if (token === GW_TOKEN_1) {
        return { accountId: 'acct_1', gatewayId: 'gateway-acct1', userId: 'user_1', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_1' };
      }
      if (token === GW_TOKEN_2) {
        return { accountId: 'acct_2', gatewayId: 'gateway-acct2', userId: 'user_2', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_2' };
      }
      if (token === CLIENT_TOKEN_1) {
        return { accountId: 'acct_1', userId: 'user_1', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_1' };
      }
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
    client.send(JSON.stringify({ type: 'client.cwd-suggest', cwd: '~', gatewayId: 'gateway-acct1' }));
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
    assert.equal(hello.gatewayId, undefined);

    client.send(JSON.stringify({ type: 'client.cwd-suggest', cwd: '~', gatewayId: 'gateway-user3' }));
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
    const required = await waitForJson(client, (m) => m.type === 'error' && m.code === 'gateway_required');
    assert.equal(required.message, 'gatewayId is required in frame');

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
        return { accountId: 'acct_1', gatewayId: 'gateway-1', userId: 'user_3', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_1' };
      }
      if (token === GW_TOKEN_2) {
        return { accountId: 'acct_1', gatewayId: 'gateway-2', userId: 'user_4', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_2' };
      }
      if (token === CLIENT_TOKEN_USER_3) {
        return { accountId: 'acct_1', userId: 'user_3', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_user3' };
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
    gatewayId: 'gateway-1',
    userId: 'user_3',
    status: 'running',
    transport: 'pty-event-stream',
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
    assert.equal(initialHello.gatewayId, undefined);

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

test('relay rebinds client from one same-user gateway session to another', async () => {
  const GW_TOKEN_1 = 'gw-token-switch-1';
  const GW_TOKEN_2 = 'gw-token-switch-2';
  const CLIENT_TOKEN_USER = 'client-token-switch-user';

  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === GW_TOKEN_1) {
        return { accountId: 'acct_1', gatewayId: 'gateway-switch-1', userId: 'user_switch', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_switch_1' };
      }
      if (token === GW_TOKEN_2) {
        return { accountId: 'acct_1', gatewayId: 'gateway-switch-2', userId: 'user_switch', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_switch_2' };
      }
      if (token === CLIENT_TOKEN_USER) {
        return { accountId: 'acct_1', userId: 'user_switch', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_switch' };
      }
      return undefined;
    }
  });

  const wsUrl = relay.url.replace('http', 'ws');
  const gateway1 = new WebSocket(`${wsUrl}/ws/gateway`);
  const gateway2 = new WebSocket(`${wsUrl}/ws/gateway`);
  const client = new WebSocket(`${wsUrl}/ws/client`);
  const session1: RelaySession = {
    id: 'tth_switch_gateway_1',
    provider: 'claude',
    title: 'Switch Gateway 1',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    gatewayId: 'gateway-switch-1',
    userId: 'user_switch',
    status: 'running',
    transport: 'chat',
    lastActiveAt: Date.now()
  };
  const session2: RelaySession = {
    id: 'tth_switch_gateway_2',
    provider: 'claude',
    title: 'Switch Gateway 2',
    projectPath: process.cwd(),
    accountId: 'acct_1',
    gatewayId: 'gateway-switch-2',
    userId: 'user_switch',
    status: 'running',
    transport: 'chat',
    lastActiveAt: Date.now()
  };

  try {
    await waitForOpen(gateway1);
    gateway1.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-switch-1', token: GW_TOKEN_1 }));
    await waitForJson(gateway1, (m) => m.type === 'gateway.auth.ok');
    gateway1.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-switch-1', sessions: [session1] }));

    await waitForOpen(gateway2);
    gateway2.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-switch-2', token: GW_TOKEN_2 }));
    await waitForJson(gateway2, (m) => m.type === 'gateway.auth.ok');
    gateway2.send(JSON.stringify({ type: 'gateway.sessions', gatewayId: 'gateway-switch-2', sessions: [session2] }));

    await waitForOpen(client);
    client.send(JSON.stringify({ type: 'client.auth', token: CLIENT_TOKEN_USER }));
    await waitForJson(client, (m) => m.type === 'client.auth.ok');

    const firstHelloPromise = waitForJson(client, (m) => m.type === 'hello' && m.gatewayId === 'gateway-switch-1');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: session1.id, mode: 'control' }));
    await firstHelloPromise;

    const reboundHelloPromise = waitForJson(client, (m) => m.type === 'hello' && m.gatewayId === 'gateway-switch-2');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: session2.id, mode: 'control' }));
    await reboundHelloPromise;

    const forbiddenCheck = await Promise.race([
      waitForJson(client, (m) => m.type === 'error' && m.code === 'forbidden').then(() => 'forbidden'),
      new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 150))
    ]);
    assert.equal(forbiddenCheck, 'ok');
  } finally {
    gateway1.close();
    gateway2.close();
    client.close();
    await relay.close();
  }
});

test('phase14: client.chat without gatewayId returns gateway_required and does not route to first gateway', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gw-token-b') {
        return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_b' };
      }
      if (token === 'client-token-a') {
        return { accountId: 'acct_a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_a' };
      }
      return undefined;
    }
  });
  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayB = new WebSocket(`${wsUrl}/ws/gateway`);
  const clientA = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-token-b' }));
    await waitForJson(gatewayB, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(clientA);
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-token-a' }));
    await waitForJson(clientA, (m) => m.type === 'client.auth.ok');
    clientA.send(JSON.stringify({ type: 'client.chat', sessionId: null, provider: 'codex', model: 'auto', cwd: '~', message: 'hi' }));
    const required = await waitForJson(clientA, (m) => m.type === 'error' && m.code === 'gateway_required');
    assert.equal(required.message, 'gatewayId is required in frame');

    const leakCheck = await Promise.race([
      waitForJson(gatewayB, (m) => m.type === 'client.chat').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayB.close();
    clientA.close();
    await relay.close();
  }
});

test('phase14: client.chat with another account gatewayId returns gateway_unauthorized', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gw-token-b') {
        return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_b' };
      }
      if (token === 'client-token-a') {
        return { accountId: 'acct_a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_a' };
      }
      return undefined;
    }
  });
  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayB = new WebSocket(`${wsUrl}/ws/gateway`);
  const clientA = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-token-b' }));
    await waitForJson(gatewayB, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(clientA);
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-token-a' }));
    await waitForJson(clientA, (m) => m.type === 'client.auth.ok');
    clientA.send(JSON.stringify({ type: 'client.chat', sessionId: null, provider: 'codex', model: 'auto', cwd: '~', message: 'hi', gatewayId: 'gateway-b' }));
    const unauthorized = await waitForJson(clientA, (m) => m.type === 'error' && m.code === 'gateway_unauthorized');
    assert.equal(unauthorized.message, 'gateway does not belong to client account/user');

    const leakCheck = await Promise.race([
      waitForJson(gatewayB, (m) => m.type === 'client.chat').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayB.close();
    clientA.close();
    await relay.close();
  }
});

test('phase18: client.new-pty-session routes by bound client.gatewayId only', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gw-token-b') {
        return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_b' };
      }
      if (token === 'gw-token-a') {
        return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_a' };
      }
      if (token === 'client-token-a') {
        return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_a' };
      }
      return undefined;
    }
  });
  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayB = new WebSocket(`${wsUrl}/ws/gateway`);
  const gatewayA = new WebSocket(`${wsUrl}/ws/gateway`);
  const clientA = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-token-b' }));
    await waitForJson(gatewayB, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(gatewayA);
    gatewayA.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-a', token: 'gw-token-a' }));
    await waitForJson(gatewayA, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(clientA);
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-token-a' }));
    const authOk = await waitForJson(clientA, (m) => m.type === 'client.auth.ok');

    clientA.send(JSON.stringify({
      type: 'client.new-pty-session',
      provider: 'codex',
      command: 'codex',
      cwd: process.cwd(),
      cols: 120,
      rows: 40,
      gatewayId: 'gateway-b'
    }));
    const routed = await waitForJson(gatewayA, (m) => m.type === 'client.new-pty-session');
    assert.equal(routed.clientId, authOk.clientId);
    assert.equal(routed.provider, 'codex');

    const leakCheck = await Promise.race([
      waitForJson(gatewayB, (m) => m.type === 'client.new-pty-session').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayA.close();
    gatewayB.close();
    clientA.close();
    await relay.close();
  }
});

test('phase14: client.list-providers with matching gatewayId routes only to that gateway', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gw-token-b') {
        return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_b' };
      }
      if (token === 'gw-token-a') {
        return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_a' };
      }
      if (token === 'client-token-a') {
        return { accountId: 'acct_a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_a' };
      }
      return undefined;
    }
  });
  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayB = new WebSocket(`${wsUrl}/ws/gateway`);
  const gatewayA = new WebSocket(`${wsUrl}/ws/gateway`);
  const clientA = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-token-b' }));
    await waitForJson(gatewayB, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(gatewayA);
    gatewayA.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-a', token: 'gw-token-a' }));
    await waitForJson(gatewayA, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(clientA);
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-token-a' }));
    await waitForJson(clientA, (m) => m.type === 'client.auth.ok');
    clientA.send(JSON.stringify({ type: 'client.list-providers', gatewayId: 'gateway-a' }));
    const routed = await waitForJson(gatewayA, (m) => m.type === 'client.list-providers');
    assert.equal(routed.type, 'client.list-providers');

    const leakCheck = await Promise.race([
      waitForJson(gatewayB, (m) => m.type === 'client.list-providers').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayA.close();
    gatewayB.close();
    clientA.close();
    await relay.close();
  }
});

test('phase14: client auth does not implicitly bind to connected gateway status', async () => {
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    validateToken: async (token) => {
      if (token === 'gw-token-b') {
        return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'jti_gw_b' };
      }
      if (token === 'client-token-a') {
        return { accountId: 'acct_a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'jti_client_a' };
      }
      return undefined;
    }
  });
  const wsUrl = relay.url.replace('http', 'ws');
  const gatewayB = new WebSocket(`${wsUrl}/ws/gateway`);
  const clientA = new WebSocket(`${wsUrl}/ws/client`);

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-token-b' }));
    await waitForJson(gatewayB, (m) => m.type === 'gateway.auth.ok');

    await waitForOpen(clientA);
    const helloPromise = waitForJson(clientA, (m) => m.type === 'hello');
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-token-a' }));
    await waitForJson(clientA, (m) => m.type === 'client.auth.ok');
    const hello = await helloPromise;
    assert.equal(hello.gatewayId, undefined);

    const statusCheck = await Promise.race([
      waitForJson(clientA, (m) => m.type === 'gateway.status' && m.gatewayId === 'gateway-b').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(statusCheck, 'isolated');

    clientA.send(JSON.stringify({ type: 'client.list-providers' }));
    const required = await waitForJson(clientA, (m) => m.type === 'error' && m.code === 'gateway_required');
    assert.equal(required.message, 'gatewayId is required in frame');

    const leakCheck = await Promise.race([
      waitForJson(gatewayB, (m) => m.type === 'client.list-providers').then(() => 'leaked'),
      new Promise<string>((resolve) => setTimeout(() => resolve('isolated'), 300))
    ]);
    assert.equal(leakCheck, 'isolated');
  } finally {
    gatewayB.close();
    clientA.close();
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

async function waitForJson(
  ws: WebSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 1000
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    let lastMessage = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for websocket message; last=${lastMessage}`)), timeoutMs);
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

// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-T1: relay injects trusted metadata into client.chat (existing session)', async () => {
  const metadataServer = await createMetadataServer({
    tth_phase15_chat: {
      id: 'tth_phase15_chat',
      provider: 'claude',
      projectPath: '/tmp/tether-phase15',
      agentSessionId: 'agent-existing',
      accountId: 'acct_1',
      userId: 'user_1',
      gatewayId: 'gateway-test',
      transport: 'chat'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.chat', sessionId: 'tth_phase15_chat', message: 'hi', model: 'sonnet' }));
    const chat = await waitForJson(gateway, (message) => message.type === 'client.chat');
    assert.equal(chat.clientId, clientId);
    assert.equal(chat.sessionId, 'tth_phase15_chat');
    assert.equal((chat.session as Record<string, unknown>).provider, 'claude');
    assert.equal((chat.session as Record<string, unknown>).projectPath, '/tmp/tether-phase15');
    assert.equal((chat.session as Record<string, unknown>).transport, 'chat');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('Phase15-T2: relay rejects cross-account session continuation', async () => {
  const metadataServer = await createMetadataServer({
    tth_cross_account: {
      id: 'tth_cross_account',
      provider: 'claude',
      projectPath: '/tmp/other-account',
      accountId: 'acct_2',
      userId: 'user_2',
      gatewayId: 'gateway-test',
      transport: 'chat'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    client.send(JSON.stringify({ type: 'client.chat', sessionId: 'tth_cross_account', message: 'hi' }));
    const error = await waitForJson(client, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.sessionId, 'tth_cross_account');
    await assert.rejects(
      waitForJson(gateway, (message) => message.type === 'client.chat', 150),
      /timed out/
    );
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('relay hydrates chat session metadata on subscribe when relay cache is empty', async () => {
  const sessionId = 'tth_hydrate_subscribe';
  const metadataServer = await createMetadataServer({
    [sessionId]: {
      id: sessionId,
      provider: 'claude',
      projectPath: '/tmp/hydrate',
      accountId: 'acct_1',
      userId: 'user_1',
      gatewayId: 'gateway-test',
      transport: 'chat'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, mode: 'control' }));
    const sessions = await waitForJson(
      client,
      (message) =>
        message.type === 'sessions' &&
        Array.isArray(message.sessions) &&
        (message.sessions as RelaySession[]).some((session) => session.id === sessionId)
    );
    const hydrated = (sessions.sessions as RelaySession[]).find((session) => session.id === sessionId);
    assert.equal(hydrated?.transport, 'chat');
    assert.equal(hydrated?.gatewayId, 'gateway-test');

    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-test',
      event: {
        id: 1,
        sessionId,
        type: 'session.agent-id-updated',
        ts: Date.now(),
        payload: { agentSessionId: 'agent-hydrated' }
      }
    }));
    const event = await waitForJson(client, (message) => message.type === 'event');
    assert.equal((event.event as { sessionId?: string }).sessionId, sessionId);
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('relay hydrates PTY session metadata on subscribe when relay cache is empty', async () => {
  const sessionId = 'tth_hydrate_pty_subscribe';
  const metadataServer = await createMetadataServer({
    [sessionId]: {
      id: sessionId,
      provider: 'codex',
      projectPath: '/tmp/hydrate-pty',
      accountId: 'acct_1',
      userId: 'user_1',
      gatewayId: 'gateway-test',
      transport: 'pty-event-stream'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

    const subscribePromise = waitForJson(gateway, (message) => message.type === 'client.subscribe' && message.sessionId === sessionId);
    const sessionsPromise = waitForJson(
      client,
      (message) =>
        message.type === 'sessions' &&
        Array.isArray(message.sessions) &&
        (message.sessions as RelaySession[]).some((session) => session.id === sessionId)
    );
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId, mode: 'control', after: 0 }));
    const subscribe = await subscribePromise;
    assert.equal(subscribe.type, 'client.subscribe');
    const sessions = await sessionsPromise;
    const hydrated = (sessions.sessions as RelaySession[]).find((session) => session.id === sessionId);
    assert.equal(hydrated?.transport, 'pty-event-stream');
    assert.equal(hydrated?.gatewayId, 'gateway-test');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('Phase15-A7: relay rejects client.chat for PTY sessions (transport mismatch)', async () => {
  const metadataServer = await createMetadataServer({
    tth_pty_session: {
      id: 'tth_pty_session',
      provider: 'codex',
      projectPath: '/tmp/pty',
      accountId: 'acct_1',
      userId: 'user_1',
      gatewayId: 'gateway-test',
      transport: 'pty-event-stream'
    }
  });
  const relay = await createRelay({ serverSyncUrl: metadataServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    client.send(JSON.stringify({ type: 'client.chat', sessionId: 'tth_pty_session', message: 'hi' }));
    const error = await waitForJson(client, (message) => message.type === 'error' && message.code === 'wrong_transport');
    assert.equal(error.sessionId, 'tth_pty_session');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await metadataServer.close();
  }
});

test('Phase16: chat catch-up is isolated by account', async () => {
  const chatEventsBySession: Record<string, Array<{ eventId: number; rawJson: string }>> = {
    tth_chat_acct_a: [{ eventId: 1, rawJson: JSON.stringify({ payload: { text: 'hello-a' } }) }],
    tth_chat_acct_b: []
  };
  const requests: Array<{ method?: string; url?: string; body: string }> = [];
  const syncServer = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk.toString(); });
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body });
      const match = request.url?.match(/^\/api\/relay\/chat-events\/([^?]+)\?after=(\d+)$/);
      if (request.method === 'GET' && match) {
        const sessionId = decodeURIComponent(match[1]!);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ code: 0, msg: 'success', data: { events: chatEventsBySession[sessionId] ?? [] } }));
        return;
      }
      const metadataMatch = request.url?.match(/^\/api\/relay\/gateway-sessions\/([^/]+)\/metadata$/);
      if (request.method === 'GET' && metadataMatch) {
        const sessionId = decodeURIComponent(metadataMatch[1]!);
        const accountSuffix = sessionId.endsWith('_b') ? 'b' : 'a';
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            id: sessionId,
            provider: 'codex',
            projectPath: process.cwd(),
            accountId: `acct_${accountSuffix}`,
            gatewayId: `gateway-${accountSuffix}`,
            userId: `user_${accountSuffix}`,
            transport: 'chat'
          }
        }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: 0, msg: 'success', data: { ok: true } }));
    });
  });
  await new Promise<void>((resolve) => syncServer.listen(0, '127.0.0.1', resolve));
  const address = syncServer.address();
  assert(address && typeof address !== 'string');
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    serverSyncUrl: `http://127.0.0.1:${address.port}`,
    runtimeSyncSecret: 'runtime-secret',
    validateToken: async (token) => {
      if (token === 'gw-b') return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'gw_b' };
      if (token === 'gw-a') return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'gw_a' };
      if (token === 'client-b') return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'client_b' };
      if (token === 'client-a') return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'client_a' };
      return undefined;
    }
  });
  const gatewayB = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const gatewayA = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const clientB = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const clientA = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);
  const clientBFrames: RelayServerToClientFrame[] = [];
  clientB.on('message', (raw) => {
    clientBFrames.push(JSON.parse(raw.toString()) as RelayServerToClientFrame);
  });

  try {
    await waitForOpen(gatewayB);
    gatewayB.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-b', token: 'gw-b' }));
    await waitForJson(gatewayB, (message) => message.type === 'gateway.auth.ok');
    await waitForOpen(gatewayA);
    gatewayA.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-a', token: 'gw-a' }));
    await waitForJson(gatewayA, (message) => message.type === 'gateway.auth.ok');
    await waitForOpen(clientB);
    clientB.send(JSON.stringify({ type: 'client.auth', token: 'client-b' }));
    await waitForJson(clientB, (message) => message.type === 'client.auth.ok');
    await waitForOpen(clientA);
    clientA.send(JSON.stringify({ type: 'client.auth', token: 'client-a' }));
    await waitForJson(clientA, (message) => message.type === 'client.auth.ok');

    clientB.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_chat_acct_b', mode: 'control', after: 0 }));
    await waitForJson(
      clientB,
      (message) =>
        message.type === 'sessions' &&
        Array.isArray(message.sessions) &&
        (message.sessions as RelaySession[]).some((session) => session.id === 'tth_chat_acct_b')
    );
    clientA.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_chat_acct_a', mode: 'control', after: 0 }));
    const catchupA = await waitForJson(clientA, (message) => message.type === 'gateway.chat-catchup');
    assert.equal(catchupA.sessionId, 'tth_chat_acct_a');
    assert.equal(catchupA.text, 'hello-a');
    assert.equal(catchupA.lastEventId, 1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(clientBFrames.some((frame) => frame.type === 'gateway.chat-catchup'), false);
  } finally {
    gatewayB.close();
    gatewayA.close();
    clientB.close();
    clientA.close();
    await relay.close();
    await new Promise<void>((resolve, reject) => syncServer.close((error) => error ? reject(error) : resolve()));
  }
});

test('Phase16: agent.delta syncs to Server with chat transport', async () => {
  const syncServer = await createMetadataServer({});
  const relay = await createRelay({ serverSyncUrl: syncServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_delta_sync',
        provider: 'codex',
        title: 'Delta Sync',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'chat',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');
    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_delta_sync', mode: 'control', after: 0 }));

    const deltaFrame = waitForJson(client, (message) => message.type === 'agent.delta');
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-test',
      event: {
        id: 3,
        sessionId: 'tth_delta_sync',
        type: 'agent.delta',
        ts: Date.now(),
        payload: { text: 'abc' }
      }
    }));

    const delta = await deltaFrame;
    assert.equal(delta.text, 'abc');
    assert.equal(delta.eventId, 3);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const syncRequest = syncServer.requests
      .map((request) => ({ ...request, parsed: request.body ? JSON.parse(request.body) as Record<string, unknown> : undefined }))
      .find((request) => request.url === '/api/relay/runtime-sync/gateway/event' && (request.parsed?.event as { type?: string } | undefined)?.type === 'agent.delta');
    assert(syncRequest?.parsed, 'agent.delta sync request should be captured');
    const scope = syncRequest.parsed.scope as { transport?: string } | undefined;
    assert.equal(scope?.transport, 'chat');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await syncServer.close();
  }
});

test('Phase16: agent.result syncs to Server with chat transport from session metadata', async () => {
  const syncServer = await createMetadataServer({});
  const relay = await createRelay({ serverSyncUrl: syncServer.url, runtimeSyncSecret: 'runtime-secret' });
  const gateway = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/gateway`);
  const client = new WebSocket(`${relay.url.replace('http', 'ws')}/ws/client`);

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);
    gateway.send(JSON.stringify({
      type: 'gateway.sessions',
      gatewayId: 'gateway-test',
      sessions: [{
        id: 'tth_result_sync',
        provider: 'codex',
        title: 'Result Sync',
        projectPath: process.cwd(),
        accountId: 'acct_1',
        gatewayId: 'gateway-test',
        userId: 'user_1',
        status: 'running',
        transport: 'chat',
        lastActiveAt: Date.now()
      }]
    }));
    await waitForJson(client, (message) => message.type === 'sessions');

    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-test',
      event: {
        id: 4,
        sessionId: 'tth_result_sync',
        type: 'agent.result',
        ts: Date.now(),
        payload: {
          text: 'done',
          usage: { input_tokens: 1, output_tokens: 2 },
          lastDeltaEventId: 3,
          providerRaw: { type: 'result', result: 'done' }
        }
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    const syncRequest = syncServer.requests
      .map((request) => ({ ...request, parsed: request.body ? JSON.parse(request.body) as Record<string, unknown> : undefined }))
      .find((request) => request.url === '/api/relay/runtime-sync/gateway/event' && (request.parsed?.event as { type?: string } | undefined)?.type === 'agent.result');
    assert(syncRequest?.parsed, 'agent.result sync request should be captured');
    const scope = syncRequest.parsed.scope as { transport?: string } | undefined;
    assert.equal(scope?.transport, 'chat');
    const event = syncRequest.parsed.event as { payload?: { providerRaw?: { type?: string; result?: string } } } | undefined;
    assert.equal(event?.payload?.providerRaw?.type, 'result');
    assert.equal(event?.payload?.providerRaw?.result, 'done');
  } finally {
    gateway.close();
    client.close();
    await relay.close();
    await syncServer.close();
  }
});

// ─── Phase 17: Chat Multi-client Realtime Sync ──────────────────────────────

type Phase17RelayHarness = Awaited<ReturnType<typeof createPhase17RelayHarness>>;

async function createPhase17RelayHarness() {
  const metadataBySession: Record<string, Record<string, unknown>> = {};
  const syncServer = await createMetadataServer(metadataBySession);
  const relay = await startRelayServer({
    host: '127.0.0.1',
    port: 0,
    secret: SECRET,
    serverSyncUrl: syncServer.url,
    runtimeSyncSecret: 'runtime-secret',
    validateToken: async (token) => {
      if (token === 'gw-a') return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'gw_a' };
      if (token === 'gw-b') return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'gateway_access', expiresAt: Date.now() + 60_000, jti: 'gw_b' };
      if (token === 'client-a1') return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'cli_a1' };
      if (token === 'client-a2') return { accountId: 'acct_a', gatewayId: 'gateway-a', userId: 'user_a', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'cli_a2' };
      if (token === 'client-b') return { accountId: 'acct_b', gatewayId: 'gateway-b', userId: 'user_b', tokenClass: 'normal_client_access', expiresAt: Date.now() + 60_000, jti: 'cli_b' };
      return undefined;
    }
  });

  return {
    metadataBySession,
    relay,
    syncServer,
    close: async () => {
      await relay.close();
      await syncServer.close();
    }
  };
}

function phase17Metadata(sessionId: string, account: 'a' | 'b' = 'a') {
  return {
    id: sessionId,
    provider: 'codex',
    projectPath: process.cwd(),
    accountId: `acct_${account}`,
    gatewayId: `gateway-${account}`,
    userId: `user_${account}`,
    transport: 'chat'
  };
}

async function openPhase17Gateway(harness: Phase17RelayHarness, account: 'a' | 'b') {
  const gateway = new WebSocket(`${harness.relay.url.replace('http', 'ws')}/ws/gateway`);
  await waitForOpen(gateway);
  gateway.send(JSON.stringify({ type: 'gateway.auth', gatewayId: `gateway-${account}`, token: `gw-${account}` }));
  await waitForJson(gateway, (message) => message.type === 'gateway.auth.ok');
  return gateway;
}

async function openPhase17ClientWithId(harness: Phase17RelayHarness, token: string) {
  const client = new WebSocket(`${harness.relay.url.replace('http', 'ws')}/ws/client`);
  await waitForOpen(client);
  client.send(JSON.stringify({ type: 'client.auth', token }));
  const auth = await waitForJson(client, (message) => message.type === 'client.auth.ok');
  assert.equal(typeof auth.clientId, 'string');
  return { client, clientId: auth.clientId as string };
}

async function openPhase17Client(harness: Phase17RelayHarness, token: string) {
  const { client } = await openPhase17ClientWithId(harness, token);
  return client;
}

async function subscribePhase17Chat(harness: Phase17RelayHarness, client: WebSocket, sessionId: string, account: 'a' | 'b' = 'a') {
  harness.metadataBySession[sessionId] = phase17Metadata(sessionId, account);
  client.send(JSON.stringify({ type: 'client.subscribe', sessionId, mode: 'control', after: 0 }));
  await waitForJson(client, (message) => message.type === 'sessions');
}

test('Phase17-T1: relay broadcasts agent.delta to all chat subscribers (same account)', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const clientA1 = await openPhase17Client(harness, 'client-a1');
  const clientA2 = await openPhase17Client(harness, 'client-a2');
  try {
    const sessionId = 'tth_phase17_delta';
    await subscribePhase17Chat(harness, clientA1, sessionId);
    await subscribePhase17Chat(harness, clientA2, sessionId);
    const delta1Promise = waitForJson(clientA1, (message) => message.type === 'agent.delta');
    const delta2Promise = waitForJson(clientA2, (message) => message.type === 'agent.delta');
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: { id: 1701, type: 'agent.delta', sessionId, payload: { text: 'hello-multi' } }
    }));
    const [delta1, delta2] = await Promise.all([delta1Promise, delta2Promise]);
    assert.equal(delta1.text, 'hello-multi');
    assert.equal(delta2.text, 'hello-multi');
  } finally {
    gateway.close();
    clientA1.close();
    clientA2.close();
    await harness.close();
  }
});

test('Phase17-T2: relay does not leak chat delta to another account', async () => {
  const harness = await createPhase17RelayHarness();
  const gatewayB = await openPhase17Gateway(harness, 'b');
  const gatewayA = await openPhase17Gateway(harness, 'a');
  const clientB = await openPhase17Client(harness, 'client-b');
  const clientA = await openPhase17Client(harness, 'client-a1');
  const clientBFrames: RelayServerToClientFrame[] = [];
  clientB.on('message', (raw) => clientBFrames.push(JSON.parse(raw.toString()) as RelayServerToClientFrame));
  try {
    await subscribePhase17Chat(harness, clientB, 'tth_phase17_iso_b', 'b');
    await subscribePhase17Chat(harness, clientA, 'tth_phase17_iso_a', 'a');
    gatewayA.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: { id: 1702, type: 'agent.delta', sessionId: 'tth_phase17_iso_a', payload: { text: 'secret-a' } }
    }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(clientBFrames.some((frame) => frame.type === 'agent.delta'), false);
  } finally {
    gatewayB.close();
    gatewayA.close();
    clientB.close();
    clientA.close();
    await harness.close();
  }
});

test('Phase17-T8: relay broadcasts user.message to other chat subscribers only', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const source = await openPhase17ClientWithId(harness, 'client-a1');
  const peer = await openPhase17ClientWithId(harness, 'client-a2');
  const sourceUserMessages: RelayServerToClientFrame[] = [];
  source.client.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as RelayServerToClientFrame;
    if (frame.type === 'user.message') sourceUserMessages.push(frame);
  });
  try {
    const sessionId = 'tth_phase17_user_message';
    await subscribePhase17Chat(harness, source.client, sessionId);
    await subscribePhase17Chat(harness, peer.client, sessionId);
    const peerMessagePromise = waitForJson(peer.client, (message) => message.type === 'user.message');
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: {
        id: 1708,
        type: 'user.message',
        sessionId,
        payload: { clientId: source.clientId, message: 'hello from laptop' }
      }
    }));
    const peerMessage = await peerMessagePromise;
    assert.equal(peerMessage.text, 'hello from laptop');
    assert.equal(peerMessage.eventId, 1708);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(sourceUserMessages.length, 0);
  } finally {
    gateway.close();
    source.client.close();
    peer.client.close();
    await harness.close();
  }
});

test('Phase17-T3: relay broadcasts agent.result to all chat subscribers', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const clientA1 = await openPhase17Client(harness, 'client-a1');
  const clientA2 = await openPhase17Client(harness, 'client-a2');
  try {
    const sessionId = 'tth_phase17_result';
    await subscribePhase17Chat(harness, clientA1, sessionId);
    await subscribePhase17Chat(harness, clientA2, sessionId);
    const result1Promise = waitForJson(clientA1, (message) => message.type === 'agent.result');
    const result2Promise = waitForJson(clientA2, (message) => message.type === 'agent.result');
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: {
        id: 1703,
        type: 'agent.result',
        sessionId,
        payload: { text: 'done', usage: { input_tokens: 1, output_tokens: 2 }, providerRaw: { type: 'result', result: 'done' } }
      }
    }));
    const [result1, result2] = await Promise.all([result1Promise, result2Promise]);
    assert.equal(result1.text, 'done');
    assert.equal(result2.text, 'done');
    assert.equal('providerRaw' in result1, false);
    assert.equal('providerRaw' in result2, false);
  } finally {
    gateway.close();
    clientA1.close();
    clientA2.close();
    await harness.close();
  }
});

test('Phase17-T4: relay broadcasts agent.permission_request to all chat subscribers', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const clientA1 = await openPhase17Client(harness, 'client-a1');
  const clientA2 = await openPhase17Client(harness, 'client-a2');
  try {
    const sessionId = 'tth_phase17_permission';
    await subscribePhase17Chat(harness, clientA1, sessionId);
    await subscribePhase17Chat(harness, clientA2, sessionId);
    const request1Promise = waitForJson(clientA1, (message) => message.type === 'agent.permission_request');
    const request2Promise = waitForJson(clientA2, (message) => message.type === 'agent.permission_request');
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: {
        id: 1704,
        type: 'agent.permission_request',
        sessionId,
        payload: { requestId: 'req-1', toolName: 'bash', input: { path: '/tmp' } }
      }
    }));
    const [request1, request2] = await Promise.all([request1Promise, request2Promise]);
    assert.equal(request1.requestId, 'req-1');
    assert.equal(request2.requestId, 'req-1');
  } finally {
    gateway.close();
    clientA1.close();
    clientA2.close();
    await harness.close();
  }
});

test('Phase17-T5: relay removes disconnected chat subscribers', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const clientA1 = await openPhase17Client(harness, 'client-a1');
  const clientA2 = await openPhase17Client(harness, 'client-a2');
  const clientA2Deltas: RelayServerToClientFrame[] = [];
  clientA2.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as RelayServerToClientFrame;
    if (frame.type === 'agent.delta') clientA2Deltas.push(frame);
  });
  try {
    const sessionId = 'tth_phase17_disconnect';
    await subscribePhase17Chat(harness, clientA1, sessionId);
    await subscribePhase17Chat(harness, clientA2, sessionId);
    clientA2.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: { id: 1705, type: 'agent.delta', sessionId, payload: { text: 'after-close' } }
    }));
    await waitForJson(clientA1, (message) => message.type === 'agent.delta');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(clientA2Deltas.length, 0);
  } finally {
    gateway.close();
    clientA1.close();
    await harness.close();
  }
});

test('Phase17-T6: relay removes unsubscribed chat subscribers', async () => {
  const harness = await createPhase17RelayHarness();
  const gateway = await openPhase17Gateway(harness, 'a');
  const clientA1 = await openPhase17Client(harness, 'client-a1');
  const clientA2 = await openPhase17Client(harness, 'client-a2');
  const clientA2Deltas: RelayServerToClientFrame[] = [];
  clientA2.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as RelayServerToClientFrame;
    if (frame.type === 'agent.delta') clientA2Deltas.push(frame);
  });
  try {
    const sessionId = 'tth_phase17_unsubscribe';
    await subscribePhase17Chat(harness, clientA1, sessionId);
    await subscribePhase17Chat(harness, clientA2, sessionId);
    clientA2.send(JSON.stringify({ type: 'client.unsubscribe', sessionId }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    gateway.send(JSON.stringify({
      type: 'gateway.event',
      gatewayId: 'gateway-a',
      event: { id: 1706, type: 'agent.delta', sessionId, payload: { text: 'after-unsub' } }
    }));
    await waitForJson(clientA1, (message) => message.type === 'agent.delta');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(clientA2Deltas.length, 0);
  } finally {
    gateway.close();
    clientA1.close();
    clientA2.close();
    await harness.close();
  }
});

test('Phase17-T7: other-account client cannot send permission_response to A session gateway', async () => {
  const harness = await createPhase17RelayHarness();
  const gatewayB = await openPhase17Gateway(harness, 'b');
  const gatewayA = await openPhase17Gateway(harness, 'a');
  const clientB = await openPhase17Client(harness, 'client-b');
  const clientA = await openPhase17Client(harness, 'client-a1');
  const gatewayAFrames: Record<string, unknown>[] = [];
  gatewayA.on('message', (raw) => gatewayAFrames.push(JSON.parse(raw.toString()) as Record<string, unknown>));
  try {
    await subscribePhase17Chat(harness, clientA, 'tth_phase17_perm_a', 'a');
    await subscribePhase17Chat(harness, clientB, 'tth_phase17_perm_b', 'b');
    clientB.send(JSON.stringify({
      type: 'client.permission_response',
      sessionId: 'tth_phase17_perm_a',
      requestId: 'req-a',
      decision: 'allow'
    }));
    const error = await waitForJson(clientB, (message) => message.type === 'error' && message.code === 'forbidden');
    assert.equal(error.sessionId, 'tth_phase17_perm_a');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(gatewayAFrames.some((frame) => frame.type === 'client.permission_response'), false);
  } finally {
    gatewayB.close();
    gatewayA.close();
    clientB.close();
    clientA.close();
    await harness.close();
  }
});
