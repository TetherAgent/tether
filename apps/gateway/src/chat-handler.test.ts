import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SessionRunnerClient } from './session-runner-client.js';
import { handleChatMessage } from './chat-handler.js';
import { Store } from './store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-chat-handler-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('handleChatMessage inserts user turn, writes PTY and emits user turn plus agent.typing', async () => {
  const { store, cleanup } = tempStore();
  const writes: Array<{ data: string; clientId: string }> = [];
  const runnerClient = {
    write: async (data: string, clientId: string) => {
      writes.push({ data, clientId });
    }
  } as SessionRunnerClient;

  try {
    const events = await handleChatMessage('sess_chat', 'hello world', store, runnerClient);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.sessionId, 'sess_chat');
    assert.equal(events[0]?.type, 'agent.turn');
     assert.deepEqual(events[0]?.payload, {
       role: 'user',
       content: 'hello world',
       tools: [],
       turnIndex: events[0]?.id
     });
    assert.equal(events[1]?.sessionId, 'sess_chat');
    assert.equal(events[1]?.type, 'agent.typing');
    assert.deepEqual(events[1]?.payload, {});
    assert.deepEqual(writes, [
      { data: 'hello world', clientId: 'chat' },
      { data: '\r', clientId: 'chat' }
    ]);

     const turns = store.listAgentTurns('sess_chat');
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.role, 'user');
    assert.equal(turns[0]?.content, 'hello world');
  } finally {
    cleanup();
  }
});

test('handleChatMessage caps message to 4000 chars', async () => {
  const { store, cleanup } = tempStore();
  const longMessage = 'a'.repeat(4500);

  try {
    await handleChatMessage('sess_cap', longMessage, store, undefined);
     const turns = store.listAgentTurns('sess_cap');
    assert.equal(turns[0]?.content.length, 4000);
  } finally {
    cleanup();
  }
});
