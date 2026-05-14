import type { MessageItem } from './chat-types.js';

export function createClientRequestId(now = Date.now()): string {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${now}-${Math.random().toString(16).slice(2)}`;
}

export function createOptimisticTurn(input: {
  clientRequestId: string;
  now: number;
  provider: string;
  text: string;
}): { agent: MessageItem; user: MessageItem } {
  return {
    user: {
      kind: 'user',
      id: `user-${input.clientRequestId}`,
      content: input.text,
      ts: input.now
    },
    agent: {
      kind: 'agent',
      id: `agent-${input.clientRequestId}`,
      text: '',
      isStreaming: false,
      isWaiting: true,
      isLost: false,
      provider: input.provider
    }
  };
}

export function reconcileOptimisticTurn(input: {
  clientRequestId: string;
  content: string;
  eventSeq: number;
  messages: MessageItem[];
  ts: number;
  turnId: string;
}): MessageItem[] {
  const userId = `user-${input.clientRequestId}`;
  const agentId = `agent-${input.clientRequestId}`;
  const nextUserId = `${input.turnId}-user`;
  const hasRealUser = input.messages.some((item) => item.kind === 'user' && item.id === nextUserId);
  return input.messages.flatMap((item) => {
    if (item.kind === 'user' && item.id === userId) {
      return hasRealUser ? [] : [{ ...item, id: nextUserId, content: input.content, ts: input.ts }];
    }
    if (item.kind === 'agent' && item.id === agentId) {
      return [{ ...item, id: input.turnId }];
    }
    return [item];
  });
}

export function rollbackOptimisticTurn(input: {
  clientRequestId: string;
  messages: MessageItem[];
  reason: string;
}): MessageItem[] {
  const userId = `user-${input.clientRequestId}`;
  const agentId = `agent-${input.clientRequestId}`;
  return [
    ...input.messages.filter((item) => item.id !== userId && item.id !== agentId),
    { kind: 'system' as const, id: `rollback-${input.clientRequestId}`, text: input.reason }
  ];
}
