import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { startDaemon } from '../src/daemon.js';
import { createSessionId } from '../src/utils/ids.js';
import { PtySessionManager } from '../src/pty/manager.js';
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
