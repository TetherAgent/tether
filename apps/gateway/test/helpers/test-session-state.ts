import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSessionEvent } from '../../src/events.js';
import { PtySessionManager } from '../../src/pty.js';
import type { Session, SessionEvent, SessionEventType, SessionStatus } from '../../src/types.js';

export type TestSessionState = {
  ptySessions: PtySessionManager;
  insertSession: (session: Session) => void;
  getSession: (id: string) => Session | undefined;
  listSessions: () => Session[];
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  appendEvent: <TPayload extends Record<string, unknown>>(
    sessionId: string,
    type: SessionEventType,
    payload: TPayload
  ) => SessionEvent<TPayload>;
  listEvents: (sessionId: string) => SessionEvent[];
};

export function tempSessionState(): { store: TestSessionState; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-session-state-'));
  const ptySessions = new PtySessionManager();
  const events = new Map<string, SessionEvent[]>();
  const subscriptions = new Map<string, () => void>();

  const ensureSubscription = (sessionId: string) => {
    if (subscriptions.has(sessionId)) {
      return;
    }
    const unsubscribe = ptySessions.subscribe(sessionId, (event) => {
      const current = events.get(sessionId) ?? [];
      current.push(event);
      events.set(sessionId, current);
    });
    subscriptions.set(sessionId, unsubscribe);
  };

  const store: TestSessionState = {
    ptySessions,
    insertSession(session) {
      ptySessions.restoreSession(session);
      ensureSubscription(session.id);
    },
    getSession(id) {
      return ptySessions.getSession(id);
    },
    listSessions() {
      return ptySessions.listSessions();
    },
    updateSessionStatus(id, status) {
      ptySessions.updateSessionStatus(id, status);
    },
    appendEvent(sessionId, type, payload) {
      const event = createSessionEvent(sessionId, type, payload);
      const current = events.get(sessionId) ?? [];
      current.push(event);
      events.set(sessionId, current);
      return event;
    },
    listEvents(sessionId) {
      return [...(events.get(sessionId) ?? [])];
    }
  };

  return {
    store,
    cleanup: () => {
      for (const unsubscribe of subscriptions.values()) {
        unsubscribe();
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
