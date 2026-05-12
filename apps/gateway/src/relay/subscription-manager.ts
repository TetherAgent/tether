import type { Session } from '../types.js';

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

  clear(): void {
    for (const subscription of this.subscriptions.values()) {
      void subscription.unsubscribe?.();
    }
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
