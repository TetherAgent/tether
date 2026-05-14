import type { ChatHistoryMessage } from './chat-data.js';
import type { ChatReducerSnapshot, ChatStreamEvent } from './chat-flow-types.js';
import type { MessageItem, Usage } from './chat-types.js';

export type { ChatStreamEvent } from './chat-flow-types.js';

export type ChatEventReducerState = {
  completedTurnIds: Set<string>;
  lastEventSeq: number;
  messages: MessageItem[];
};

export function createChatEventReducerState(messages: MessageItem[] = []): ChatEventReducerState {
  return {
    completedTurnIds: new Set(
      messages
        .filter((item): item is Extract<MessageItem, { kind: 'agent' }> =>
          item.kind === 'agent' && !item.isStreaming && !item.isWaiting
        )
        .filter((item) => !item.id.startsWith('history-agent-'))
        .map((item) => item.id)
    ),
    lastEventSeq: 0,
    messages
  };
}

export function stateFromSnapshot(snapshot: ChatReducerSnapshot, provider: string): ChatEventReducerState {
  return historySnapshotToReducerState(snapshot.messages, provider, snapshot.snapshotEventSeq);
}

export function historySnapshotToReducerState(
  historyMessages: ChatHistoryMessage[],
  provider: string,
  snapshotEventSeq = 0
): ChatEventReducerState {
  const messages: MessageItem[] = historyMessages.map((message, index) =>
    message.role === 'user'
      ? {
          kind: 'user',
          id: message.turnId ? `${message.turnId}-user` : `history-user-${index}`,
          content: message.content,
          ts: Date.parse(message.createdAt)
        }
      : {
          kind: 'agent',
          id: message.turnId ?? `history-agent-${index}`,
          text: message.content,
          isStreaming: false,
          isWaiting: false,
          isLost: false,
          provider,
          usage: message.usageJson
        }
  );
  if (messages.at(-1)?.kind === 'user') {
    const lastHistoryMessage = historyMessages.at(-1);
    const waitingAgentId = lastHistoryMessage?.turnId ?? `turn-${historyMessages.length}`;
    messages.push({
      kind: 'agent',
      id: waitingAgentId,
      text: '',
      isStreaming: false,
      isWaiting: true,
      isLost: false,
      provider
    });
  }
  return {
    ...createChatEventReducerState(messages),
    lastEventSeq: snapshotEventSeq
  };
}

export function applyChatStreamEvent(
  state: ChatEventReducerState,
  event: ChatStreamEvent
): ChatEventReducerState {
  if (event.eventSeq <= state.lastEventSeq) {
    return state;
  }
  if (state.completedTurnIds.has(event.turnId) && event.type !== 'user.message') {
    return { ...state, lastEventSeq: event.eventSeq };
  }

  const nextState = {
    completedTurnIds: new Set(state.completedTurnIds),
    lastEventSeq: event.eventSeq,
    messages: state.messages
  };

  switch (event.type) {
    case 'user.message':
      return {
        ...nextState,
        messages: reconcileUserMessage(nextState.messages, {
          turnId: event.turnId,
          clientRequestId: event.clientRequestId,
          content: event.content,
          ts: event.ts
        })
      };
    case 'agent.delta':
      return {
        ...nextState,
        messages: upsertAgent(nextState.messages, {
          id: event.turnId,
          clientRequestId: event.clientRequestId,
          provider: event.provider,
          textTransform: (text) => `${text}${event.text}`,
          isStreaming: true,
          isWaiting: false,
          isLost: false
        })
      };
    case 'agent.result':
      nextState.completedTurnIds.add(event.turnId);
      return {
        ...nextState,
        messages: upsertAgent(nextState.messages, {
          id: event.turnId,
          clientRequestId: event.clientRequestId,
          provider: event.provider,
          textTransform: () => event.text,
          isStreaming: false,
          isWaiting: false,
          isLost: false,
          usage: event.usage
        })
      };
    case 'session.error':
      nextState.completedTurnIds.add(event.turnId);
      return {
        ...nextState,
        messages: [
          ...upsertAgent(nextState.messages, {
            id: event.turnId,
            provider: event.provider,
            textTransform: (text) => text,
            isStreaming: false,
            isWaiting: false,
            isLost: true
          }),
          { kind: 'system', id: `error-${event.eventSeq}`, text: event.message }
        ]
      };
    case 'agent.tool':
      return {
        ...nextState,
        messages: [
          ...nextState.messages,
          {
            kind: 'tool',
            id: `tool-${event.turnId}-${event.eventSeq}`,
            toolName: event.name,
            input: event.input,
            result: event.result,
            isError: event.isError,
            isInFlight: false
          }
        ]
      };
    case 'agent.permission_request':
      return {
        ...nextState,
        messages: [
          ...upsertAgent(nextState.messages, {
            id: event.turnId,
            provider: 'agent',
            textTransform: (text) => text,
            isStreaming: false,
            isWaiting: true,
            isLost: false
          }),
          {
            kind: 'permission',
            id: `permission-${event.requestId}`,
            requestId: event.requestId,
            toolName: event.toolName
          }
        ]
      };
  }
}

export function applyChatStreamEvents(
  state: ChatEventReducerState,
  events: ChatStreamEvent[]
): ChatEventReducerState {
  return [...events]
    .sort((a, b) => a.eventSeq - b.eventSeq)
    .reduce((current, event) => applyChatStreamEvent(current, event), state);
}

function reconcileUserMessage(
  messages: MessageItem[],
  input: { turnId: string; clientRequestId?: string; content: string; ts?: number }
): MessageItem[] {
  const optimisticId = input.clientRequestId ? `user-${input.clientRequestId}` : undefined;
  const waitingId = input.clientRequestId ? `agent-${input.clientRequestId}` : undefined;
  const id = `${input.turnId}-user`;
  if (messages.some((item) => item.kind === 'user' && item.id === id)) {
    return messages;
  }
  return messages.map((item) => {
    if (optimisticId && item.kind === 'user' && item.id === optimisticId) {
      return { ...item, id, content: input.content, ts: input.ts ?? item.ts };
    }
    if (waitingId && item.kind === 'agent' && item.id === waitingId) {
      return { ...item, id: input.turnId };
    }
    return item;
  }).concat(
    messages.some((item) => optimisticId && item.kind === 'user' && item.id === optimisticId)
      ? []
      : [{ kind: 'user', id, content: input.content, ts: input.ts ?? Date.now() }]
  );
}

function upsertAgent(
  messages: MessageItem[],
  input: {
    id: string;
    clientRequestId?: string;
    isLost: boolean;
    isStreaming: boolean;
    isWaiting: boolean;
    provider: string;
    textTransform: (currentText: string) => string;
    usage?: Usage;
  }
): MessageItem[] {
  const optimisticId = input.clientRequestId ? `agent-${input.clientRequestId}` : undefined;
  const existingIndex = messages.findIndex((item) =>
    item.kind === 'agent' && (item.id === input.id || (optimisticId !== undefined && item.id === optimisticId))
  );
  if (existingIndex >= 0) {
    return messages.map((item, index) =>
      index === existingIndex && item.kind === 'agent'
        ? {
            ...item,
            id: input.id,
            text: input.textTransform(item.text),
            isStreaming: input.isStreaming,
            isWaiting: input.isWaiting,
            isLost: input.isLost,
            provider: input.provider,
            ...(input.usage ? { usage: input.usage } : {})
          }
        : item
    );
  }
  return [
    ...messages,
    {
      kind: 'agent',
      id: input.id,
      text: input.textTransform(''),
      isStreaming: input.isStreaming,
      isWaiting: input.isWaiting,
      isLost: input.isLost,
      provider: input.provider,
      ...(input.usage ? { usage: input.usage } : {})
    }
  ];
}
