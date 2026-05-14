import type { ChatHistoryMessage } from './chat-data.js';
import type { MessageItem, Usage } from './chat-types.js';

export type ChatStreamEvent =
  | {
      type: 'user.message';
      eventSeq: number;
      turnId: string;
      content: string;
      ts?: number;
    }
  | {
      type: 'agent.delta';
      eventSeq: number;
      turnId: string;
      text: string;
      provider: string;
    }
  | {
      type: 'agent.result';
      eventSeq: number;
      turnId: string;
      text: string;
      provider: string;
      usage?: Usage;
    }
  | {
      type: 'session.error';
      eventSeq: number;
      turnId: string;
      message: string;
      provider: string;
    };

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
        .map((item) => item.id)
    ),
    lastEventSeq: 0,
    messages
  };
}

export function historySnapshotToReducerState(
  historyMessages: ChatHistoryMessage[],
  provider: string
): ChatEventReducerState {
  const messages: MessageItem[] = historyMessages.map((message, index) =>
    message.role === 'user'
      ? { kind: 'user', id: `history-user-${index}`, content: message.content, ts: Date.parse(message.createdAt) }
      : {
          kind: 'agent',
          id: `history-agent-${index}`,
          text: message.content,
          isStreaming: false,
          isWaiting: false,
          isLost: false,
          provider,
          usage: message.usageJson
        }
  );
  if (messages.at(-1)?.kind === 'user') {
    messages.push({
      kind: 'agent',
      id: `turn-${historyMessages.length}`,
      text: '',
      isStreaming: false,
      isWaiting: true,
      isLost: false,
      provider
    });
  }
  return createChatEventReducerState(messages);
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
        messages: appendUniqueUser(nextState.messages, event.turnId, event.content, event.ts)
      };
    case 'agent.delta':
      return {
        ...nextState,
        messages: upsertAgent(nextState.messages, {
          id: event.turnId,
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
  }
}

export function applyChatStreamEvents(
  state: ChatEventReducerState,
  events: ChatStreamEvent[]
): ChatEventReducerState {
  return events.reduce((current, event) => applyChatStreamEvent(current, event), state);
}

function appendUniqueUser(messages: MessageItem[], turnId: string, content: string, ts = Date.now()): MessageItem[] {
  const id = `${turnId}-user`;
  if (messages.some((item) => item.kind === 'user' && item.id === id)) {
    return messages;
  }
  return [...messages, { kind: 'user', id, content, ts }];
}

function upsertAgent(
  messages: MessageItem[],
  input: {
    id: string;
    isLost: boolean;
    isStreaming: boolean;
    isWaiting: boolean;
    provider: string;
    textTransform: (currentText: string) => string;
    usage?: Usage;
  }
): MessageItem[] {
  const existingIndex = messages.findIndex((item) => item.kind === 'agent' && item.id === input.id);
  if (existingIndex >= 0) {
    return messages.map((item, index) =>
      index === existingIndex && item.kind === 'agent'
        ? {
            ...item,
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
