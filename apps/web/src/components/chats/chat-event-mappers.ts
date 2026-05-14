import type { ChatMessagesResponse, ChatRuntimeEventResponse } from './chat-data.js';
import type { ChatClientFailure, ChatReducerSnapshot, ChatStreamEvent, LegacyChatCatchup } from './chat-flow-types.js';
import type { RelayFrame } from '../relay/use-relay-client.js';
import type { Usage } from './chat-types.js';

export function mapHistoryResponseToSnapshot(input: {
  response: ChatMessagesResponse;
  sessionId: string;
}): ChatReducerSnapshot {
  return {
    messages: input.response.messages,
    sessionId: input.sessionId,
    snapshotEventSeq: input.response.snapshotEventSeq
  };
}

export function mapRuntimeEventToChatEvent(input: {
  event: ChatRuntimeEventResponse;
  provider: string;
}): ChatStreamEvent | undefined {
  const eventSeq = parseEventSeq(input.event.eventSeq);
  const turnId = parseTurnId(input.event.turnId);
  if (eventSeq === undefined || !turnId) return undefined;
  return eventPayloadToChatEvent({
    clientRequestId: parseClientRequestId(input.event.clientRequestId),
    createdAt: input.event.createdAt,
    eventSeq,
    payload: input.event.payload,
    provider: input.provider,
    turnId,
    type: input.event.type
  });
}

export function mapRelayFrameToChatEvent(input: {
  frame: RelayFrame;
  provider: string;
}): ChatStreamEvent | undefined {
  const type = typeof input.frame.type === 'string' ? input.frame.type : '';
  if (!isChatEventFrameType(type)) return undefined;
  const eventSeq = parseEventSeq(input.frame.eventSeq);
  const turnId = parseTurnId(input.frame.turnId);
  if (eventSeq === undefined || !turnId) return undefined;
  const payload =
    type === 'user.message'
      ? { message: input.frame.text }
      : type === 'session.error'
        ? { message: input.frame.message }
        : input.frame;
  return eventPayloadToChatEvent({
    clientRequestId: parseClientRequestId(input.frame.clientRequestId),
    createdAt: undefined,
    eventSeq,
    payload,
    provider: input.provider,
    turnId,
    type
  });
}

export function mapStructuredCatchupResponse(input: {
  events: ChatRuntimeEventResponse[];
  provider: string;
  sessionId: string;
}): ChatStreamEvent[] {
  return input.events
    .map((event) => mapRuntimeEventToChatEvent({ event, provider: input.provider }))
    .filter((event): event is ChatStreamEvent => Boolean(event));
}

export function mapGatewayCatchupFrameLegacy(frame: RelayFrame): LegacyChatCatchup | undefined {
  if (frame.type !== 'gateway.chat-catchup') return undefined;
  if (typeof frame.sessionId !== 'string' || typeof frame.text !== 'string') return undefined;
  return {
    sessionId: frame.sessionId,
    text: frame.text,
    ...(typeof frame.lastEventId === 'number' ? { lastEventId: frame.lastEventId } : {})
  };
}

export function mapClientErrorToChatFailure(frame: RelayFrame): ChatClientFailure | undefined {
  if (frame.type !== 'error') return undefined;
  if (typeof frame.code !== 'string' || typeof frame.message !== 'string') return undefined;
  return {
    code: frame.code,
    message: frame.message,
    ...(typeof frame.sessionId === 'string' ? { sessionId: frame.sessionId } : {}),
    ...(typeof frame.clientRequestId === 'string' ? { clientRequestId: frame.clientRequestId } : {})
  };
}

export function parseEventSeq(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseTurnId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseClientRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function eventPayloadToChatEvent(input: {
  clientRequestId?: string;
  createdAt?: string;
  eventSeq: number;
  payload: Record<string, unknown>;
  provider: string;
  turnId: string;
  type: string;
}): ChatStreamEvent | undefined {
  if (input.type === 'user.message' && typeof input.payload.message === 'string') {
    return {
      type: 'user.message',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      clientRequestId: input.clientRequestId,
      content: input.payload.message,
      ts: input.createdAt ? Date.parse(input.createdAt) : Date.now()
    };
  }
  if (input.type === 'agent.delta' && typeof input.payload.text === 'string') {
    return {
      type: 'agent.delta',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      text: input.payload.text,
      provider: input.provider
    };
  }
  if (input.type === 'agent.result' && typeof input.payload.text === 'string') {
    return {
      type: 'agent.result',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      text: input.payload.text,
      provider: input.provider,
      usage: parseUsage(input.payload.usage)
    };
  }
  if (input.type === 'session.error') {
    return {
      type: 'session.error',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      message: typeof input.payload.message === 'string' ? input.payload.message : 'session error',
      provider: input.provider
    };
  }
  if (input.type === 'agent.tool' && typeof input.payload.name === 'string') {
    return {
      type: 'agent.tool',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      name: input.payload.name,
      input: parseRecord(input.payload.input),
      ...(typeof input.payload.result === 'string' ? { result: input.payload.result } : {}),
      isError: Boolean(input.payload.isError)
    };
  }
  if (
    input.type === 'agent.permission_request' &&
    typeof input.payload.requestId === 'string' &&
    typeof input.payload.toolName === 'string'
  ) {
    return {
      type: 'agent.permission_request',
      eventSeq: input.eventSeq,
      turnId: input.turnId,
      requestId: input.payload.requestId,
      toolName: input.payload.toolName
    };
  }
  return undefined;
}

function parseUsage(value: unknown): Usage | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Usage : undefined;
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isChatEventFrameType(type: string): boolean {
  return type === 'user.message' ||
    type === 'agent.delta' ||
    type === 'agent.result' ||
    type === 'session.error' ||
    type === 'agent.tool' ||
    type === 'agent.permission_request';
}
