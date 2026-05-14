import assert from 'node:assert/strict';
import test from 'node:test';
import { maskSensitiveOutput } from '../src/utils/mask.js';

const REDACTED = '[REDACTED]';

test('masks sk- API key with sufficient length', () => {
  const result = maskSensitiveOutput('key is sk-abcdefghijklmnopqrstu end');
  assert.ok(result.includes(REDACTED), `expected REDACTED in: ${result}`);
  assert.ok(!result.includes('sk-abcdefghijklmnopqrstu'));
});

test('does not mask sk- string shorter than 20 chars after prefix', () => {
  // 19 chars after sk- should not match (pattern requires 20+)
  const short = 'sk-' + 'a'.repeat(19);
  const result = maskSensitiveOutput(short);
  assert.equal(result, short);
});

test('masks token: "value" assignment', () => {
  const result = maskSensitiveOutput('token: "supersecretvalue"');
  assert.ok(result.includes(REDACTED));
  assert.ok(!result.includes('supersecretvalue'));
});

test('masks token= assignment without quotes', () => {
  const result = maskSensitiveOutput('token=mysecret end');
  assert.ok(result.includes(REDACTED));
  assert.ok(!result.includes('mysecret'));
});

test('masks secret: value', () => {
  const result = maskSensitiveOutput("secret: 'hunter2'");
  assert.ok(result.includes(REDACTED));
});

test('masks password= value', () => {
  const result = maskSensitiveOutput('password=p@ssw0rd');
  assert.ok(result.includes(REDACTED));
});

test('masks api_key= value', () => {
  const result = maskSensitiveOutput("api_key='abc123xyz'");
  assert.ok(result.includes(REDACTED));
});

test('masks apikey: value (no separator)', () => {
  const result = maskSensitiveOutput('apikey: somevalue');
  assert.ok(result.includes(REDACTED));
});

test('masks ghp_ GitHub token with sufficient length', () => {
  const token = 'ghp_' + 'A'.repeat(20);
  const result = maskSensitiveOutput(`token is ${token} done`);
  assert.ok(result.includes(REDACTED));
  assert.ok(!result.includes(token));
});

test('does not mask ghp_ shorter than 20 chars after prefix', () => {
  const short = 'ghp_' + 'a'.repeat(19);
  const result = maskSensitiveOutput(short);
  assert.equal(result, short);
});

test('does not alter plain text without sensitive patterns', () => {
  const plain = 'Hello world, this is normal output.';
  assert.equal(maskSensitiveOutput(plain), plain);
});

test('does not alter empty string', () => {
  assert.equal(maskSensitiveOutput(''), '');
});

test('masks multiple patterns in a single string', () => {
  const input = `sk-${'x'.repeat(20)} and token="abc123" in one string`;
  const result = maskSensitiveOutput(input);
  const count = (result.match(/\[REDACTED\]/g) ?? []).length;
  assert.ok(count >= 2, `expected at least 2 redactions, got ${count} in: ${result}`);
});
