import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AgentStatusPublisher } from './session-status-deriver.js';
import { Store, type SessionEvent } from './store.js';

test('AgentStatusPublisher emits submitted then running for PTY input/output', () => {
  const { store, cleanup } = createTempStore();
  const published: SessionEvent[] = [];
  const publisher = new AgentStatusPublisher('tth_status', store, (event) => published.push(event));

  publisher.emit('idle', 'test_start', 'runner');
  publisher.onTerminalOutput('welcome');
  publisher.onUserInput('hello');
  publisher.onUserInput('\r');
  publisher.onTerminalOutput('Working');

  assert.deepEqual(
    published.map((event) => event.payload.status),
    ['idle', 'submitted', 'running']
  );
  cleanup();
});

function createTempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tether-status-'));
  const store = new Store(path.join(dir, 'tether.db'));
  return {
    store,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}
