import assert from 'node:assert/strict';
import test from 'node:test';
import { replayEvents } from '../src/pty/replay.js';
import { createSessionEvent } from '../src/utils/events.js';

test('replayEvents filters by cursor and tail', () => {
  const first = createSessionEvent('tth_replay', 'session.started', {}, 1000);
  const second = createSessionEvent('tth_replay', 'terminal.output', { data: 'one' }, 1001);
  const third = createSessionEvent('tth_replay', 'terminal.output', { data: 'two' }, 1002);
  assert.deepEqual(replayEvents([first, second, third], first.id, 1).map((event) => event.id), [third.id]);
});
