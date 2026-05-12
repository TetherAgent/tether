import type { SessionEvent, SessionEventType } from '../types.js';

let eventSequence = 0;

export function nextEventId(ts = Date.now()): number {
  eventSequence = (eventSequence + 1) % 1000;
  return (ts * 1000) + eventSequence;
}

export function createSessionEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: SessionEventType,
  payload: TPayload,
  ts = Date.now()
): SessionEvent<TPayload> {
  return {
    id: nextEventId(ts),
    sessionId,
    type,
    ts,
    payload
  };
}
