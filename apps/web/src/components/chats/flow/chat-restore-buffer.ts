import type { ChatStreamEvent } from '../events/chat-event-reducer.js';

export type ChatRestoreBufferStatus = 'open' | 'drained';

export type ChatRestoreBuffer = {
  attemptId: string;
  dropped: number;
  events: ChatStreamEvent[];
  overflowed: boolean;
  sessionId: string;
  status: ChatRestoreBufferStatus;
};

export function createRestoreBuffer(input: {
  attemptId: string;
  sessionId: string;
}): ChatRestoreBuffer {
  return {
    attemptId: input.attemptId,
    dropped: 0,
    events: [],
    overflowed: false,
    sessionId: input.sessionId,
    status: 'open'
  };
}

export function bufferLiveEvent(input: {
  buffer: ChatRestoreBuffer;
  event: ChatStreamEvent;
  maxEvents: number;
  maxPayloadBytes: number;
}): { buffer: ChatRestoreBuffer; rejectedEvent?: ChatStreamEvent } {
  if (input.buffer.status === 'drained') {
    return { buffer: input.buffer, rejectedEvent: input.event };
  }
  const nextEvents = [...input.buffer.events, input.event];
  const overflowed =
    nextEvents.length > input.maxEvents ||
    estimatePayloadBytes(nextEvents) > input.maxPayloadBytes;
  if (overflowed) {
    return {
      buffer: {
        ...input.buffer,
        dropped: input.buffer.dropped + 1,
        overflowed: true
      },
      rejectedEvent: input.event
    };
  }
  return {
    buffer: {
      ...input.buffer,
      events: nextEvents
    }
  };
}

export function drainBufferedEvents(input: {
  buffer: ChatRestoreBuffer;
  catchupEvents: ChatStreamEvent[];
  snapshotEventSeq: number;
}): { buffer: ChatRestoreBuffer; eventsToApply: ChatStreamEvent[] } {
  const drainedBuffer: ChatRestoreBuffer = {
    ...input.buffer,
    events: [],
    status: 'drained'
  };
  if (input.buffer.status === 'drained') {
    return { buffer: drainedBuffer, eventsToApply: [] };
  }
  const eventsToApply = [...input.catchupEvents, ...input.buffer.events]
    .filter((event) => event.eventSeq > input.snapshotEventSeq)
    .sort((a, b) => a.eventSeq - b.eventSeq);
  return { buffer: drainedBuffer, eventsToApply };
}

export function isRestoreBufferOverflowed(buffer: ChatRestoreBuffer): boolean {
  return buffer.overflowed;
}

export function isRestoreBufferDrained(buffer: ChatRestoreBuffer): boolean {
  return buffer.status === 'drained';
}

function estimatePayloadBytes(events: ChatStreamEvent[]): number {
  return events.reduce((total, event) => total + JSON.stringify(event).length, 0);
}
