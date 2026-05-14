import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureGatewayAuthForProfile, gatewayProfileFromEnv } from '../src/gateway/supervisor.js';

// Helper: build a base64url-encoded JWT
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

// Helper: write a valid auth.json at the given path
async function writeValidAuth(authPath: string, expiresAt: number): Promise<void> {
  await mkdir(path.dirname(authPath), { recursive: true });
  const state = {
    serverUrl: 'https://tether.example.com',
    accessToken: makeJwt({ gatewayId: 'gw-1', accountId: 'acc-1' }),
    refreshToken: 'fake-refresh',
    expiresAt,
  };
  writeFileSync(authPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

// Each test manages TETHER_AUTH_PATH and a temp directory, restoring in finally.

// --- ensureGatewayAuthForProfile ---

test('ensureGatewayAuthForProfile: local profile passes even when auth file is missing', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const originalAuth = process.env.TETHER_AUTH_PATH;
  try {
    // Point to a non-existent file
    process.env.TETHER_AUTH_PATH = path.join(tmpDir, 'auth.json');
    // Must not throw
    await ensureGatewayAuthForProfile('local');
  } finally {
    if (originalAuth === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = originalAuth;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureGatewayAuthForProfile: relay profile without auth file throws with "tether login"', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const originalAuth = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = path.join(tmpDir, 'auth.json');
    await assert.rejects(
      () => ensureGatewayAuthForProfile('relay'),
      (err: Error) => {
        assert.match(err.message, /tether login/);
        return true;
      }
    );
  } finally {
    if (originalAuth === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = originalAuth;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureGatewayAuthForProfile: relay profile with valid (non-expired) auth passes', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const originalAuth = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    await writeValidAuth(authPath, Date.now() + 60_000);
    // Must not throw
    await ensureGatewayAuthForProfile('relay');
  } finally {
    if (originalAuth === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = originalAuth;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureGatewayAuthForProfile: relay profile with expired auth throws', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const authPath = path.join(tmpDir, 'auth.json');
  const originalAuth = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = authPath;
    await writeValidAuth(authPath, Date.now() - 1000);
    await assert.rejects(() => ensureGatewayAuthForProfile('relay'));
  } finally {
    if (originalAuth === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = originalAuth;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ensureGatewayAuthForProfile: direct profile without auth file throws with "Direct"', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'tether-test-'));
  const originalAuth = process.env.TETHER_AUTH_PATH;
  try {
    process.env.TETHER_AUTH_PATH = path.join(tmpDir, 'auth.json');
    await assert.rejects(
      () => ensureGatewayAuthForProfile('direct'),
      (err: Error) => {
        assert.match(err.message, /Direct/);
        return true;
      }
    );
  } finally {
    if (originalAuth === undefined) delete process.env.TETHER_AUTH_PATH;
    else process.env.TETHER_AUTH_PATH = originalAuth;
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- gatewayProfileFromEnv ---

test('gatewayProfileFromEnv: unset env returns undefined', () => {
  const original = process.env.TETHER_GATEWAY_PROFILE;
  try {
    delete process.env.TETHER_GATEWAY_PROFILE;
    assert.equal(gatewayProfileFromEnv(), undefined);
  } finally {
    if (original === undefined) delete process.env.TETHER_GATEWAY_PROFILE;
    else process.env.TETHER_GATEWAY_PROFILE = original;
  }
});

test('gatewayProfileFromEnv: "relay" returns "relay"', () => {
  const original = process.env.TETHER_GATEWAY_PROFILE;
  try {
    process.env.TETHER_GATEWAY_PROFILE = 'relay';
    assert.equal(gatewayProfileFromEnv(), 'relay');
  } finally {
    if (original === undefined) delete process.env.TETHER_GATEWAY_PROFILE;
    else process.env.TETHER_GATEWAY_PROFILE = original;
  }
});

test('gatewayProfileFromEnv: "direct" returns "direct"', () => {
  const original = process.env.TETHER_GATEWAY_PROFILE;
  try {
    process.env.TETHER_GATEWAY_PROFILE = 'direct';
    assert.equal(gatewayProfileFromEnv(), 'direct');
  } finally {
    if (original === undefined) delete process.env.TETHER_GATEWAY_PROFILE;
    else process.env.TETHER_GATEWAY_PROFILE = original;
  }
});

test('gatewayProfileFromEnv: "local" returns "local"', () => {
  const original = process.env.TETHER_GATEWAY_PROFILE;
  try {
    process.env.TETHER_GATEWAY_PROFILE = 'local';
    assert.equal(gatewayProfileFromEnv(), 'local');
  } finally {
    if (original === undefined) delete process.env.TETHER_GATEWAY_PROFILE;
    else process.env.TETHER_GATEWAY_PROFILE = original;
  }
});

test('gatewayProfileFromEnv: unknown value throws Error', () => {
  const original = process.env.TETHER_GATEWAY_PROFILE;
  try {
    process.env.TETHER_GATEWAY_PROFILE = 'invalid-profile';
    assert.throws(
      () => gatewayProfileFromEnv(),
      (err: Error) => {
        assert.match(err.message, /未知.*Gateway/);
        return true;
      }
    );
  } finally {
    if (original === undefined) delete process.env.TETHER_GATEWAY_PROFILE;
    else process.env.TETHER_GATEWAY_PROFILE = original;
  }
});
