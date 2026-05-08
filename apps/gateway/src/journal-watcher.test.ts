import assert from 'node:assert/strict';
import test from 'node:test';
import { JournalWatcher } from './journal-watcher.js';
import type { SessionEvent, Store } from './store.js';

type InsertCall = {
  sessionId: string;
  role: string;
  content: string;
  tools?: string;
};

function makeMockStore(): Store & {
  insertCalls: InsertCall[];
  eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }>;
} {
  const insertCalls: InsertCall[] = [];
  const eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }> = [];
  const store = {
    insertCalls,
    eventCalls,
    insertConversationTurn(sessionId: string, role: string, content: string, tools?: string): number {
      insertCalls.push({ sessionId, role, content, tools });
      return insertCalls.length - 1;
    },
    appendEvent(sessionId: string, type: string, payload: Record<string, unknown>): SessionEvent {
      eventCalls.push({ sessionId, type, payload });
      return {
        id: eventCalls.length,
        sessionId,
        type: type as SessionEvent['type'],
        ts: Date.now(),
        payload
      };
    }
  };
  return store as unknown as Store & {
    insertCalls: InsertCall[];
    eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }>;
  };
}

test('processClaudeEntry parses assistant text turn', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, () => undefined);

  watcher.processClaudeEntry({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }
  });

  assert.equal(store.insertCalls.length, 1);
  assert.deepEqual(store.insertCalls[0], {
    sessionId: 'tth_test',
    role: 'assistant',
    content: 'Hello world',
    tools: undefined
  });
});

test('processClaudeEntry parses assistant tool_use turn', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, () => undefined);

  watcher.processClaudeEntry({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Write', input: { path: 'foo.ts', content: 'x' } }]
    }
  });

  assert.equal(store.insertCalls.length, 1);
  assert.equal(store.insertCalls[0]?.role, 'assistant');
  assert.equal(store.insertCalls[0]?.content, '');
  assert.ok(store.insertCalls[0]?.tools?.includes('"name":"Write"'));
});

test('processClaudeEntry ignores non-assistant entries', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, () => undefined);

  watcher.processClaudeEntry({
    type: 'human',
    message: { role: 'human', content: [{ type: 'text', text: 'ignored' }] }
  });

  assert.equal(store.insertCalls.length, 0);
});

test('processCodexEntry builds one turn on task completion', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, () => undefined);

  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'task_started' } });
  watcher.processCodexEntry({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Part 1' }]
    }
  });
  watcher.processCodexEntry({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Part 2' }]
    }
  });
  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'task_completed' } });

  assert.equal(store.insertCalls.length, 1);
  assert.equal(store.insertCalls[0]?.content, 'Part 1\n\nPart 2');
  assert.equal(store.eventCalls.length, 1);
  assert.equal(store.eventCalls[0]?.payload.turnIndex, 0);
});

test('processCodexEntry stores Codex user messages as user turns', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, () => undefined);

  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'user_message', message: 'hello from user' } });

  assert.equal(store.insertCalls.length, 1);
  assert.equal(store.insertCalls[0]?.role, 'user');
  assert.equal(store.insertCalls[0]?.content, 'hello from user');
  assert.equal(store.eventCalls[0]?.payload.role, 'user');
});

test('processCodexEntry ignores empty Codex user messages', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, () => undefined);

  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'user_message', message: '   ' } });

  assert.equal(store.insertCalls.length, 0);
});

test('processCodexEntry ignores assistant response before task_started', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, () => undefined);

  watcher.processCodexEntry({
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'orphan' }]
    }
  });

  assert.equal(store.insertCalls.length, 0);
});
