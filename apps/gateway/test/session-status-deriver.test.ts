import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionEvent } from '../src/events.js';
import { AgentStatusPublisher } from '../src/session-status-deriver.js';
import type { SessionEvent } from '../src/store.js';

test('AgentStatusPublisher emits submitted then running for PTY input/output', () => {
  const published: SessionEvent[] = [];
  const publisher = new AgentStatusPublisher('tth_status', (type, payload) => {
    published.push(createSessionEvent('tth_status', type, payload));
  });

  publisher.emit('idle', 'test_start', 'runner');
  publisher.onTerminalOutput('welcome');
  publisher.onUserInput('hello');
  publisher.onUserInput('\r');
  publisher.onTerminalOutput('Working');

  assert.deepEqual(
    published.map((event) => event.payload.status),
    ['idle', 'submitted', 'running']
  );
});
