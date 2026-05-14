import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionId } from '../src/utils/ids.js';

const ID_PATTERN = /^tth_\d{8}_[0-9a-f]{8}$/;

test('createSessionId matches tth_YYYYMMDD_xxxxxxxx format', () => {
  const id = createSessionId();
  assert.match(id, ID_PATTERN);
});

test('createSessionId encodes the supplied date', () => {
  const date = new Date('2024-03-15T00:00:00Z');
  const id = createSessionId(date);
  assert.ok(id.startsWith('tth_20240315_'), `unexpected prefix in: ${id}`);
});

test('createSessionId uses current date by default', () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const id = createSessionId();
  assert.ok(id.startsWith(`tth_${yyyy}${mm}${dd}_`));
});

test('createSessionId suffix is 8 lowercase hex characters', () => {
  const id = createSessionId();
  const suffix = id.split('_')[2]!;
  assert.match(suffix, /^[0-9a-f]{8}$/);
});

test('1000 calls produce unique ids', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    ids.add(createSessionId());
  }
  assert.equal(ids.size, 1000);
});
