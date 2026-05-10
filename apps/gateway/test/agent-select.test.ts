import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSelectOptions } from '../src/agent-select-detect.js';

test('detects two consecutive numbered lines', () => {
  assert.deepEqual(detectSelectOptions(['1. Option A', '2. Option B']), [
    { index: 1, label: 'Option A' },
    { index: 2, label: 'Option B' }
  ]);
});

test('detects three consecutive numbered lines', () => {
  assert.deepEqual(detectSelectOptions(['1. Alpha', '2. Beta', '3. Gamma']), [
    { index: 1, label: 'Alpha' },
    { index: 2, label: 'Beta' },
    { index: 3, label: 'Gamma' }
  ]);
});

test('returns null for a single numbered line', () => {
  assert.equal(detectSelectOptions(['1. Only one']), null);
});

test('returns null when sequence is broken by non-numbered line', () => {
  assert.equal(detectSelectOptions(['1. First', 'some text', '2. Second']), null);
});

test('matches lines with leading whitespace', () => {
  assert.deepEqual(detectSelectOptions(['  1. Indented A', '  2. Indented B']), [
    { index: 1, label: 'Indented A' },
    { index: 2, label: 'Indented B' }
  ]);
});

test('returns null for empty input', () => {
  assert.equal(detectSelectOptions([]), null);
});
