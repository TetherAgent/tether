import type { SessionEvent } from '../types.js';

export function replayEvents(events: SessionEvent[], after: number, tail?: number): SessionEvent[] {
  const replay = events.filter((event) => event.id > after);
  if (tail !== undefined && Number.isInteger(tail) && tail > 0) {
    return replay.slice(-tail);
  }
  return replay;
}
