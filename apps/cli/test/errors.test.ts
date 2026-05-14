import assert from 'node:assert/strict';
import test from 'node:test';
import { isNodeError } from '../src/utils/errors.js';

test('isNodeError: Error with code property returns true', () => {
  const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  assert.equal(isNodeError(err), true);
});

test('isNodeError: Error with numeric code property returns true', () => {
  // code can be any value; the check is only `'code' in error`
  const err = Object.assign(new Error('some error'), { code: 42 });
  assert.equal(isNodeError(err), true);
});

test('isNodeError: plain Error without code returns false', () => {
  assert.equal(isNodeError(new Error('plain')), false);
});

test('isNodeError: string returns false', () => {
  assert.equal(isNodeError('ENOENT'), false);
});

test('isNodeError: null returns false', () => {
  assert.equal(isNodeError(null), false);
});

test('isNodeError: number returns false', () => {
  assert.equal(isNodeError(404), false);
});

test('isNodeError: plain object (not Error) returns false', () => {
  assert.equal(isNodeError({ code: 'ENOENT', message: 'not an error' }), false);
});

test('isNodeError: undefined returns false', () => {
  assert.equal(isNodeError(undefined), false);
});
