import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import type { RelaySession } from '@tether/protocol';
import { startRelayServer } from './relay.js';

const SECRET = 'test-relay-secret';

test('relay rejects unauthenticated sockets', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4901, secret: SECRET });
  const client = new WebSocket('ws://127.0.0.1:4901/client');

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

test('relay forwards session list from gateway to client', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4902, secret: SECRET });
  const gateway = new WebSocket('ws://127.0.0.1:4902/gateway');
  const client = new WebSocket('ws://127.0.0.1:4902/client');
  const sessions: RelaySession[] = [
    {
      id: 'tth_relay_test',
      provider: 'codex',
      title: 'Relay Test',
      projectPath: process.cwd(),
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

test('relay forwards subscribed input and resize to gateway', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4903, secret: SECRET });
  const gateway = new WebSocket('ws://127.0.0.1:4903/gateway');
  const client = new WebSocket('ws://127.0.0.1:4903/client');

  try {
    await authenticateGateway(gateway);
    const clientId = await authenticateClient(client);

    client.send(JSON.stringify({ type: 'client.subscribe', sessionId: 'tth_input_test', after: 7, mode: 'control' }));
    const subscribe = await waitForJson(gateway, (message) => message.type === 'client.subscribe');
    assert.deepEqual(subscribe, {
      type: 'client.subscribe',
      clientId,
      sessionId: 'tth_input_test',
      after: 7,
      mode: 'control'
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
  } finally {
    gateway.close();
    client.close();
    await relay.close();
  }
});

test('relay rejects unsubscribed input and resize', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4905, secret: SECRET });
  const gateway = new WebSocket('ws://127.0.0.1:4905/gateway');
  const client = new WebSocket('ws://127.0.0.1:4905/client');

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

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

test('relay rejects observe input and resize', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4906, secret: SECRET });
  const gateway = new WebSocket('ws://127.0.0.1:4906/gateway');
  const client = new WebSocket('ws://127.0.0.1:4906/client');

  try {
    await authenticateGateway(gateway);
    await authenticateClient(client);

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

test('relay rejects command-shaped frames', async () => {
  const relay = await startRelayServer({ host: '127.0.0.1', port: 4904, secret: SECRET });
  const gateway = new WebSocket('ws://127.0.0.1:4904/gateway');
  const client = new WebSocket('ws://127.0.0.1:4904/client');

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

async function authenticateGateway(ws: WebSocket): Promise<void> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'gateway.auth', gatewayId: 'gateway-test', secret: SECRET }));
  await waitForJson(ws, (message) => message.type === 'gateway.auth.ok');
}

async function authenticateClient(ws: WebSocket): Promise<string> {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ type: 'client.auth', secret: SECRET }));
  const auth = await waitForJson(ws, (message) => message.type === 'client.auth.ok');
  assert.equal(typeof auth.clientId, 'string');
  return auth.clientId as string;
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
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket message')), 1000);
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (predicate(message)) {
        clearTimeout(timer);
        resolve(message);
      }
    });
    ws.on('error', reject);
  });
}

async function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket close')), 1000);
    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.once('error', reject);
  });
}
