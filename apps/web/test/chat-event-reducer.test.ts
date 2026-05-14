import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyChatStreamEvent,
  applyChatStreamEvents,
  createChatEventReducerState,
  historySnapshotToReducerState,
  type ChatStreamEvent
} from '../src/components/chats/chat-event-reducer.js';

function agentTexts(state: ReturnType<typeof createChatEventReducerState>): string[] {
  return state.messages
    .filter((item) => item.kind === 'agent')
    .map((item) => item.text);
}

function lastAgent(state: ReturnType<typeof createChatEventReducerState>) {
  const item = [...state.messages].reverse().find((message) => message.kind === 'agent');
  assert(item?.kind === 'agent');
  return item;
}

function delta(eventSeq: number, turnId: string, text: string): ChatStreamEvent {
  return { type: 'agent.delta', eventSeq, turnId, text, provider: 'claude' };
}

function result(eventSeq: number, turnId: string, text: string): ChatStreamEvent {
  return { type: 'agent.result', eventSeq, turnId, text, provider: 'claude' };
}

test('history 先到，delta 后到：最后 user 生成 waiting，delta 合并到同一 turn', () => {
  let state = historySnapshotToReducerState([
    { role: 'user', content: 'hello', createdAt: '2026-05-14T00:00:00.000Z' }
  ], 'claude');

  assert.equal(lastAgent(state).isWaiting, true);

  state = applyChatStreamEvent(state, delta(1, 'turn-1', 'hi'));

  assert.deepEqual(agentTexts(state), ['hi']);
  assert.equal(lastAgent(state).isStreaming, true);
});

test('delta 先到，result 后到：result 替换为最终文本并关闭 streaming', () => {
  let state = createChatEventReducerState();

  state = applyChatStreamEvents(state, [
    delta(1, 'turn-a', 'hel'),
    delta(2, 'turn-a', 'lo'),
    result(3, 'turn-a', 'hello final')
  ]);

  assert.deepEqual(agentTexts(state), ['hello final']);
  assert.equal(lastAgent(state).isStreaming, false);
  assert.equal(lastAgent(state).isWaiting, false);
});

test('result 先到，旧 delta 后到：旧 delta 不污染最终文本', () => {
  let state = createChatEventReducerState();

  state = applyChatStreamEvent(state, result(10, 'turn-a', 'final answer'));
  state = applyChatStreamEvent(state, delta(11, 'turn-a', ' stale tail'));

  assert.deepEqual(agentTexts(state), ['final answer']);
  assert.equal(lastAgent(state).isStreaming, false);
});

test('多轮 delta id 重复：按 turnId 分离，不串轮', () => {
  let state = createChatEventReducerState();

  state = applyChatStreamEvents(state, [
    delta(1, 'turn-a', 'first '),
    delta(2, 'turn-a', 'answer'),
    result(3, 'turn-a', 'first answer'),
    delta(4, 'turn-b', 'second '),
    delta(5, 'turn-b', 'answer')
  ]);

  assert.deepEqual(agentTexts(state), ['first answer', 'second answer']);
});

test('reconnect catch-up 后不重复、不串轮', () => {
  let state = createChatEventReducerState();
  const catchup: ChatStreamEvent[] = [
    delta(1, 'turn-a', 'first'),
    result(2, 'turn-a', 'first final'),
    delta(3, 'turn-b', 'second')
  ];

  state = applyChatStreamEvents(state, catchup);
  state = applyChatStreamEvents(state, catchup);
  state = applyChatStreamEvent(state, result(4, 'turn-b', 'second final'));

  assert.deepEqual(agentTexts(state), ['first final', 'second final']);
  assert.equal(state.messages.filter((item) => item.kind === 'agent').length, 2);
});
