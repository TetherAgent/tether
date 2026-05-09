import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { startDaemon } from './daemon.js';
import { createSessionId } from './ids.js';
import { PtySessionManager } from './pty.js';
import { Store, type SessionEvent } from './store.js';

const TOKEN_GATEWAY = 'gateway-test-token';
const TOKEN_NORMAL = 'normal-test-token';
const TOKEN_NORMAL_OTHER = 'normal-test-token-other';
const TOKEN_MANAGEMENT = 'management-test-token';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-daemon-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

async function withAuthFixture<T>(run: (fixture: {
  authHeaders: (token?: string) => Record<string, string>;
}) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/api/token/validate') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const body = await readRequestBody(req);
    const token = typeof body?.token === 'string' ? body.token : '';
    if (token === TOKEN_GATEWAY) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        code: 200,
        msg: 'success',
        data: {
          accountId: 'acct_test',
          workspaceId: 'ws_test',
          gatewayId: 'gw_test',
          userId: 'user_test',
          deviceId: 'device_test',
          tokenClass: 'gateway_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_gateway'
        }
      }));
      return;
    }
    if (token === TOKEN_NORMAL) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        code: 200,
        msg: 'success',
        data: {
          accountId: 'acct_test',
          workspaceId: 'ws_test',
          userId: 'user_test',
          deviceId: 'device_test',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_normal'
        }
      }));
      return;
    }
    if (token === TOKEN_NORMAL_OTHER) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        code: 200,
        msg: 'success',
        data: {
          accountId: 'acct_test',
          workspaceId: 'ws_test',
          userId: 'user_other',
          deviceId: 'device_other',
          tokenClass: 'normal_client_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_normal_other'
        }
      }));
      return;
    }
    if (token === TOKEN_MANAGEMENT) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        code: 200,
        msg: 'success',
        data: {
          accountId: 'acct_test',
          workspaceId: 'ws_test',
          adminUserId: 'admin_test',
          tokenClass: 'management_access',
          expiresAt: Date.now() + 60_000,
          jti: 'jti_management'
        }
      }));
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 401, msg: 'invalid_token', data: null }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('auth fixture failed to bind');
  }
  const previousAuthPath = process.env.TETHER_AUTH_PATH;
  process.env.TETHER_AUTH_PATH = authPath;
  writeFileSync(authPath, `${JSON.stringify({
    serverUrl: `http://127.0.0.1:${address.port}`,
    gatewayId: 'gw_test',
    accountId: 'acct_test',
    workspaceId: 'ws_test',
    accessToken: TOKEN_GATEWAY,
    refreshToken: 'refresh_test_secret',
    expiresAt: Date.now() + 60_000
  }, null, 2)}\n`, 'utf8');
  try {
    return await run({
      authHeaders: (token = TOKEN_GATEWAY) => ({ authorization: `Bearer ${token}` })
    });
  } finally {
    process.env.TETHER_AUTH_PATH = previousAuthPath;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

test('status reports gateway runtime details', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const port = 5500 + Math.floor(Math.random() * 1000);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4898, store, ptySessions, allowApiSessionCreate: true });

  try {
    const response = await fetch('http://127.0.0.1:4898/api/status');
    assert.equal(response.ok, true);
    const body = (await response.json()) as {
      ok?: unknown;
      pid?: unknown;
      url?: unknown;
      host?: unknown;
      port?: unknown;
      allowApiSessionCreate?: unknown;
      relay?: { configured?: unknown };
      liveSessionIds?: unknown[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.pid, process.pid);
    assert.equal(body.url, 'http://127.0.0.1:4898');
    assert.equal(body.host, '127.0.0.1');
    assert.equal(body.port, 4898);
    assert.equal(body.allowApiSessionCreate, true);
    assert.deepEqual(body.relay, { configured: false });
    assert.deepEqual(body.liveSessionIds, [sessionId]);
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('session creation is disabled by default', async () => {
  const { store, cleanup } = tempStore();
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4899, store, ptySessions: new PtySessionManager(store) });

  try {
    const response = await fetch('http://127.0.0.1:4899/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'codex' })
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'session creation is disabled' });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('session creation rejects command-shaped payloads', async () => {
  const { store, cleanup } = tempStore();
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4900,
    store,
    ptySessions: new PtySessionManager(store),
    allowApiSessionCreate: true
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4900/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          provider: 'codex',
          projectPath: process.cwd(),
          cols: 120,
          rows: 40,
          nested: { env: { SECRET: 'blocked' } }
        })
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'command-shaped session creation is not allowed' });
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('session creation rejects missing token', async () => {
  const { store, cleanup } = tempStore();
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4909,
    store,
    ptySessions: new PtySessionManager(store),
    allowApiSessionCreate: true
  });

  try {
    const response = await fetch('http://127.0.0.1:4909/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', projectPath: process.cwd(), cols: 120, rows: 40 })
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'missing_token' });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('direct read endpoints require auth and enforce session ownership', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const port = 5500 + Math.floor(Math.random() * 1000);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: {
      accountId: 'acct_test',
      workspaceId: 'ws_test',
      userId: 'user_test',
      deviceId: 'device_test'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const baseUrl = `http://127.0.0.1:${port}`;
      const missing = await fetch(`${baseUrl}/api/sessions`);
      assert.equal(missing.status, 401);
      assert.deepEqual(await missing.json(), { error: 'missing_token' });

      const list = await fetch(`${baseUrl}/api/sessions`, {
        headers: authHeaders(TOKEN_NORMAL)
      });
      assert.equal(list.status, 200);
      const listBody = (await list.json()) as { sessions?: Array<{ id: string }> };
      assert.deepEqual(listBody.sessions?.map((session) => session.id), [sessionId]);

      const forbidden = await fetch(`${baseUrl}/api/sessions/${sessionId}/events`, {
        headers: authHeaders(TOKEN_NORMAL_OTHER)
      });
      assert.equal(forbidden.status, 403);
      assert.deepEqual(await forbidden.json(), { error: 'forbidden_owner' });

      const events = await fetch(`${baseUrl}/api/sessions/${sessionId}/events`, {
        headers: authHeaders(TOKEN_NORMAL)
      });
      assert.equal(events.status, 200);
      assert.equal(Array.isArray(((await events.json()) as { events?: unknown[] }).events), true);
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('session creation rejects management token', async () => {
  const { store, cleanup } = tempStore();
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4910,
    store,
    ptySessions: new PtySessionManager(store),
    allowApiSessionCreate: true
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4910/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(TOKEN_MANAGEMENT) },
        body: JSON.stringify({ provider: 'codex', projectPath: process.cwd(), cols: 120, rows: 40 })
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'wrong_token_class' });
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('session creation accepts whitelisted provider when enabled', async () => {
  const { store, cleanup } = tempStore();
  const binDir = mkdtempSync(path.join(tmpdir(), 'tether-daemon-bin-'));
  const originalPath = process.env.PATH;
  const fakeCodex = path.join(binDir, 'codex');
  writeFileSync(fakeCodex, '#!/bin/sh\nsleep 2\n', 'utf8');
  chmodSync(fakeCodex, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;
  const ptySessions = new PtySessionManager(store);
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4901, store, ptySessions, allowApiSessionCreate: true, config: {} });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4901/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: 'codex', projectPath: binDir, cols: 100, rows: 30 })
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { session?: { id?: string; provider?: string; command?: string; projectPath?: string } };
      assert.equal(body.session?.provider, 'codex');
      assert.equal(body.session?.command, 'codex');
      assert.equal(body.session?.projectPath, path.resolve(binDir));
      const createdId = body.session?.id;
      assert.equal(typeof createdId, 'string');
      if (!createdId) {
        throw new Error('created session id missing');
      }
      assert.equal(typeof store.getSession(createdId)?.runnerSocketPath, 'string');
      await fetch(`http://127.0.0.1:4901/api/sessions/${encodeURIComponent(createdId)}/stop`, {
        method: 'POST',
        headers: authHeaders()
      });
    });
  } finally {
    process.env.PATH = originalPath;
    await daemon.close();
    cleanup();
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('session creation forwards provider arguments to whitelisted provider', async () => {
  const { store, cleanup } = tempStore();
  const binDir = mkdtempSync(path.join(tmpdir(), 'tether-daemon-provider-args-'));
  const fakeCodex = path.join(binDir, 'codex-custom');
  writeFileSync(fakeCodex, '#!/bin/sh\nsleep 2\n', 'utf8');
  chmodSync(fakeCodex, 0o755);
  const ptySessions = new PtySessionManager(store);
  const port = 5500 + Math.floor(Math.random() * 1000);
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port,
    store,
    ptySessions,
    allowApiSessionCreate: true,
    config: { providers: { codex: { command: fakeCodex } } }
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          provider: 'codex',
          projectPath: binDir,
          cols: 100,
          rows: 30,
          providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']
        })
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { session?: { id?: string } };
      const createdId = body.session?.id;
      assert.equal(typeof createdId, 'string');
      if (!createdId) {
        throw new Error('created session id missing');
      }
      const startedEvent = store.listEvents(createdId).find((event) => event.type === 'session.started');
      assert.deepEqual(startedEvent?.payload.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
      await fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(createdId)}/stop`, {
        method: 'POST',
        headers: authHeaders()
      });
    });
  } finally {
    await daemon.close();
    cleanup();
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('session creation rejects invalid provider arguments', async () => {
  const { store, cleanup } = tempStore();
  const port = 5500 + Math.floor(Math.random() * 1000);
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port,
    store,
    ptySessions: new PtySessionManager(store),
    allowApiSessionCreate: true
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          provider: 'codex',
          projectPath: process.cwd(),
          cols: 100,
          rows: 30,
          providerArgs: ['--resume', 123]
        })
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'providerArgs must be a string array' });
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('session creation uses configured provider command path', async () => {
  const { store, cleanup } = tempStore();
  const binDir = mkdtempSync(path.join(tmpdir(), 'tether-daemon-provider-bin-'));
  const fakeCodex = path.join(binDir, 'codex-custom');
  writeFileSync(fakeCodex, '#!/bin/sh\nsleep 2\n', 'utf8');
  chmodSync(fakeCodex, 0o755);
  const ptySessions = new PtySessionManager(store);
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4908,
    store,
    ptySessions,
    allowApiSessionCreate: true,
    config: { providers: { codex: { command: fakeCodex } } }
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4908/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: 'codex', projectPath: binDir, cols: 100, rows: 30 })
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { session?: { id?: string; command?: string } };
      assert.equal(body.session?.command, fakeCodex);
      const createdId = body.session?.id;
      assert.equal(typeof createdId, 'string');
      if (createdId) {
        await fetch(`http://127.0.0.1:4908/api/sessions/${encodeURIComponent(createdId)}/stop`, {
          method: 'POST',
          headers: authHeaders()
        });
      }
    });
  } finally {
    await daemon.close();
    cleanup();
    rmSync(binDir, { recursive: true, force: true });
  }
});

test('session creation accepts display name as session title', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4909,
    store,
    ptySessions,
    allowApiSessionCreate: true,
    config: { providers: { codex: { command: '/bin/cat' } } }
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4909/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: 'codex', projectPath: process.cwd(), title: '登录问题', cols: 100, rows: 30 })
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { session?: { id?: string; title?: string } };
      assert.equal(body.session?.title, '登录问题');
      const createdId = body.session?.id;
      assert.equal(typeof createdId, 'string');
      if (createdId) {
        await fetch(`http://127.0.0.1:4909/api/sessions/${encodeURIComponent(createdId)}/stop`, {
          method: 'POST',
          headers: authHeaders()
        });
      }
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('session creation rejects invalid display name', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const daemon = await startDaemon({
    host: '127.0.0.1',
    port: 4910,
    store,
    ptySessions,
    allowApiSessionCreate: true
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch('http://127.0.0.1:4910/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: 'codex', projectPath: process.cwd(), title: 'bad\nname', cols: 100, rows: 30 })
      });
      assert.equal(response.status, 400);
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

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

test('daemon restart keeps runner-backed session controllable', async () => {
  const { store, cleanup } = tempStore();
  const port = 5500 + Math.floor(Math.random() * 1000);
  let daemon = await startDaemon({
    host: '127.0.0.1',
    port,
    store,
    allowApiSessionCreate: true,
    config: { providers: { codex: { command: '/bin/cat' } } }
  });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const createResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ provider: 'codex', projectPath: process.cwd(), cols: 80, rows: 24 })
      });
      assert.equal(createResponse.status, 201);
      const createBody = (await createResponse.json()) as { session?: { id?: string; runnerSocketPath?: string } };
      const sessionId = createBody.session?.id;
      assert.equal(typeof sessionId, 'string');
      assert.equal(typeof createBody.session?.runnerSocketPath, 'string');
      if (!sessionId) {
        throw new Error('created session id missing');
      }

      await daemon.close();
      daemon = await startDaemon({
        host: '127.0.0.1',
        port,
        store,
        allowApiSessionCreate: true,
        config: { providers: { codex: { command: '/bin/cat' } } }
      });

      const sessionsResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: authHeaders()
      });
      assert.equal(sessionsResponse.status, 200);
      const sessionsBody = (await sessionsResponse.json()) as { sessions?: Array<{ id?: string; status?: string }> };
      assert.deepEqual(sessionsBody.sessions?.map((session) => [session.id, session.status]), [[sessionId, 'running']]);

      const inputResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data: 'after restart\r' })
      });
      assert.equal(inputResponse.status, 200);
      await waitFor(() => store.transcript(sessionId).includes('after restart'), 1000);

      const stopResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
        method: 'POST',
        headers: authHeaders()
      });
      assert.equal(stopResponse.status, 200);
    });
  } finally {
    await daemon.close();
    cleanup();
  }
});

test('stop marks unavailable pty session lost instead of failing hard', async () => {
  const { store, cleanup } = tempStore();
  const now = Date.now();
  const sessionId = 'tth_stop_lost_test';
  store.insertSession({
    id: sessionId,
    provider: 'codex',
    title: 'lost',
    projectPath: process.cwd(),
    accountId: 'acct_test',
    workspaceId: 'ws_test',
    userId: 'user_test',
    deviceId: 'device_test',
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

  const daemon = await startDaemon({ host: '127.0.0.1', port: 4898, store, ptySessions: new PtySessionManager(store) });
  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:4898/api/sessions/${sessionId}/stop`, {
        method: 'POST',
        headers: authHeaders(TOKEN_NORMAL)
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok?: unknown; status?: unknown; error?: unknown };
      assert.equal(body.ok, true);
      assert.equal(body.status, 'lost');
      assert.equal(body.error, 'session_lost');
      assert.equal(store.getSession(sessionId)?.status, 'lost');
    });
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
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4892, sessionId, 'observe', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4892/api/sessions/${sessionId}/stream?mode=observe&surface=test`, [`tether-ticket.${ticket}`]);
      const message = await waitForMessage(ws, (text) => text.includes('replay.done'));
      assert.match(message, /replay\.done/);
      ws.send(JSON.stringify({ type: 'input', data: 'blocked\r' }));
      const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
      assert.match(error, /observe_only/);
      assert.equal(store.listEvents(sessionId).some((event) => event.type === 'user.input' && event.payload.data === 'blocked\r'), false);
      ws.close();
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('observe websocket clients cannot resize pty', async () => {
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
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4895, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4895, sessionId, 'observe', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4895/api/sessions/${sessionId}/stream?mode=observe&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
      assert.match(error, /observe_only/);
      assert.equal(store.listEvents(sessionId).some((event) => event.type === 'terminal.resize' && event.payload.cols === 100), false);
      ws.close();
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('direct websocket controller can resize pty', async () => {
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
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4896, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4896, sessionId, 'control', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4896/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      await waitFor(
        () => store.listEvents(sessionId).some((event) => event.type === 'terminal.resize' && event.payload.cols === 100),
        1000
      );
      ws.close();
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('direct websocket chat emits user turn, agent.typing and conversation API returns turns', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: {
      accountId: 'acct_test',
      workspaceId: 'ws_test',
      userId: 'user_test',
      deviceId: 'device_test'
    }
  });
  const port = 5500 + Math.floor(Math.random() * 1000);
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(port, sessionId, 'control', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      const ptyOutput = waitForMessage(ws, (text) => text.includes('hello direct chat'));
      const subscriberEvent = new Promise<SessionEvent>((resolve) => {
        const unsubscribe = ptySessions.subscribe(sessionId, (event) => {
          if (event.type === 'agent.turn' && event.payload.content === 'hello direct chat') {
            unsubscribe();
            resolve(event);
          }
        });
      });
      ws.send(JSON.stringify({ type: 'chat', message: 'hello direct chat' }));
      const userTurn = await waitForMessage(ws, (text) => text.includes('"agent.turn"') && text.includes('"hello direct chat"'));
      assert.match(userTurn, /"agent\.turn"/);
      const event = await waitForMessage(ws, (text) => text.includes('"agent.typing"'));
      assert.match(event, /"agent\.typing"/);
      assert.equal((await subscriberEvent).type, 'agent.turn');
      await ptyOutput;
      await waitFor(() => store.listAgentTurns(sessionId).some((turn) => turn.role === 'user' && turn.content === 'hello direct chat'), 1000);

      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/conversation`, {
        headers: authHeaders()
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { turns?: Array<{ role?: string; content?: string }> };
      assert.equal(body.turns?.some((turn) => turn.role === 'user' && turn.content === 'hello direct chat'), true);
      ws.close();
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('http resize endpoint can resize pty before websocket replay', async () => {
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
  const port = 5400 + Math.floor(Math.random() * 1000);
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ cols: 132, rows: 40 })
      });
      assert.equal(response.status, 200);
      await waitFor(
        () => store.listEvents(sessionId).some((event) => event.type === 'terminal.resize' && event.payload.cols === 132 && event.payload.rows === 40),
        1000
      );
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('http resize endpoint rejects invalid dimensions', async () => {
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
  const port = 5400 + Math.floor(Math.random() * 1000);
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ cols: 0, rows: 40 })
      });
      assert.equal(response.status, 400);
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('ws ticket rejects same-account token for a different owner session', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const port = 5400 + Math.floor(Math.random() * 1000);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: {
      accountId: 'acct_test',
      workspaceId: 'ws_test',
      userId: 'user_test',
      deviceId: 'device_test'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(TOKEN_NORMAL_OTHER) },
        body: JSON.stringify({ sessionId, mode: 'observe' })
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'forbidden_owner' });
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('ws ticket rejects sessions owned by a different gateway', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const port = 5400 + Math.floor(Math.random() * 1000);
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    owner: {
      accountId: 'acct_test',
      workspaceId: 'ws_test',
      userId: 'user_test',
      deviceId: 'device_test',
      gatewayId: 'gw_other'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(TOKEN_NORMAL) },
        body: JSON.stringify({ sessionId, mode: 'observe' })
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'forbidden_gateway' });
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('direct websocket rejects invalid resize dimensions', async () => {
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
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4897, store, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4897, sessionId, 'control', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4897/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 0 }));
      const error = await waitForMessage(ws, (text) => text.includes('bad_resize'));
      assert.match(error, /bad_resize/);
      assert.equal(store.listEvents(sessionId).some((event) => event.type === 'terminal.resize' && event.payload.cols === 0), false);
      ws.close();
    });
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
    await withAuthFixture(async ({ authHeaders }) => {
      const firstTicket = await requestTicket(4894, sessionId, 'control', authHeaders());
      const first = new WebSocket(`ws://127.0.0.1:4894/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${firstTicket}`]);
      await waitForMessage(first, (text) => text.includes('replay.done'));

      const secondTicket = await requestTicket(4894, sessionId, 'control', authHeaders());
      const second = new WebSocket(`ws://127.0.0.1:4894/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${secondTicket}`]);
      await waitForMessage(second, (text) => text.includes('replay.done'));

      first.send(JSON.stringify({ type: 'input', data: 'stale controller\r' }));
      const error = await waitForMessage(first, (text) => text.includes('not_controller'));
      assert.match(error, /not_controller/);
      assert.equal(store.listEvents(sessionId).some((event) => event.type === 'user.input' && event.payload.data === 'stale controller\r'), false);

      first.close();
      second.close();
    });
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
    const response = await withAuthFixture(async ({ authHeaders }) => fetch(`http://127.0.0.1:4893/api/sessions/${sessionId}/stop`, {
      method: 'POST',
      headers: authHeaders()
    }));
    assert.equal(response.ok, true);
    await waitFor(() => store.getSession(sessionId)?.status !== 'running', 1000);
    assert.equal(ptySessions.hasLiveSession(sessionId), false);
  } finally {
    await daemon.close();
    cleanup();
  }
});

async function requestTicket(
  port: number,
  sessionId: string,
  mode: 'control' | 'observe',
  headers: Record<string, string>
): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ sessionId, mode })
  });
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
