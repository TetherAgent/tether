import type { RelayTerminalEvent } from '@tether/protocol';
import { detectSelectOptions } from '../pty/agent-select-detector.js';
import type { IChatRunner } from '../chat/chat-session-runner.js';
import { createSessionEvent } from '../utils/events.js';
import { isValidTerminalSize, type PtySessionManager } from '../pty/manager.js';
import type { SessionRunnerClient } from '../pty/session-runner-client.js';
import type { Session, SessionEvent } from '../types.js';
import type { RelaySender } from './relay-sender.js';
import type { SessionCatalog } from './session-catalog.js';

export type RelaySubscriptionMode = 'control' | 'observe';

export type RelaySubscription = {
  mode: RelaySubscriptionMode;
  unsubscribe?: () => void | Promise<void>;
};

export type SubscriptionError = {
  code: string;
  message: string;
};

export type ControlSessionResult =
  | { ok: true; session: Session }
  | { ok: false; error: SubscriptionError };

export class SubscriptionManager {
  private readonly subscriptions = new Map<string, RelaySubscription>();

  get(clientId: string, sessionId: string): RelaySubscription | undefined {
    return this.subscriptions.get(subscriptionKey(clientId, sessionId));
  }

  set(clientId: string, sessionId: string, subscription: RelaySubscription): void {
    this.subscriptions.set(subscriptionKey(clientId, sessionId), subscription);
  }

  delete(clientId: string, sessionId: string): void {
    this.subscriptions.delete(subscriptionKey(clientId, sessionId));
  }

  async remove(clientId: string, sessionId: string): Promise<void> {
    const key = subscriptionKey(clientId, sessionId);
    const subscription = this.subscriptions.get(key);
    await subscription?.unsubscribe?.();
    this.subscriptions.delete(key);
  }

  async clear(): Promise<void> {
    await Promise.allSettled([...this.subscriptions.values()].map((subscription) => subscription.unsubscribe?.()));
    this.subscriptions.clear();
  }

  requireControlSession(
    clientId: string,
    sessionId: string,
    getSession: (sessionId: string) => Session | undefined
  ): ControlSessionResult {
    const session = getSession(sessionId);
    if (!session) {
      return {
        ok: false,
        error: { code: 'session_not_found', message: 'session not found' }
      };
    }
    const subscription = this.get(clientId, sessionId);
    if (!subscription) {
      return {
        ok: false,
        error: { code: 'not_subscribed', message: 'client is not subscribed to this session' }
      };
    }
    if (subscription.mode !== 'control') {
      return {
        ok: false,
        error: { code: 'observe_only', message: 'observer clients cannot control sessions' }
      };
    }
    return { ok: true, session };
  }
}

export function subscriptionKey(clientId: string, sessionId: string): string {
  return `${clientId}:${sessionId}`;
}

export type SubscriptionHandlerOptions = {
  sessionCatalog: SessionCatalog;
  subscriptions: SubscriptionManager;
  relaySender: RelaySender;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
  runnerForProvider: (provider: string) => IChatRunner | undefined;
  toRelayEvent: (event: SessionEvent) => RelayTerminalEvent;
  sendError: (clientId: string, sessionId: string, code: string, message: string) => void;
  deferLostError: (clientId: string, sessionId: string) => void;
};

export class SubscriptionHandler {
  constructor(private readonly options: SubscriptionHandlerOptions) {}

  async subscribeClient(
    clientId: string,
    sessionId: string,
    after: number,
    mode: 'control' | 'observe',
    tail?: number,
    cols?: number,
    rows?: number
  ): Promise<void> {
    const session = this.options.sessionCatalog.get(sessionId);
    if (!session) {
      this.options.sendError(clientId, sessionId, 'session_not_found', 'session not found');
      return;
    }
    const previousSubscription = this.options.subscriptions.get(clientId, sessionId);
    if (previousSubscription) {
      await previousSubscription.unsubscribe?.();
      this.options.subscriptions.delete(clientId, sessionId);
    }
    if (session.transport === 'pty-event-stream' && session.status !== 'running') {
      this.options.deferLostError(clientId, sessionId);
      return;
    }
    this.options.subscriptions.set(clientId, sessionId, { mode });
    if (session.transport === 'chat') {
      const catchupText = this.options.runnerForProvider(session.provider)?.getCatchup(sessionId);
      if (catchupText !== undefined) {
        this.options.relaySender.chatCatchup(clientId, sessionId, catchupText);
      }
      return;
    }
    if (isValidTerminalSize(cols, rows) && mode === 'control') {
      const nextCols = cols;
      const nextRows = Number(rows);
      const runnerClient = this.options.runnerClientForSession?.(session);
      if (runnerClient) {
        const resized = await runnerClient.resize(nextCols, nextRows, clientId).then(
          () => true,
          () => {
            this.options.sessionCatalog.markSessionLost(sessionId);
            return false;
          }
        );
        if (!resized) {
          this.options.subscriptions.delete(clientId, sessionId);
          this.options.deferLostError(clientId, sessionId);
          return;
        }
      } else {
        const ok = this.options.ptySessions?.resize(sessionId, clientId, nextCols, nextRows) ?? false;
        if (!ok) {
          this.options.sessionCatalog.markSessionLost(sessionId);
          this.options.subscriptions.delete(clientId, sessionId);
          this.options.deferLostError(clientId, sessionId);
          return;
        }
      }
    }

    let relayRecentOutputBuf = '';
    let relaySelectEmitted = false;
    let relaySelectDebounceTimer: NodeJS.Timeout | undefined;
    const detectAndEmitRelaySelect = (event: SessionEvent) => {
      if (
        event.type !== 'terminal.output' ||
        session.provider !== 'claude'
      ) {
        return;
      }
      if (relaySelectEmitted) {
        relaySelectEmitted = false;
      }
      const data = (event.payload as { data?: string }).data ?? '';
      relayRecentOutputBuf += data.replace(/\x1b\[[0-9;]*m/g, '');
      const bufLines = relayRecentOutputBuf.split('\n');
      if (bufLines.length > 50) {
        relayRecentOutputBuf = bufLines.slice(-50).join('\n');
      }
      clearTimeout(relaySelectDebounceTimer);
      relaySelectDebounceTimer = setTimeout(() => {
        if (relaySelectEmitted) {
          return;
        }
        const lines = relayRecentOutputBuf.split('\n');
        const matchedOptions = detectSelectOptions(lines);
        if (!matchedOptions) {
          return;
        }
        const subSession = this.options.sessionCatalog.get(session.id);
        if (!subSession) {
          return;
        }
        const raw = lines.filter((line) => /^\s*\d+\.\s+/.test(line)).join('\n');
        const selectEvent = createSessionEvent(subSession.id, 'agent.select', {
          options: matchedOptions,
          raw
        });
        this.options.relaySender.event(this.options.toRelayEvent(selectEvent));
        relaySelectEmitted = true;
      }, 300);
    };

    const replayCursor = this.replayEvents(clientId, sessionId, after, tail);

    const runnerClient = this.options.runnerClientForSession?.(session);
    let unsubscribe: (() => void | Promise<void>) | undefined;
    if (runnerClient) {
      try {
        unsubscribe = await runnerClient.subscribeEvents((frame) => {
          this.options.relaySender.event(this.options.toRelayEvent(frame.event));
          detectAndEmitRelaySelect(frame.event);
        }, replayCursor);
      } catch {
        this.options.sessionCatalog.markSessionLost(sessionId);
        this.options.subscriptions.delete(clientId, sessionId);
        this.options.deferLostError(clientId, sessionId);
        return;
      }
    } else {
      unsubscribe = this.options.ptySessions?.subscribe(sessionId, (event) => {
        this.options.relaySender.event(this.options.toRelayEvent(event));
        detectAndEmitRelaySelect(event);
      });
    }
    const wrappedUnsubscribe = async () => {
      clearTimeout(relaySelectDebounceTimer);
      await unsubscribe?.();
    };
    this.options.subscriptions.set(clientId, sessionId, { mode, unsubscribe: wrappedUnsubscribe });
  }

  async removeSubscription(clientId: string, sessionId: string): Promise<void> {
    await this.options.subscriptions.remove(clientId, sessionId);
  }

  async clearSubscriptions(): Promise<void> {
    await this.options.subscriptions.clear();
  }

  private replayEvents(clientId: string, sessionId: string, after: number, tail?: number): number {
    const events = this.options.ptySessions?.eventsAfter(sessionId, after, tail).map(this.options.toRelayEvent) ?? [];
    const latestEventId = events.at(-1)?.id ?? after;
    this.options.relaySender.replay(clientId, sessionId, events, latestEventId);
    return latestEventId;
  }
}
