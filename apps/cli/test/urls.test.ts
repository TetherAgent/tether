import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayApiUrl } from '../src/gateway/urls.js';

test('gatewayApiUrl: 0.0.0.0 is replaced with 127.0.0.1', () => {
  assert.equal(gatewayApiUrl('0.0.0.0', 3000), 'http://127.0.0.1:3000');
});

test('gatewayApiUrl: 127.0.0.1 is kept as-is', () => {
  assert.equal(gatewayApiUrl('127.0.0.1', 8080), 'http://127.0.0.1:8080');
});

test('gatewayApiUrl: localhost is kept as-is', () => {
  assert.equal(gatewayApiUrl('localhost', 4000), 'http://localhost:4000');
});

test('gatewayApiUrl: port is correctly appended with no trailing slash', () => {
  const url = gatewayApiUrl('127.0.0.1', 9999);
  assert.equal(url, 'http://127.0.0.1:9999');
  assert.equal(url.endsWith('/'), false);
});

test('gatewayApiUrl: arbitrary host is kept as-is', () => {
  assert.equal(gatewayApiUrl('192.168.1.100', 5000), 'http://192.168.1.100:5000');
});
