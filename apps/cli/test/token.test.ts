import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTokenPayload } from '../src/auth/token.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

test('decodeTokenPayload: valid 3-part JWT returns decoded payload object', () => {
  const payload = { sub: 'user-123', gatewayId: 'gw-abc', exp: 9999999999 };
  const result = decodeTokenPayload(makeJwt(payload));
  assert.deepEqual(result, payload);
});

test('decodeTokenPayload: fewer than 3 parts returns undefined', () => {
  assert.equal(decodeTokenPayload('only.twoparts'), undefined);
});

test('decodeTokenPayload: more than 3 parts returns undefined', () => {
  assert.equal(decodeTokenPayload('a.b.c.d'), undefined);
});

test('decodeTokenPayload: two parts (no signature) returns undefined', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
  assert.equal(decodeTokenPayload(`${header}.${body}`), undefined);
});

test('decodeTokenPayload: payload that is not valid JSON returns undefined', () => {
  const badPayload = Buffer.from('not-json!!!').toString('base64url');
  assert.equal(decodeTokenPayload(`header.${badPayload}.sig`), undefined);
});

test('decodeTokenPayload: empty string returns undefined', () => {
  assert.equal(decodeTokenPayload(''), undefined);
});
