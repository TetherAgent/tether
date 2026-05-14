import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  gatewayAuthPath,
  gatewayAuthSummary,
  readFreshGatewayAuthState,
  readGatewayAuthState,
  writeGatewayAuthState,
  type GatewayAuthState,
} from '../src/auth/gateway-auth-store.js';

// Helper: build a base64url-encoded JWT with the given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

// Helper: write a valid auth.json to the given path
async function writeValidAuth(authPath: string, overrides: Partial<GatewayAuthState> = {}): Promise<GatewayAuthState> {
  const state: GatewayAuthState = {
    serverUrl: 'https://tether.example.com',
    accessToken: makeJwt({ gatewayId: 'gw-1', accountId: 'acc-1' }),
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  return state;
}

// --- gatewayAuthPath ---

test('gatewayAuthPath: respects TETHER_AUTH_PATH env var', () => {
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = '/tmp/custom-auth.json';
    assert.equal(gatewayAuthPath(), '/tmp/custom-auth.json');
  } finally {
    if (original === undefined) {
      delete process.env.TETHER_AUTH_PATH;
    } else {
      process.env.TETHER_AUTH_PATH = original;
    }
  }
});

test('gatewayAuthPath: without env var returns default path under home', () => {
  const original = process.env.TETHER_AUTH_PATH;
  try {
    delete process.env.TETHER_AUTH_PATH;
    const result = gatewayAuthPath();
    assert.equal(result, path.join(os.homedir(), '.tether', 'auth.json'));
  } finally {
    if (original !== undefined) {
      process.env.TETHER_AUTH_PATH = original;
    }
  }
});

// --- readGatewayAuthState ---

test('readGatewayAuthState: missing file throws with message about auth.json', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = path.join(tmpDir, 'auth.json');
    await assert.rejects(
      () => readGatewayAuthState(),
      (err: Error) => {
        assert.match(err.message, /auth\.json/);
        return true;
      }
    );
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readGatewayAuthState: invalid JSON throws (SyntaxError — no try/catch in source)', async () => {
  // The source does not wrap JSON.parse in try/catch, so a malformed file throws SyntaxError directly.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    writeFileSync(authPath, 'not valid json!!!');
    await assert.rejects(() => readGatewayAuthState());
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readGatewayAuthState: wrong field type throws with "格式无效"', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    // expiresAt should be number but is a string
    const bad = { serverUrl: 'https://x.com', accessToken: 'tok', refreshToken: 'ref', expiresAt: 'not-a-number' };
    writeFileSync(authPath, JSON.stringify(bad));
    await assert.rejects(
      () => readGatewayAuthState(),
      (err: Error) => {
        assert.match(err.message, /格式无效/);
        return true;
      }
    );
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readGatewayAuthState: valid file returns GatewayAuthState', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const written = await writeValidAuth(authPath);
    const result = await readGatewayAuthState();
    assert.equal(result.serverUrl, written.serverUrl);
    assert.equal(result.accessToken, written.accessToken);
    assert.equal(result.refreshToken, written.refreshToken);
    assert.equal(result.expiresAt, written.expiresAt);
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- readFreshGatewayAuthState ---

test('readFreshGatewayAuthState: expired token throws with "已过期"', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    await writeValidAuth(authPath, { expiresAt: Date.now() - 1000 });
    await assert.rejects(
      () => readFreshGatewayAuthState(),
      (err: Error) => {
        assert.match(err.message, /已过期/);
        return true;
      }
    );
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readFreshGatewayAuthState: valid non-expired token returns state', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const written = await writeValidAuth(authPath, { expiresAt: Date.now() + 60_000 });
    const result = await readFreshGatewayAuthState();
    assert.equal(result.serverUrl, written.serverUrl);
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- writeGatewayAuthState ---

test('writeGatewayAuthState: creates directory and file with mode 0o600', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  // Use a nested path that does not yet exist
  const authPath = path.join(tmpDir, 'nested', 'dir', 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const state: GatewayAuthState = {
      serverUrl: 'https://tether.example.com',
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: Date.now() + 60_000,
    };
    await writeGatewayAuthState(state);
    const stat = statSync(authPath);
    // On macOS/Linux, check the lower 9 permission bits equal 0o600
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('writeGatewayAuthState: written file can be read back correctly', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const state: GatewayAuthState = {
      serverUrl: 'https://tether.example.com',
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: Date.now() + 60_000,
    };
    await writeGatewayAuthState(state);
    const result = await readGatewayAuthState();
    assert.equal(result.serverUrl, state.serverUrl);
    assert.equal(result.expiresAt, state.expiresAt);
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- gatewayAuthSummary ---

test('gatewayAuthSummary: missing file returns { state: "未登录" }', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = path.join(tmpDir, 'auth.json');
    const result = await gatewayAuthSummary();
    assert.deepEqual(result, { state: '未登录' });
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gatewayAuthSummary: invalid JSON returns { state: "auth.json 无效" }', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    writeFileSync(authPath, 'this is not json');
    const result = await gatewayAuthSummary();
    assert.deepEqual(result, { state: 'auth.json 无效' });
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gatewayAuthSummary: wrong field types returns { state: "auth.json 无效" }', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    writeFileSync(authPath, JSON.stringify({ serverUrl: 123, accessToken: true }));
    const result = await gatewayAuthSummary();
    assert.deepEqual(result, { state: 'auth.json 无效' });
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gatewayAuthSummary: expired token returns state="已过期" with gatewayId and accountId', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const expiresAt = Date.now() - 1000;
    const accessToken = makeJwt({ gatewayId: 'gw-expired', accountId: 'acc-expired' });
    await writeValidAuth(authPath, { expiresAt, accessToken });
    const result = await gatewayAuthSummary();
    assert.equal(result.state, '已过期');
    assert.equal(result.gatewayId, 'gw-expired');
    assert.equal(result.accountId, 'acc-expired');
    assert.equal(result.expiresAt, expiresAt);
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gatewayAuthSummary: valid non-expired token returns state="已登录" with expiresAt', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const original = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    const expiresAt = Date.now() + 60_000;
    const accessToken = makeJwt({ gatewayId: 'gw-ok', accountId: 'acc-ok' });
    await writeValidAuth(authPath, { expiresAt, accessToken });
    const result = await gatewayAuthSummary();
    assert.equal(result.state, '已登录');
    assert.equal(result.expiresAt, expiresAt);
    assert.equal(result.gatewayId, 'gw-ok');
    assert.equal(result.accountId, 'acc-ok');
  } finally {
    if (original === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = original;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
