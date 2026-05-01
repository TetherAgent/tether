import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PtySessionManager } from './pty.js';
import { Store } from './store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-pty-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('pty sessions emit output and mask stored input', async () => {
  const { store, cleanup } = tempStore();
  try {
    const manager = new PtySessionManager(store);
    const session = manager.create({
      id: 'tth_pty_test',
      provider: 'codex',
      command: '/bin/cat',
      projectPath: process.cwd(),
      cols: 80,
      rows: 24
    });

    assert.equal(session.status, 'running');
    assert.equal(manager.hasLiveSession(session.id), true);

    manager.write(session.id, {
      clientId: 'test-client',
      data: 'hello sk-1234567890abcdef1234567890abcdef1234567890abcdef\r'
    });

    await waitFor(() => store.transcript(session.id).includes('hello'), 1000);
    const input = store.listEvents(session.id).find((event) => event.type === 'user.input');
    assert.ok(input);
    assert.match(String(input.payload.data), /\[REDACTED/);

    manager.stop(session.id);
  } finally {
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
