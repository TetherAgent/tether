import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from './store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-store-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('stores sessions and cursor-addressed events', () => {
  const { store, cleanup } = tempStore();
  try {
    const now = Date.now();
    store.insertSession({
      id: 'tth_test',
      provider: 'codex',
      title: 'test',
      projectPath: '/tmp/test',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'codex',
      pid: 123,
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    const first = store.appendEvent('tth_test', 'terminal.output', { data: 'one', encoding: 'utf8' });
    const second = store.appendEvent('tth_test', 'terminal.output', { data: 'two', encoding: 'utf8' });
    const third = store.appendEvent('tth_test', 'terminal.output', { data: 'three', encoding: 'utf8' });

    assert.equal(store.getSession('tth_test')?.transport, 'pty-event-stream');
    assert.equal(store.latestEventId('tth_test'), third.id);
    assert.deepEqual(store.listEvents('tth_test', first.id).map((event) => event.id), [second.id, third.id]);
    assert.deepEqual(store.listRecentEvents('tth_test', 2).map((event) => event.id), [second.id, third.id]);
    assert.equal(store.transcript('tth_test'), 'onetwothree');
  } finally {
    cleanup();
  }
});
