import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

import {
  parseGatewayAuthState,
  decodeGatewayToken,
  loadGatewayAuthState,
  refreshGatewayAuthState,
  type GatewayAuthState
} from '../src/utils/gateway-auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return mkdtempSync(path.join(tmpdir(), 'gw-auth-test-'));
}

function makeValidState(overrides: Partial<GatewayAuthState> = {}): GatewayAuthState {
  return {
    serverUrl: 'http://localhost:0',
    accessToken: makeJwt({ expiresAt: Date.now() + 60 * 60 * 1000 }),
    refreshToken: 'refresh_tok',
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides
  };
}

/** Encodes a minimal JWT with the given payload (no signature verification needed). */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

// ---------------------------------------------------------------------------
// parseGatewayAuthState
// ---------------------------------------------------------------------------

test('parseGatewayAuthState: valid JSON returns state', () => {
  const state: GatewayAuthState = {
    serverUrl: 'https://relay.example.com',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: 9999999999999
  };
  const result = parseGatewayAuthState(JSON.stringify(state));
  assert.deepEqual(result, state);
});

test('parseGatewayAuthState: invalid JSON returns undefined', () => {
  assert.equal(parseGatewayAuthState('not json'), undefined);
});

test('parseGatewayAuthState: missing required field returns undefined', () => {
  const partial = { serverUrl: 'https://x.com', accessToken: 'tok', refreshToken: 'ref' };
  assert.equal(parseGatewayAuthState(JSON.stringify(partial)), undefined);
});

test('parseGatewayAuthState: wrong field type returns undefined', () => {
  const bad = { serverUrl: 'https://x.com', accessToken: 'tok', refreshToken: 'ref', expiresAt: 'not-a-number' };
  assert.equal(parseGatewayAuthState(JSON.stringify(bad)), undefined);
});

// ---------------------------------------------------------------------------
// decodeGatewayToken
// ---------------------------------------------------------------------------

test('decodeGatewayToken: valid JWT returns payload', () => {
  const payload = { expiresAt: 123456, sub: 'gw_1' };
  const token = makeJwt(payload);
  const result = decodeGatewayToken(token);
  assert.deepEqual(result, payload);
});

test('decodeGatewayToken: not three parts returns undefined', () => {
  assert.equal(decodeGatewayToken('only.two'), undefined);
  assert.equal(decodeGatewayToken('a.b.c.d'), undefined);
});

test('decodeGatewayToken: invalid base64url payload returns undefined', () => {
  assert.equal(decodeGatewayToken('header.!!!notbase64.sig'), undefined);
});

// ---------------------------------------------------------------------------
// loadGatewayAuthState
// ---------------------------------------------------------------------------

test('loadGatewayAuthState: file does not exist returns 401', async () => {
  const dir = makeTmpDir();
  try {
    process.env.TETHER_AUTH_PATH = path.join(dir, 'missing.json');
    const result = await loadGatewayAuthState();
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGatewayAuthState: invalid JSON returns 500', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  try {
    writeFileSync(authPath, 'not json', { mode: 0o600 });
    process.env.TETHER_AUTH_PATH = authPath;
    const result = await loadGatewayAuthState();
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 500);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGatewayAuthState: valid token with plenty of time returns ok', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  try {
    const state = makeValidState({ expiresAt: Date.now() + 30 * 60 * 1000 });
    writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
    process.env.TETHER_AUTH_PATH = authPath;
    const result = await loadGatewayAuthState();
    assert.equal(result.ok, true);
    assert.equal((result as { value: GatewayAuthState }).value.accessToken, state.accessToken);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGatewayAuthState: token < 5min triggers refresh and returns refreshed state', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  const newExpiry = Date.now() + 2 * 60 * 60 * 1000;
  const newAccess = makeJwt({ expiresAt: newExpiry });

  const server = await startHttpServer(async (req, res) => {
    const body = await collectBody(req);
    const parsed = JSON.parse(body) as { refreshToken: string };
    assert.equal(parsed.refreshToken, 'old_refresh');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accessToken: newAccess, refreshToken: 'new_refresh' }));
  });

  try {
    const state = makeValidState({
      serverUrl: server.url,
      accessToken: makeJwt({ expiresAt: Date.now() + 2 * 60 * 1000 }),
      expiresAt: Date.now() + 2 * 60 * 1000,
      refreshToken: 'old_refresh'
    });
    writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
    process.env.TETHER_AUTH_PATH = authPath;

    const result = await loadGatewayAuthState();
    assert.equal(result.ok, true);
    assert.equal((result as { value: GatewayAuthState }).value.accessToken, newAccess);
    assert.equal((result as { value: GatewayAuthState }).value.refreshToken, 'new_refresh');
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGatewayAuthState: refresh fails but token still valid returns ok with original state', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');

  const server = await startHttpServer((_req, res) => {
    res.writeHead(500);
    res.end();
  });

  try {
    // expiresAt is in < 5min window, but still in the future
    const soonExpiry = Date.now() + 2 * 60 * 1000;
    const state = makeValidState({
      serverUrl: server.url,
      accessToken: makeJwt({ expiresAt: soonExpiry }),
      expiresAt: soonExpiry,
      refreshToken: 'tok'
    });
    writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
    process.env.TETHER_AUTH_PATH = authPath;

    const result = await loadGatewayAuthState();
    assert.equal(result.ok, true);
    assert.equal((result as { value: GatewayAuthState }).value.accessToken, state.accessToken);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadGatewayAuthState: refresh fails and token expired returns 401', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');

  const server = await startHttpServer((_req, res) => {
    res.writeHead(500);
    res.end();
  });

  try {
    const expired = Date.now() - 1000;
    const state = makeValidState({
      serverUrl: server.url,
      accessToken: makeJwt({ expiresAt: expired }),
      expiresAt: expired,
      refreshToken: 'tok'
    });
    writeFileSync(authPath, JSON.stringify(state), { mode: 0o600 });
    process.env.TETHER_AUTH_PATH = authPath;

    const result = await loadGatewayAuthState();
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// refreshGatewayAuthState
// ---------------------------------------------------------------------------

test('refreshGatewayAuthState: network error throws (fetch propagates)', async () => {
  // refreshGatewayAuthState does not catch network errors internally — callers
  // are expected to wrap with .catch(). Verify the function rejects on failure.
  const state = makeValidState({ serverUrl: 'http://127.0.0.1:1' });
  await assert.rejects(() => refreshGatewayAuthState(state));
});

test('refreshGatewayAuthState: response missing accessToken returns undefined', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');

  const server = await startHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ refreshToken: 'r' }));
  });

  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const state = makeValidState({ serverUrl: server.url });
    const result = await refreshGatewayAuthState(state);
    assert.equal(result, undefined);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshGatewayAuthState: success writes file and returns new state', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  const newExpiry = Date.now() + 3_600_000;
  const newAccess = makeJwt({ expiresAt: newExpiry });

  const server = await startHttpServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accessToken: newAccess, refreshToken: 'new_ref' }));
  });

  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const state = makeValidState({ serverUrl: server.url });
    const result = await refreshGatewayAuthState(state);
    assert.ok(result !== undefined);
    assert.equal(result!.accessToken, newAccess);
    assert.equal(result!.refreshToken, 'new_ref');
    assert.equal(result!.expiresAt, newExpiry);

    const written = JSON.parse(await readFile(authPath, 'utf8')) as GatewayAuthState;
    assert.equal(written.accessToken, newAccess);
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refreshGatewayAuthState: server response wrapped in code/data envelope', async () => {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  const newExpiry = Date.now() + 3_600_000;
  const newAccess = makeJwt({ expiresAt: newExpiry });

  const server = await startHttpServer(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 200, data: { accessToken: newAccess, refreshToken: 'wrapped_ref' } }));
  });

  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const state = makeValidState({ serverUrl: server.url });
    const result = await refreshGatewayAuthState(state);
    assert.ok(result !== undefined);
    assert.equal(result!.accessToken, newAccess);
    assert.equal(result!.refreshToken, 'wrapped_ref');
  } finally {
    delete process.env.TETHER_AUTH_PATH;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
