import assert from 'node:assert/strict';
import test from 'node:test';
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
