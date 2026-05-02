import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { PROVIDERS } from '@tether/core';
import { buildCreateSessionPayload } from './forwarding.js';

test('does not include command-shaped fields in forwarded create payload', () => {
  const payload = buildCreateSessionPayload(
    PROVIDERS.codex,
    { project: '.' },
    { columns: 100, rows: 30 }
  );

  assert.deepEqual(Object.keys(payload).sort(), ['cols', 'projectPath', 'provider', 'rows']);
  for (const key of ['command', 'args', 'argv', 'env', 'shell', 'providerCommand']) {
    assert.equal(Object.hasOwn(payload, key), false);
  }
  assert.equal(payload.provider, 'codex');
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
