import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { providerEffectiveEnv } from '../src/provider-env.js';

test('CLAUDE_ENV_FILE is only loaded for Claude provider env', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-provider-env-'));
  const envFile = path.join(dir, 'provider.env');
  const previousEnvFile = process.env.CLAUDE_ENV_FILE;
  const previousSentinel = process.env.TETHER_PROVIDER_ENV_TEST_SENTINEL;
  writeFileSync(envFile, 'TETHER_PROVIDER_ENV_TEST_SENTINEL=from-env-file\n', 'utf8');
  process.env.CLAUDE_ENV_FILE = envFile;
  delete process.env.TETHER_PROVIDER_ENV_TEST_SENTINEL;

  try {
    assert.equal(providerEffectiveEnv('codex').TETHER_PROVIDER_ENV_TEST_SENTINEL, undefined);
    assert.equal(providerEffectiveEnv('claude').TETHER_PROVIDER_ENV_TEST_SENTINEL, 'from-env-file');
  } finally {
    if (previousEnvFile === undefined) {
      delete process.env.CLAUDE_ENV_FILE;
    } else {
      process.env.CLAUDE_ENV_FILE = previousEnvFile;
    }
    if (previousSentinel === undefined) {
      delete process.env.TETHER_PROVIDER_ENV_TEST_SENTINEL;
    } else {
      process.env.TETHER_PROVIDER_ENV_TEST_SENTINEL = previousSentinel;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
