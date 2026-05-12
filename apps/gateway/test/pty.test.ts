import assert from 'node:assert/strict';
import test from 'node:test';
import { PtySessionManager } from '../src/pty/manager.js';
import type { SessionEvent } from '../src/types.js';

test('pty sessions emit output and mask stored input', async () => {
  const manager = new PtySessionManager();
  const events: SessionEvent[] = [];
  let stop = false;
  const cleanup = () => {
    if (!stop) {
      manager.stop(session.id);
      stop = true;
    }
  };
  const session = manager.create({
    id: 'tth_pty_test',
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24
  });
  const unsubscribe = manager.subscribe(session.id, (event) => events.push(event));
  try {
    assert.equal(session.status, 'running');
    assert.equal(manager.hasLiveSession(session.id), true);
    assert.equal(manager.getSession(session.id)?.id, session.id);
    assert.deepEqual(manager.listSessions().map((item) => item.id), [session.id]);

    manager.write(session.id, {
      clientId: 'test-client',
      data: 'hello sk-1234567890abcdef1234567890abcdef1234567890abcdef\r'
    });

    await waitFor(
      () => events.some((event) => event.type === 'terminal.output' && String(event.payload.data).includes('hello')),
      1000
    );
    const input = events.find((event) => event.type === 'user.input');
    assert.ok(input);
    assert.match(String(input.payload.data), /\[REDACTED/);
    assert.equal(input.id > 0, true);
    manager.updateSessionStatus(session.id, 'lost');
    assert.equal(manager.getSession(session.id)?.status, 'lost');

    cleanup();
    unsubscribe();
  } finally {
    unsubscribe();
    cleanup();
  }
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}
