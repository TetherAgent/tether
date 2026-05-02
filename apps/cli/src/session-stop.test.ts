import assert from 'node:assert/strict';
import test from 'node:test';
import { runningSessionIds } from './session-stop.js';

test('runningSessionIds returns only running sessions in list order', () => {
  assert.deepEqual(
    runningSessionIds([
      { id: 'tth_running_1', status: 'running' },
      { id: 'tth_stopped', status: 'stopped' },
      { id: 'tth_failed', status: 'failed' },
      { id: 'tth_running_2', status: 'running' }
    ]),
    ['tth_running_1', 'tth_running_2']
  );
});
