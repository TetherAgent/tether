import assert from 'node:assert/strict';
import test from 'node:test';
import { JournalWatcher } from './journal-watcher.js';
import type { SessionEvent, Store } from './store.js';

function makeMockStore(): Store & {
  eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }>;
} {
  const eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }> = [];
  const store = {
    eventCalls,
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
    eventCalls: Array<{ sessionId: string; type: string; payload: Record<string, unknown> }>;
  };
}

test('processClaudeEntry parses assistant text turn', () => {
  const store = makeMockStore();
  const published: SessionEvent[] = [];
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, (event) => published.push(event));

  watcher.processClaudeEntry({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0]?.payload.role, 'assistant');
  assert.equal(published[0]?.payload.content, 'Hello world');
});

test('processClaudeEntry parses assistant tool_use turn', () => {
  const store = makeMockStore();
  const published: SessionEvent[] = [];
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, (event) => published.push(event));

  watcher.processClaudeEntry({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', name: 'Write', input: { path: 'foo.ts', content: 'x' } }]
    }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0]?.payload.role, 'assistant');
  assert.equal(published[0]?.payload.content, '');
  assert.deepEqual(published[0]?.payload.tools, [{ name: 'Write', inputSummary: '{"path":"foo.ts","content":"x"}' }]);
});

test('processClaudeEntry ignores non-assistant entries', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'claude', 'agent-id', '/test/project', store, () => undefined);

  watcher.processClaudeEntry({
    type: 'human',
    message: { role: 'human', content: [{ type: 'text', text: 'ignored' }] }
  });

  assert.equal(store.eventCalls.length, 0);
});

test('processCodexEntry builds one turn on task completion', () => {
  const store = makeMockStore();
  const published: SessionEvent[] = [];
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, (event) => published.push(event));

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

  assert.equal(published.length, 1);
  assert.equal(published[0]?.payload.content, 'Part 1\n\nPart 2');
  assert.equal(store.eventCalls.length, 1);
  assert.equal(published[0]?.payload.turnIndex, 1);
});

test('processCodexEntry stores Codex user messages as user turns', () => {
  const store = makeMockStore();
  const published: SessionEvent[] = [];
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, (event) => published.push(event));

  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'user_message', message: 'hello from user' } });

  assert.equal(published.length, 1);
  assert.equal(published[0]?.payload.role, 'user');
  assert.equal(published[0]?.payload.content, 'hello from user');
  assert.equal(store.eventCalls[0]?.payload.role, 'user');
});

test('processCodexEntry ignores empty Codex user messages', () => {
  const store = makeMockStore();
  const watcher = new JournalWatcher('tth_test', 'codex', 'agent-id', '/test/project', store, () => undefined);

  watcher.processCodexEntry({ type: 'event_msg', payload: { type: 'user_message', message: '   ' } });

  assert.equal(store.eventCalls.length, 0);
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

  assert.equal(store.eventCalls.length, 0);
});
