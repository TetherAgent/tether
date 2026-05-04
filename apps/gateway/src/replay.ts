import type { SessionEvent, Store } from './store.js';

export const SESSION_REPLAY_PAGE_SIZE = 5000;

export type ReplayPage = {
  events: SessionEvent[];
  done: boolean;
  latestEventId: number;
};

export type ReplaySessionEventsOptions = {
  store: Store;
  sessionId: string;
  after: number;
  tail?: number;
  pageSize?: number;
  sendPage: (page: ReplayPage) => void;
};

export function replaySessionEvents(options: ReplaySessionEventsOptions): number {
  const pageSize = options.pageSize ?? SESSION_REPLAY_PAGE_SIZE;

  if (options.tail && options.tail > 0 && options.after === 0) {
    const events = options.store.listRecentEvents(options.sessionId, options.tail);
    const latestEventId = options.store.latestEventId(options.sessionId);
    options.sendPage({ events, done: true, latestEventId });
    return latestEventId;
  }

  let cursor = options.after;
  while (true) {
    const events = options.store.listEvents(options.sessionId, cursor, pageSize);
    if (events.length === 0) {
      options.sendPage({ events: [], done: true, latestEventId: cursor });
      return cursor;
    }

    cursor = events.at(-1)?.id ?? cursor;
    const done = events.length < pageSize;
    options.sendPage({ events, done, latestEventId: cursor });
    if (done) {
      return cursor;
    }
  }
}
