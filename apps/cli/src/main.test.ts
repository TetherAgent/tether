import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { PROVIDERS } from '@tether/core';
import { buildCreateSessionPayload } from './forwarding.js';

test('does not include command-shaped fields in forwarded create payload', () => {
  const payload = buildCreateSessionPayload(
    PROVIDERS.codex,
    { project: '.', providerArgs: ['--resume', '99acd804-8250-43db-9503-884c1e7ca450'] },
    { columns: 100, rows: 30 }
  );

  assert.deepEqual(Object.keys(payload).sort(), ['cols', 'projectPath', 'provider', 'providerArgs', 'rows']);
  for (const key of ['command', 'args', 'argv', 'env', 'shell', 'providerCommand']) {
    assert.equal(Object.hasOwn(payload, key), false);
  }
  assert.equal(payload.provider, 'codex');
  assert.deepEqual(payload.providerArgs, ['--resume', '99acd804-8250-43db-9503-884c1e7ca450']);
  assert.equal(payload.cols, 100);
  assert.equal(payload.rows, 30);
});

test('gateway login wiring is present in main.ts', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(source, /gateway'\)\s*[\s\S]*command\('login'\)/);
  assert.match(source, /TETHER_SERVER_URL/);
  assert.match(source, /auth\.json/);
  assert.match(source, /0o600/);
});

test('gateway login defaults to prod and keeps local as an explicit environment', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(source, /\.option\('--env <env>'/);
  assert.match(source, /process\.env\.TETHER_SERVER_URL/);
  assert.match(source, /options\.env === 'local' \? LOCAL_SERVER_URL : DEFAULT_SERVER_URL/);
  assert.match(source, /performGatewayLogin\(\{\}\)/);
});

test('foreground gateway checks port before prompting for auth', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(source, /assertGatewayPortAvailable\(resolved\.gateway\.host, resolved\.gateway\.port\);[\s\S]*ensureGatewayAuthForProfile/);
  assert.match(source, /EADDRINUSE/);
  assert.match(source, /pnpm tether gateway stop/);
});

test('gateway delete-db requires confirmation and removes sqlite sidecar files', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
  assert.match(source, /command\('delete-db'\)/);
  assert.match(source, /\.option\('--yes'/);
  assert.match(source, /删除数据库会清空 session 历史和回放数据/);
  assert.match(source, /\`\$\{dbPath\}-wal\`/);
  assert.match(source, /\`\$\{dbPath\}-shm\`/);
  assert.match(source, /Gateway 仍在运行/);
});
