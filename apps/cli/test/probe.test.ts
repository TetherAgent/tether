import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { fetchFirstGatewayStatus, fetchGatewayStatusBody } from '../src/gateway/probe.js';

// Helper: start a local HTTP test server that handles all requests with the given handler.
async function startTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Helper: respond with JSON
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

// --- fetchGatewayStatusBody ---

test('fetchGatewayStatusBody: refused connection (non-existent port) returns undefined', async () => {
  // Use port 1 — binding is refused on any normal system without root
  const result = await fetchGatewayStatusBody('http://127.0.0.1:1');
  assert.equal(result, undefined);
});

test('fetchGatewayStatusBody: HTTP 500 response returns undefined', async () => {
  const { url, close } = await startTestServer((_req, res) => {
    res.writeHead(500).end();
  });
  try {
    const result = await fetchGatewayStatusBody(url);
    assert.equal(result, undefined);
  } finally {
    await close();
  }
});

test('fetchGatewayStatusBody: response body has ok=false returns undefined', async () => {
  const { url, close } = await startTestServer((_req, res) => {
    jsonResponse(res, 200, { ok: false, version: '1.0' });
  });
  try {
    const result = await fetchGatewayStatusBody(url);
    assert.equal(result, undefined);
  } finally {
    await close();
  }
});

test('fetchGatewayStatusBody: response body has ok=true returns GatewayStatus object', async () => {
  const body = { ok: true as const, version: '1.2.3', relay: { state: 'connected' } };
  const { url, close } = await startTestServer((_req, res) => {
    jsonResponse(res, 200, body);
  });
  try {
    const result = await fetchGatewayStatusBody(url);
    assert.ok(result);
    assert.equal(result.ok, true);
    assert.equal(result.version, '1.2.3');
  } finally {
    await close();
  }
});

test('fetchGatewayStatusBody: non-JSON response body returns undefined', async () => {
  const { url, close } = await startTestServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('not json');
  });
  try {
    const result = await fetchGatewayStatusBody(url);
    // JSON parse fails → catch → undefined
    assert.equal(result, undefined);
  } finally {
    await close();
  }
});

// --- fetchFirstGatewayStatus ---

test('fetchFirstGatewayStatus: first successful URL returns status, subsequent URLs not requested', async () => {
  const hits: string[] = [];
  const goodBody = { ok: true as const, version: '1.0.0' };

  const { url: url1, close: close1 } = await startTestServer((req, res) => {
    hits.push('server1:' + req.url);
    jsonResponse(res, 200, goodBody);
  });
  const { url: url2, close: close2 } = await startTestServer((req, res) => {
    hits.push('server2:' + req.url);
    jsonResponse(res, 200, goodBody);
  });

  try {
    const result = await fetchFirstGatewayStatus([url1, url2]);
    assert.ok(result);
    assert.equal(result.ok, true);
    // Only the first server should have been hit
    assert.equal(hits.filter((h) => h.startsWith('server1')).length, 1);
    assert.equal(hits.filter((h) => h.startsWith('server2')).length, 0);
  } finally {
    await close1();
    await close2();
  }
});

test('fetchFirstGatewayStatus: duplicate URLs are only requested once', async () => {
  let hitCount = 0;
  const goodBody = { ok: true as const, version: '1.0.0' };
  const { url, close } = await startTestServer((_req, res) => {
    hitCount++;
    jsonResponse(res, 200, goodBody);
  });
  try {
    const result = await fetchFirstGatewayStatus([url, url, url]);
    assert.ok(result);
    assert.equal(hitCount, 1);
  } finally {
    await close();
  }
});

test('fetchFirstGatewayStatus: all URLs fail returns undefined', async () => {
  // Use refused connections
  const result = await fetchFirstGatewayStatus([
    'http://127.0.0.1:1',
    'http://127.0.0.1:2',
  ]);
  assert.equal(result, undefined);
});

test('fetchFirstGatewayStatus: empty array returns undefined', async () => {
  const result = await fetchFirstGatewayStatus([]);
  assert.equal(result, undefined);
});

test('fetchFirstGatewayStatus: skips failing URLs and returns first success', async () => {
  const goodBody = { ok: true as const, version: '2.0.0' };
  const { url: goodUrl, close } = await startTestServer((_req, res) => {
    jsonResponse(res, 200, goodBody);
  });
  try {
    const result = await fetchFirstGatewayStatus(['http://127.0.0.1:1', goodUrl]);
    assert.ok(result);
    assert.equal(result.version, '2.0.0');
  } finally {
    await close();
  }
});
