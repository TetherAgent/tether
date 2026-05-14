import type {
  ChatMessagesResponseDto,
  ChatRuntimeEventsResponseDto,
  RelayClientToServerFrame,
  RelayServerToClientFrame
} from './index.js';

const createChatFrame: RelayClientToServerFrame = {
  type: 'client.chat',
  sessionId: null,
  provider: 'claude',
  model: 'sonnet',
  cwd: '~',
  message: 'hello',
  gatewayId: 'gateway-1',
  clientRequestId: 'request-1'
};

const existingChatFrame: RelayClientToServerFrame = {
  type: 'client.chat',
  sessionId: 'session-1',
  message: 'hello',
  clientRequestId: 'request-2'
};

const subscriptionAckFrame: RelayServerToClientFrame = {
  type: 'subscription.ack',
  sessionId: 'session-1',
  mode: 'control'
};

const structuredUserFrame: RelayServerToClientFrame = {
  type: 'user.message',
  sessionId: 'session-1',
  text: 'hello',
  eventId: 10,
  eventSeq: 10,
  turnId: 'turn-1',
  clientRequestId: 'request-1'
};

const legacyDeltaFrame: RelayServerToClientFrame = {
  type: 'agent.delta',
  sessionId: 'session-1',
  text: 'partial',
  eventId: 11
};

const historyResponse: ChatMessagesResponseDto = {
  snapshotEventSeq: 12,
  lastEventId: 12,
  messages: [
    {
      role: 'user',
      content: 'hello',
      turnId: 'turn-1',
      clientRequestId: 'request-1',
      createdAt: '2026-05-14T00:00:00.000Z'
    }
  ]
};

const catchupResponse: ChatRuntimeEventsResponseDto = {
  events: [
    {
      eventId: 13,
      eventSeq: 13,
      turnId: 'turn-1',
      type: 'agent.result',
      payload: { text: 'done' },
      createdAt: '2026-05-14T00:00:01.000Z'
    }
  ]
};

void [
  createChatFrame,
  existingChatFrame,
  subscriptionAckFrame,
  structuredUserFrame,
  legacyDeltaFrame,
  historyResponse,
  catchupResponse
];

const malformedCatchupResponse: ChatRuntimeEventsResponseDto = {
  events: [
    // @ts-expect-error new structured catch-up events require eventSeq, not only legacy eventId.
    {
      eventId: 14,
      type: 'agent.result',
      payload: { text: 'done' },
      createdAt: '2026-05-14T00:00:02.000Z'
    }
  ]
};

void malformedCatchupResponse;
