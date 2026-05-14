import assert from 'node:assert/strict';
import test from 'node:test';
import { SubscriptionManager, SubscriptionHandler } from '../src/relay/subscription-manager.js';
import type { Session, SessionEvent } from '../src/types.js';
import type { RelayTerminalEvent } from '@tether/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: 'sess_001',
    provider: 'shell',
    title: 'Test',
    projectPath: '/proj',
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/sh',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    ...overrides
  };
}

function makeReplaySender() {
  const replays: unknown[] = [];
  const errors: unknown[] = [];
  const catchups: unknown[] = [];
  return {
    replays, errors, catchups,
    replay: (clientId: string, sessionId: string, events: RelayTerminalEvent[], latestEventId: number) => {
      replays.push({ clientId, sessionId, events, latestEventId });
    },
    error: () => {},
    chatCatchup: (clientId: string, sessionId: string, text: string) => {
      catchups.push({ clientId, sessionId, text });
    },
    event: () => {},
    sessions: () => {},
    sessionCreated: () => {},
    localTerminalOpened: () => {},
    chatSessionCreated: () => {},
  };
}

// ---------------------------------------------------------------------------
// SubscriptionManager unit tests
// ---------------------------------------------------------------------------

test('SubscriptionManager: get returns undefined for unset key', () => {
  const mgr = new SubscriptionManager();
  assert.equal(mgr.get('c1', 's1'), undefined);
});

test('SubscriptionManager: set and get round-trip', () => {
  const mgr = new SubscriptionManager();
  mgr.set('c1', 's1', { mode: 'control' });
  assert.deepEqual(mgr.get('c1', 's1'), { mode: 'control' });
});

test('SubscriptionManager: delete removes entry', () => {
  const mgr = new SubscriptionManager();
  mgr.set('c1', 's1', { mode: 'observe' });
  mgr.delete('c1', 's1');
  assert.equal(mgr.get('c1', 's1'), undefined);
});

test('SubscriptionManager: remove calls unsubscribe and removes entry', async () => {
  const mgr = new SubscriptionManager();
  let unsub = false;
  mgr.set('c1', 's1', { mode: 'control', unsubscribe: async () => { unsub = true; } });
  await mgr.remove('c1', 's1');
  assert.equal(unsub, true);
  assert.equal(mgr.get('c1', 's1'), undefined);
});

test('SubscriptionManager: clear calls all unsubscribes and empties map', async () => {
  const mgr = new SubscriptionManager();
  const unsubbed: string[] = [];
  mgr.set('c1', 's1', { mode: 'control', unsubscribe: async () => { unsubbed.push('c1:s1'); } });
  mgr.set('c2', 's2', { mode: 'observe', unsubscribe: async () => { unsubbed.push('c2:s2'); } });
  await mgr.clear();
  assert.ok(unsubbed.includes('c1:s1'));
  assert.ok(unsubbed.includes('c2:s2'));
  assert.equal(mgr.get('c1', 's1'), undefined);
  assert.equal(mgr.get('c2', 's2'), undefined);
});

test('SubscriptionManager: keys are scoped per client+session pair', () => {
  const mgr = new SubscriptionManager();
  mgr.set('c1', 's1', { mode: 'control' });
  mgr.set('c1', 's2', { mode: 'observe' });
  mgr.set('c2', 's1', { mode: 'observe' });
  assert.equal(mgr.get('c1', 's1')!.mode, 'control');
  assert.equal(mgr.get('c1', 's2')!.mode, 'observe');
  assert.equal(mgr.get('c2', 's1')!.mode, 'observe');
});

// ---------------------------------------------------------------------------
// requireControlSession
// ---------------------------------------------------------------------------

test('requireControlSession: session not found → session_not_found', () => {
  const mgr = new SubscriptionManager();
  const result = mgr.requireControlSession('c1', 'missing', () => undefined);
  assert.equal(result.ok, false);
  assert.equal((result as { error: { code: string } }).error.code, 'session_not_found');
});

test('requireControlSession: not subscribed → not_subscribed', () => {
  const mgr = new SubscriptionManager();
  const session = makeSession();
  const result = mgr.requireControlSession('c1', session.id, () => session);
  assert.equal(result.ok, false);
  assert.equal((result as { error: { code: string } }).error.code, 'not_subscribed');
});

test('requireControlSession: observe mode → observe_only', () => {
  const mgr = new SubscriptionManager();
  const session = makeSession();
  mgr.set('c1', session.id, { mode: 'observe' });
  const result = mgr.requireControlSession('c1', session.id, () => session);
  assert.equal(result.ok, false);
  assert.equal((result as { error: { code: string } }).error.code, 'observe_only');
});

test('requireControlSession: control mode → ok with session', () => {
  const mgr = new SubscriptionManager();
  const session = makeSession();
  mgr.set('c1', session.id, { mode: 'control' });
  const result = mgr.requireControlSession('c1', session.id, () => session);
  assert.equal(result.ok, true);
  assert.deepEqual((result as { session: Session }).session, session);
});

// ---------------------------------------------------------------------------
// SubscriptionHandler.subscribeClient
// ---------------------------------------------------------------------------

function makeHandlerOptions(overrides: Record<string, unknown> = {}) {
  const subscriptions = new SubscriptionManager();
  const errors: Array<{ clientId: string; code: string }> = [];
  const deferred: string[] = [];
  const replaySender = makeReplaySender();

  const sessions = new Map<string, Session>();
  const sessionCatalog = {
    get: (id: string) => sessions.get(id),
    markSessionLost: () => {}
  };

  const options = {
    sessionCatalog: sessionCatalog as never,
    subscriptions,
    relaySender: replaySender as never,
    ptySessions: {
      eventsAfter: () => [],
      subscribe: () => () => {},
      resize: () => true
    } as never,
    runnerClientForSession: undefined as never,
    runnerForProvider: () => undefined,
    toRelayEvent: (e: SessionEvent) => ({ ...e, type: e.type }) as never,
    sendError: (clientId: string, sessionId: string, code: string, message: string) => {
      errors.push({ clientId, sessionId, code, message } as never);
    },
    deferLostError: (clientId: string, sessionId: string) => { deferred.push(`${clientId}:${sessionId}`); },
    ...overrides
  };

  return { options, subscriptions, sessions, errors, deferred, replaySender };
}

test('subscribeClient: session not found sends session_not_found error', async () => {
  const { options, errors } = makeHandlerOptions();
  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 'missing', 0, 'control');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'session_not_found');
});

test('subscribeClient: pty session not running defers lost error', async () => {
  const { options, sessions, deferred } = makeHandlerOptions();
  sessions.set('s1', makeSession({ id: 's1', status: 'lost', transport: 'pty-event-stream' }));
  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 's1', 0, 'control');
  assert.ok(deferred.includes('c1:s1'));
});

test('subscribeClient: chat session sends catchup text', async () => {
  const { options, sessions, replaySender } = makeHandlerOptions({
    runnerForProvider: () => ({ getCatchup: () => 'catchup text' } as never)
  });
  sessions.set('s1', makeSession({ id: 's1', transport: 'chat', provider: 'claude' }));
  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 's1', 0, 'control');
  assert.equal(replaySender.catchups.length, 1);
  assert.equal((replaySender.catchups[0] as { text: string }).text, 'catchup text');
});

test('subscribeClient: chat session with no catchup does not crash', async () => {
  const { options, sessions } = makeHandlerOptions({
    runnerForProvider: () => ({ getCatchup: () => undefined } as never)
  });
  sessions.set('s1', makeSession({ id: 's1', transport: 'chat', provider: 'claude' }));
  const handler = new SubscriptionHandler(options);
  await assert.doesNotReject(() => handler.subscribeClient('c1', 's1', 0, 'observe'));
});

test('subscribeClient: duplicate subscribe calls previous unsubscribe', async () => {
  const { options, subscriptions, sessions } = makeHandlerOptions();
  let unsubCalled = false;
  sessions.set('s1', makeSession({ id: 's1', transport: 'chat' }));
  subscriptions.set('c1', 's1', { mode: 'observe', unsubscribe: async () => { unsubCalled = true; } });

  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 's1', 0, 'control');
  assert.equal(unsubCalled, true);
});

test('subscribeClient: sets subscription in control mode for pty session', async () => {
  const { options, subscriptions, sessions } = makeHandlerOptions();
  sessions.set('s1', makeSession({ id: 's1', transport: 'pty-event-stream', status: 'running' }));
  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 's1', 0, 'control');
  assert.equal(subscriptions.get('c1', 's1')?.mode, 'control');
});

test('subscribeClient: resize failure marks session lost and defers error', async () => {
  const lostIds: string[] = [];
  const { options, sessions, deferred } = makeHandlerOptions({
    ptySessions: {
      eventsAfter: () => [],
      subscribe: () => () => {},
      resize: () => false
    } as never,
    sessionCatalog: {
      get: (id: string) => sessions.get(id),
      markSessionLost: (id: string) => { lostIds.push(id); }
    } as never
  });

  sessions.set('s1', makeSession({ id: 's1', transport: 'pty-event-stream', status: 'running' }));

  const handler = new SubscriptionHandler(options);
  await handler.subscribeClient('c1', 's1', 0, 'control', undefined, 80, 24);

  assert.ok(lostIds.includes('s1'));
  assert.ok(deferred.includes('c1:s1'));
});

// ---------------------------------------------------------------------------
// removeSubscription / clearSubscriptions
// ---------------------------------------------------------------------------

test('removeSubscription: calls remove on subscriptions', async () => {
  const { options, subscriptions } = makeHandlerOptions();
  let unsub = false;
  subscriptions.set('c1', 's1', { mode: 'control', unsubscribe: async () => { unsub = true; } });

  const handler = new SubscriptionHandler(options);
  await handler.removeSubscription('c1', 's1');
  assert.equal(unsub, true);
  assert.equal(subscriptions.get('c1', 's1'), undefined);
});

test('clearSubscriptions: clears all subscriptions', async () => {
  const { options, subscriptions } = makeHandlerOptions();
  const unsubbed: string[] = [];
  subscriptions.set('c1', 's1', { mode: 'control', unsubscribe: async () => { unsubbed.push('c1:s1'); } });
  subscriptions.set('c2', 's2', { mode: 'observe', unsubscribe: async () => { unsubbed.push('c2:s2'); } });

  const handler = new SubscriptionHandler(options);
  await handler.clearSubscriptions();
  assert.equal(unsubbed.length, 2);
  assert.equal(subscriptions.get('c1', 's1'), undefined);
});
