import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatHandler } from '../src/relay/chat-handler.js';
import { ChatSessionRegistry } from '../src/chat/chat-session-registry.js';
import type { IChatRunner } from '../src/chat/chat-session-runner.js';
import type { TrustedChatSessionMetadata } from '@tether/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SentEvent = { id: number; sessionId: string; type: string; payload: Record<string, unknown> };
type SentError = { clientId: string; sessionId: string; code: string; message: string };

function makeSender() {
  const events: SentEvent[] = [];
  const errors: SentError[] = [];
  return {
    events,
    errors,
    event: (e: SentEvent) => { events.push(e); },
    error: (clientId: string, sessionId: string, code: string, message: string) => {
      errors.push({ clientId, sessionId, code, message });
    }
  };
}

function makeChatMeta(overrides: Partial<TrustedChatSessionMetadata> = {}): TrustedChatSessionMetadata {
  return {
    id: 'sess_001',
    provider: 'claude',
    title: 'Test',
    projectPath: '/proj',
    accountId: 'acct_1',
    userId: 'user_1',
    gatewayId: 'gw_1',
    transport: 'chat' as const,
    agentSessionId: undefined,
    ...overrides
  };
}

function makeRunner(overrides: {
  run?: () => Promise<void>;
  respondToPermission?: (sessionId: string, requestId: string, decision: 'allow' | 'deny') => void;
} = {}): IChatRunner {
  const runCalls: unknown[][] = [];
  const permissionCalls: unknown[][] = [];
  return {
    run: (params: Parameters<IChatRunner['run']>[0]) => {
      runCalls.push([params]);
      return overrides.run ? overrides.run() : Promise.resolve();
    },
    getCatchup: () => undefined,
    kill: () => {},
    respondToPermission: (sessionId: string, requestId: string, decision: 'allow' | 'deny') => {
      permissionCalls.push([sessionId, requestId, decision]);
      overrides.respondToPermission?.(sessionId, requestId, decision);
    },
    _runCalls: runCalls,
    _permissionCalls: permissionCalls
  } as never;
}

function makeOptions(overrides: {
  chatRegistry?: ChatSessionRegistry;
  sender?: ReturnType<typeof makeSender>;
  runnerForProvider?: (p: string) => IChatRunner | undefined;
  subscription?: { clientId: string; sessionId: string } | null;
  catalogSession?: { id: string; provider: string } | null;
  sendError?: (clientId: string, sessionId: string, code: string, message: string) => void;
} = {}) {
  const chatRegistry = overrides.chatRegistry ?? new ChatSessionRegistry();
  const sender = overrides.sender ?? makeSender();
  const errors: SentError[] = [];
  const sendError = overrides.sendError ?? ((clientId, sessionId, code, message) => {
    errors.push({ clientId, sessionId, code, message });
  });

  const subscriptions = {
    get: (clientId: string, sessionId: string) => {
      if (overrides.subscription === null) return undefined;
      const sub = overrides.subscription ?? { clientId: 'c1', sessionId: 'sess_001' };
      return clientId === sub.clientId && sessionId === sub.sessionId
        ? { mode: 'control' as const }
        : undefined;
    }
  };

  const catalogSessionObj = overrides.catalogSession === null
    ? undefined
    : (overrides.catalogSession ?? { id: 'sess_001', provider: 'claude' });

  const sessionCatalog = {
    get: (id: string) => catalogSessionObj?.id === id ? catalogSessionObj : undefined
  };

  const handler = new ChatHandler({
    chatRegistry,
    relaySender: sender as never,
    sessionCatalog: sessionCatalog as never,
    subscriptions: subscriptions as never,
    runnerForProvider: overrides.runnerForProvider ?? (() => undefined),
    sendError
  });

  return { handler, chatRegistry, sender, errors };
}

// ---------------------------------------------------------------------------
// handleChat — new session (sessionId=null)
// ---------------------------------------------------------------------------

test('handleChat: sessionId=null, provider not supported → error(provider_not_supported)', () => {
  const { handler, sender } = makeOptions({ runnerForProvider: () => undefined });
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: null,
    provider: 'unknown',
    model: 'default',
    cwd: '/proj',
    message: 'hello',
    accountId: 'acct_1',
    userId: 'user_1',
    session: null
  } as never);
  assert.equal(sender.errors.length, 1);
  assert.equal(sender.errors[0]!.code, 'provider_not_supported');
});

test('handleChat: sessionId=null, provider supported → runner.run is called', async () => {
  let runCalled = false;
  const runner = makeRunner({ run: async () => { runCalled = true; } });
  const { handler } = makeOptions({ runnerForProvider: () => runner });
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: null,
    provider: 'claude',
    model: 'default',
    cwd: '/proj',
    message: 'hello',
    accountId: 'acct_1',
    userId: 'user_1',
    session: null
  } as never);
  // run is called as void promise; wait a tick for it to execute
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runCalled, true);
});

// ---------------------------------------------------------------------------
// handleChat — existing session (sessionId non-null)
// ---------------------------------------------------------------------------

test('handleChat: sessionId set and in-flight → sendError(chat_in_progress)', () => {
  const chatRegistry = new ChatSessionRegistry();
  chatRegistry.upsertFromMetadata(makeChatMeta({ id: 'sess_001' }));
  chatRegistry.markInFlight('sess_001');

  const { handler, errors } = makeOptions({ chatRegistry });
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: 'sess_001',
    provider: 'claude',
    model: 'default',
    message: 'hello',
    session: makeChatMeta({ id: 'sess_001' })
  } as never);

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'chat_in_progress');
});

test('handleChat: sessionId set, not in-flight, no session metadata → error(missing_session_metadata)', () => {
  const { handler, sender } = makeOptions();
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: 'sess_001',
    provider: 'claude',
    model: 'default',
    message: 'hello',
    session: null
  } as never);

  assert.equal(sender.errors.length, 1);
  assert.equal(sender.errors[0]!.code, 'missing_session_metadata');
});

test('handleChat: existing session, provider not supported → error(provider_not_supported)', () => {
  const { handler, sender } = makeOptions({ runnerForProvider: () => undefined });
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: 'sess_001',
    provider: 'claude',
    model: 'default',
    message: 'hello',
    session: makeChatMeta({ id: 'sess_001' })
  } as never);

  assert.equal(sender.errors.length, 1);
  assert.equal(sender.errors[0]!.code, 'provider_not_supported');
});

test('handleChat: existing session, normal → upsertFromMetadata + markInFlight + runner.run', async () => {
  let runCalled = false;
  const runner = makeRunner({ run: async () => { runCalled = true; } });
  const chatRegistry = new ChatSessionRegistry();
  const { handler } = makeOptions({ chatRegistry, runnerForProvider: () => runner });

  const meta = makeChatMeta({ id: 'sess_002' });
  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: 'sess_002',
    provider: 'claude',
    model: 'default',
    message: 'hi',
    session: meta
  } as never);

  // session should be in registry after upsert
  assert.ok(chatRegistry.get('sess_002') !== undefined);
  // should be marked in-flight
  assert.equal(chatRegistry.isInFlight('sess_002'), true);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runCalled, true);
});

test('handleChat: runner.run throws → releaseInFlight + sendError(chat_runner_failed)', async () => {
  const runner = makeRunner({ run: async () => { throw new Error('boom'); } });
  const chatRegistry = new ChatSessionRegistry();
  const { handler, errors } = makeOptions({ chatRegistry, runnerForProvider: () => runner });

  handler.handleChat({
    type: 'client.chat',
    clientId: 'c1',
    sessionId: 'sess_003',
    provider: 'claude',
    model: 'default',
    message: 'hi',
    session: makeChatMeta({ id: 'sess_003' })
  } as never);

  // wait for catch handler to fire
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(chatRegistry.isInFlight('sess_003'), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'chat_runner_failed');
});

// ---------------------------------------------------------------------------
// handlePermissionResponse
// ---------------------------------------------------------------------------

test('handlePermissionResponse: not subscribed → sendError(not_subscribed)', () => {
  const { handler, errors } = makeOptions({ subscription: null });
  handler.handlePermissionResponse({
    type: 'client.permission_response',
    clientId: 'c1',
    sessionId: 'sess_001',
    requestId: 'req_1',
    decision: 'allow'
  } as never);

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'not_subscribed');
});

test('handlePermissionResponse: subscribed, session not found → sendError(session_not_found)', () => {
  const { handler, errors } = makeOptions({
    subscription: { clientId: 'c1', sessionId: 'sess_001' },
    catalogSession: null
  });
  handler.handlePermissionResponse({
    type: 'client.permission_response',
    clientId: 'c1',
    sessionId: 'sess_001',
    requestId: 'req_1',
    decision: 'allow'
  } as never);

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'session_not_found');
});

test('handlePermissionResponse: subscribed and session found → runner.respondToPermission called', () => {
  const permCalls: Array<[string, string, string]> = [];
  const runner = makeRunner({
    respondToPermission: (sessionId, requestId, decision) => {
      permCalls.push([sessionId, requestId, decision]);
    }
  });

  const { handler } = makeOptions({
    subscription: { clientId: 'c1', sessionId: 'sess_001' },
    catalogSession: { id: 'sess_001', provider: 'claude' },
    runnerForProvider: () => runner
  });

  handler.handlePermissionResponse({
    type: 'client.permission_response',
    clientId: 'c1',
    sessionId: 'sess_001',
    requestId: 'req_42',
    decision: 'deny'
  } as never);

  assert.equal(permCalls.length, 1);
  assert.deepEqual(permCalls[0], ['sess_001', 'req_42', 'deny']);
});

// ---------------------------------------------------------------------------
// sendProviders / sendCwdSuggestions
// ---------------------------------------------------------------------------

test('sendProviders: emits gateway.providers event via relaySender.event', async () => {
  const { handler, sender } = makeOptions();
  await handler.sendProviders('c1');

  assert.equal(sender.events.length, 1);
  assert.equal(sender.events[0]!.type, 'gateway.providers');
  assert.equal((sender.events[0]!.payload as { clientId: string }).clientId, 'c1');
  assert.ok(Array.isArray((sender.events[0]!.payload as { providers: unknown[] }).providers));
});

test('sendCwdSuggestions: emits gateway.cwd-suggestions event via relaySender.event', async () => {
  const { handler, sender } = makeOptions();
  await handler.sendCwdSuggestions('c1', '/tmp');

  assert.equal(sender.events.length, 1);
  assert.equal(sender.events[0]!.type, 'gateway.cwd-suggestions');
  const payload = sender.events[0]!.payload as { clientId: string; cwd: string; suggestions: unknown[] };
  assert.equal(payload.clientId, 'c1');
  assert.equal(payload.cwd, '/tmp');
  assert.ok(Array.isArray(payload.suggestions));
});
