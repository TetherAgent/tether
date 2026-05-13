import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { providerEffectiveEnv, providerLaunchCommand, providerShellFunction } from '../src/utils/provider-env.js';

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

test('provider env is captured from real zsh rc environment', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-zdotdir-'));
  const previousZdotdir = process.env.ZDOTDIR;
  const previousPath = process.env.PATH;
  writeFileSync(
    path.join(dir, '.zshrc'),
    'export PATH="/tmp/tether path with spaces:$PATH"\nexport http_proxy="http://127.0.0.1:7897"\n',
    'utf8'
  );
  process.env.ZDOTDIR = dir;

  try {
    const env = providerEffectiveEnv('claude');
    assert(env.PATH?.startsWith('/tmp/tether path with spaces:'));
    assert.equal(env.http_proxy, 'http://127.0.0.1:7897');
  } finally {
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider launch uses zsh function when same-name provider function exists and direct command is unavailable', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-zdotdir-'));
  const previousZdotdir = process.env.ZDOTDIR;
  writeFileSync(
    path.join(dir, '.zshrc'),
    'claude() {\n  http_proxy="http://127.0.0.1:7897" command claude "$@"\n}\n',
    'utf8'
  );
  process.env.ZDOTDIR = dir;

  try {
    assert.equal(providerShellFunction('claude'), 'claude');
    const launch = providerLaunchCommand('claude', 'definitely-not-a-real-claude-command', ['-p', 'hello world'], {
      PATH: '/usr/bin:/bin'
    });
    assert.equal(launch.mode, 'zsh-function');
    assert.equal(launch.command, 'zsh');
    assert.deepEqual(launch.args, ['-lic', 'claude "$@"', 'claude', '-p', 'hello world']);
  } finally {
    if (previousZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = previousZdotdir;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
