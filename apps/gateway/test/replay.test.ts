import assert from 'node:assert/strict';
import test from 'node:test';
import { replayEvents } from '../src/pty/replay.js';

test('replayEvents resolves as a no-op stub', async () => {
  await assert.doesNotReject(() => replayEvents('tth_replay_stub'));
});
