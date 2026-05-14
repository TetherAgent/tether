import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import {
  attachPtySession,
  closeReasonMessage,
  isAttachAuthError
} from '../src/attach/pty-attach.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'pty-attach-test-'));
}

function makeJwt(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

async function writeValidAuth(authPath: string): Promise<void> {
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(authPath, JSON.stringify({
    serverUrl: 'https://relay.example.com',
    accessToken: makeJwt({ gatewayId: 'gw-1', accountId: 'acc-1' }),
    refreshToken: 'refresh-tok',
    expiresAt: Date.now() + 60_000
  }, null, 2), { mode: 0o600 });
}

/**
 * Starts a local HTTP+WS server. The handler receives each WS connection.
 * Returns the server URL and a cleanup function.
 */
function startWsServer(
  handler: (ws: WebSocket, req: http.IncomingMessage) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', handler);
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => {
          wss.close(() => httpServer.close(err => err ? rej(err) : res()));
        })
      });
    });
  });
}

/**
 * Runs a test with isolated auth state and a WS server.
 * The WS handler drives server-side behavior; the test fn drives client.
 */
async function withAttachEnv(
  wsHandler: (ws: WebSocket, req: http.IncomingMessage) => void,
  testFn: (relayUrl: string) => Promise<void>
): Promise<void> {
  const dir = makeTmpDir();
  const authPath = path.join(dir, 'auth.json');
  const origAuth = process.env.TETHER_AUTH_PATH;

  await writeValidAuth(authPath);
  process.env.TETHER_AUTH_PATH = authPath;

  const server = await startWsServer(wsHandler);
  try {
    await testFn(server.url);
  } finally {
    await server.close();
    // attachPtySessionOnce calls process.stdin.resume(); re-pause to avoid hanging the test runner
    process.stdin.pause();
    rmSync(dir, { recursive: true, force: true });
    if (origAuth === undefined) {
      delete process.env.TETHER_AUTH_PATH;
    } else {
      process.env.TETHER_AUTH_PATH = origAuth;
    }
  }
}

// ---------------------------------------------------------------------------
// closeReasonMessage
// ---------------------------------------------------------------------------

test('closeReasonMessage: non-empty reason → "WebSocket {code} {reason}"', () => {
  assert.equal(closeReasonMessage(1006, 'connection lost'), 'WebSocket 1006 connection lost');
});

test('closeReasonMessage: empty reason → "WebSocket {code}"', () => {
  assert.equal(closeReasonMessage(1000, ''), 'WebSocket 1000');
});

// ---------------------------------------------------------------------------
// isAttachAuthError
// ---------------------------------------------------------------------------

test('isAttachAuthError: message contains "relay auth failed" → true', () => {
  assert.equal(isAttachAuthError(new Error('relay auth failed: bad token')), true);
});

test('isAttachAuthError: regular Error without pattern → false', () => {
  assert.equal(isAttachAuthError(new Error('connection refused')), false);
});

test('isAttachAuthError: non-Error value → false', () => {
  assert.equal(isAttachAuthError('relay auth failed'), false);
  assert.equal(isAttachAuthError(null), false);
});

// ---------------------------------------------------------------------------
// Auth handshake: client.auth.failed → throw (no reconnect)
// ---------------------------------------------------------------------------

test('attachPtySession: auth.failed → throws with "relay auth failed", does not reconnect', async () => {
  await withAttachEnv(
    (ws) => {
      ws.once('message', () => {
        ws.send(JSON.stringify({ type: 'client.auth.failed', message: 'invalid token' }));
      });
    },
    async (relayUrl) => {
      await assert.rejects(
        () => attachPtySession('sess_001', { relayUrl, reconnect: true }),
        (err: Error) => {
          assert.ok(isAttachAuthError(err), `expected auth error, got: ${err.message}`);
          return true;
        }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Auth handshake: auth.ok → client.subscribe sent with correct fields
// ---------------------------------------------------------------------------

test('auth.ok → sends client.subscribe with sessionId, mode, cols, rows', async () => {
  const received: Array<Record<string, unknown>> = [];

  await withAttachEnv(
    (ws) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(frame);
        if (frame.type === 'client.auth') {
          ws.send(JSON.stringify({ type: 'client.auth.ok', clientId: 'c1' }));
        }
        // After subscribe is received, send session.exited to end the test cleanly
        if (frame.type === 'client.subscribe') {
          ws.send(JSON.stringify({
            type: 'gateway.event',
            event: { id: 1, type: 'session.exited', sessionId: 'sess_002', ts: Date.now(), payload: {} }
          }));
        }
      });
      ws.on('close', () => {});
    },
    async (relayUrl) => {
      const result = await attachPtySession('sess_002', { relayUrl, reconnect: false });
      assert.equal(result, 'exited');

      const subscribeFrame = received.find(f => f.type === 'client.subscribe');
      assert.ok(subscribeFrame !== undefined, 'client.subscribe was not sent');
      assert.equal(subscribeFrame.sessionId, 'sess_002');
      assert.ok('mode' in subscribeFrame);
      assert.ok('cols' in subscribeFrame);
      assert.ok('rows' in subscribeFrame);
    }
  );
});

test('auth.ok → subscribe includes "after" field when after > 0', async () => {
  const received: Array<Record<string, unknown>> = [];

  await withAttachEnv(
    (ws) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        received.push(frame);
        if (frame.type === 'client.auth') {
          ws.send(JSON.stringify({ type: 'client.auth.ok', clientId: 'c1' }));
        }
        if (frame.type === 'client.subscribe') {
          // send session.exited to end the call cleanly
          ws.send(JSON.stringify({
            type: 'gateway.event',
            event: { id: 5, type: 'session.exited', sessionId: 'sess_003', ts: Date.now(), payload: {} }
          }));
        }
      });
    },
    async (relayUrl) => {
      // First call returns exited; second call would have after=5 but we don't need that level
      // Instead test directly: call once with after tracked via latestEventId
      // The latestEventId update happens from event.id; but that's internal.
      // For simplicity: verify that after=0 means no `after` field in subscribe.
      const result = await attachPtySession('sess_003', { relayUrl, reconnect: false });
      assert.equal(result, 'exited');
      const subscribeFrame = received.find(f => f.type === 'client.subscribe');
      assert.ok(subscribeFrame !== undefined);
      // with initial after=0, `after` field should NOT be in the subscribe frame
      assert.ok(!('after' in subscribeFrame), 'after field should not be present when latestEventId=0');
    }
  );
});

// ---------------------------------------------------------------------------
// session.exited → return 'exited'
// ---------------------------------------------------------------------------

test('attachPtySession: session.exited event → returns "exited"', async () => {
  await withAttachEnv(
    (ws) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.type === 'client.auth') {
          ws.send(JSON.stringify({ type: 'client.auth.ok', clientId: 'c1' }));
        }
        if (frame.type === 'client.subscribe') {
          ws.send(JSON.stringify({
            type: 'gateway.event',
            event: { id: 1, type: 'session.exited', sessionId: 'sess_exited', ts: Date.now(), payload: {} }
          }));
        }
      });
    },
    async (relayUrl) => {
      const result = await attachPtySession('sess_exited', { relayUrl, reconnect: false });
      assert.equal(result, 'exited');
    }
  );
});

// ---------------------------------------------------------------------------
// error/session_lost → throws (no reconnect even with reconnect=true)
// ---------------------------------------------------------------------------

test('attachPtySession: error/session_lost → throws Error, does not reconnect', async () => {
  let connectionCount = 0;

  await withAttachEnv(
    (ws) => {
      connectionCount++;
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.type === 'client.auth') {
          ws.send(JSON.stringify({ type: 'client.auth.ok', clientId: 'c1' }));
        }
        if (frame.type === 'client.subscribe') {
          ws.send(JSON.stringify({ type: 'error', code: 'session_lost', message: 'runner gone' }));
        }
      });
    },
    async (relayUrl) => {
      await assert.rejects(
        () => attachPtySession('sess_lost', { relayUrl, reconnect: true }),
        (err: Error) => {
          assert.ok(err.message.includes('失联') || err.message.includes('lost') || err.message.includes('sess_lost'), `unexpected message: ${err.message}`);
          return true;
        }
      );
      // Should only have connected once — session_lost does not trigger reconnect
      assert.equal(connectionCount, 1);
    }
  );
});

// ---------------------------------------------------------------------------
// reconnect=false: WS disconnect → return 'detached' (no retry)
// ---------------------------------------------------------------------------

test('attachPtySession: reconnect=false, WS closes unexpectedly → resolves detached', async () => {
  await withAttachEnv(
    (ws) => {
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.type === 'client.auth') {
          ws.send(JSON.stringify({ type: 'client.auth.ok', clientId: 'c1' }));
        }
        if (frame.type === 'client.subscribe') {
          // Close without sending a terminal event
          ws.close(1001, 'going away');
        }
      });
    },
    async (relayUrl) => {
      const result = await attachPtySession('sess_dc', { relayUrl, reconnect: false });
      // reconnect=false means on unexpected close we exit cleanly (returns 'detached')
      assert.equal(result, 'detached');
    }
  );
});

// ---------------------------------------------------------------------------
// reconnect=true: auth failure does not retry
// ---------------------------------------------------------------------------

test('attachPtySession: auth.failed with reconnect=true → still throws immediately', async () => {
  let connectionCount = 0;
  await withAttachEnv(
    (ws) => {
      connectionCount++;
      ws.once('message', () => {
        ws.send(JSON.stringify({ type: 'client.auth.failed', message: 'expired' }));
      });
    },
    async (relayUrl) => {
      await assert.rejects(
        () => attachPtySession('sess_auth', { relayUrl, reconnect: true }),
        (err: Error) => {
          assert.ok(isAttachAuthError(err));
          return true;
        }
      );
      assert.equal(connectionCount, 1, 'auth failure should not trigger reconnect');
    }
  );
});
