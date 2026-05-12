import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { startDaemon } from '../src/daemon.js';
import { createSessionId } from '../src/ids.js';
import { PtySessionManager } from '../src/pty.js';
import { tempSessionState, type TestSessionState } from './helpers/test-session-state.js';

const TOKEN_GATEWAY = 'gateway-test-token';
const TOKEN_NORMAL = 'normal-test-token';
const TOKEN_NORMAL_OTHER = 'normal-test-token-other';
const TOKEN_MANAGEMENT = 'management-test-token';

function tempStore(): { store: TestSessionState; cleanup: () => void } {
  return tempSessionState();
}

async function withAuthFixture<T>(run: (fixture: {
  authHeaders: (token?: string) => Record<string, string>;
}) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-auth-'));
  const authPath = path.join(dir, 'auth.json');
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/api/server/token/validate') {
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
  const ptySessions = new PtySessionManager();
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
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4898, ptySessions });

  try {
    const response = await fetch('http://127.0.0.1:4898/api/status');
    assert.equal(response.ok, true);
    const body = (await response.json()) as {
      ok?: unknown;
      pid?: unknown;
      url?: unknown;
      host?: unknown;
      port?: unknown;
      relay?: { configured?: unknown };
      liveSessionIds?: unknown[];
    };
    assert.equal(body.ok, true);
    assert.equal(body.pid, process.pid);
    assert.equal(body.url, 'http://127.0.0.1:4898');
    assert.equal(body.host, '127.0.0.1');
    assert.equal(body.port, 4898);
    assert.deepEqual(body.relay, { configured: false });
    assert.deepEqual(body.liveSessionIds, [sessionId]);
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('direct read endpoints require auth and enforce session ownership', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager();
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
      userId: 'user_test',
      deviceId: 'device_test'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, ptySessions });

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

    });
  } finally {
    ptySessions.stop(sessionId);
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

  const ptySessions = store.ptySessions;
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4891, ptySessions });
  try {
    assert.equal(store.getSession('tth_lost_test')?.status, 'lost');
    assert.equal(store.listEvents('tth_lost_test').some((event) => event.type === 'session.error'), true);
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

  const ptySessions = store.ptySessions;
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4898, ptySessions });
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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4892, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4892, sessionId, 'observe', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4892/api/sessions/${sessionId}/stream?mode=observe&surface=test`, [`tether-ticket.${ticket}`]);
      const message = await waitForMessage(ws, (text) => text.includes('replay.done'));
      assert.match(message, /replay\.done/);
      ws.send(JSON.stringify({ type: 'input', data: 'blocked\r' }));
      const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
      assert.match(error, /observe_only/);
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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4895, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4895, sessionId, 'observe', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4895/api/sessions/${sessionId}/stream?mode=observe&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      const error = await waitForMessage(ws, (text) => text.includes('observe_only'));
      assert.match(error, /observe_only/);
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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4896, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4896, sessionId, 'control', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4896/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      const resizeEvent = waitForMessage(ws, (text) => text.includes('terminal.resize') && text.includes('"cols":100') && text.includes('"rows":30'));
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      await resizeEvent;
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
  const ptySessions = new PtySessionManager();
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
  const daemon = await startDaemon({ host: '127.0.0.1', port, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/resize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ cols: 132, rows: 40 })
      });
      assert.equal(response.status, 200);
    });
  } finally {
    ptySessions.stop(sessionId);
    await daemon.close();
    cleanup();
  }
});

test('http resize endpoint rejects invalid dimensions', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager();
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
  const daemon = await startDaemon({ host: '127.0.0.1', port, ptySessions });

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
  const ptySessions = new PtySessionManager();
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
      userId: 'user_test',
      deviceId: 'device_test'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, ptySessions });

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
  const ptySessions = new PtySessionManager();
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
      userId: 'user_test',
      deviceId: 'device_test',
      gatewayId: 'gw_other'
    }
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port, ptySessions });

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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4897, ptySessions });

  try {
    await withAuthFixture(async ({ authHeaders }) => {
      const ticket = await requestTicket(4897, sessionId, 'control', authHeaders());
      const ws = new WebSocket(`ws://127.0.0.1:4897/api/sessions/${sessionId}/stream?mode=control&surface=test`, [`tether-ticket.${ticket}`]);
      await waitForMessage(ws, (text) => text.includes('replay.done'));
      ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 0 }));
      const error = await waitForMessage(ws, (text) => text.includes('bad_resize'));
      assert.match(error, /bad_resize/);
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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4894, ptySessions });

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
  const ptySessions = new PtySessionManager();
  const sessionId = createSessionId();
  ptySessions.create({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4893, ptySessions });

  try {
    const response = await withAuthFixture(async ({ authHeaders }) => fetch(`http://127.0.0.1:4893/api/sessions/${sessionId}/stop`, {
      method: 'POST',
      headers: authHeaders()
    }));
    assert.equal(response.ok, true);
    await waitFor(() => ptySessions.hasLiveSession(sessionId) === false, 1000);
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
