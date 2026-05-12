import type { SessionEvent, SessionEventType } from '../types.js';

let sessionEventSequence = 0;

export function createSessionEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: SessionEventType,
  payload: TPayload,
  ts = Date.now()
): SessionEvent<TPayload> {
  sessionEventSequence = (sessionEventSequence + 1) % 1000;
  return {
    id: (ts * 1000) + sessionEventSequence,
    sessionId,
    type,
    ts,
    payload
  };
}
