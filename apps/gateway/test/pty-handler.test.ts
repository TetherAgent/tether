import assert from 'node:assert/strict';
import test from 'node:test';
import { PtyHandler } from '../src/relay/pty-handler.js';
import { SubscriptionManager } from '../src/relay/subscription-manager.js';
import type { Session, SessionEvent } from '../src/types.js';
import type { RelayServerToGatewayFrame } from '@tether/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: 'sess_001',
    provider: 'shell',
    title: 'Shell',
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

type ErrorCapture = { clientId: string; sessionId: string; code: string; message: string };
type SentFrame = { type: string; [k: string]: unknown };

function makeSender() {
  const frames: SentFrame[] = [];
  return {
    frames,
    error: (clientId: string | undefined, sessionId: string | undefined, code: string, message: string, clientRequestId?: string) => {
      frames.push({ type: 'gateway.error', clientId, sessionId, code, message, clientRequestId });
    },
    sessionCreated: (clientId: string, sessionId: string, clientRequestId?: string) => {
      frames.push({ type: 'gateway.session-created', clientId, sessionId, clientRequestId });
    },
    localTerminalOpened: (clientId: string, clientRequestId: string, provider: string) => {
      frames.push({ type: 'gateway.local-terminal-opened', clientId, clientRequestId, provider });
    },
    sessions: () => { frames.push({ type: 'gateway.sessions' }); },
    event: () => {},
    chatCatchup: () => {},
    replay: () => {},
    chatSessionCreated: () => {}
  };
}

function makeOptions(overrides: {
  session?: Session;
  subscriptionMode?: 'control' | 'observe';
  noSubscription?: boolean;
  noSession?: boolean;
  runnerWrite?: () => Promise<void>;
  runnerResize?: () => Promise<void>;
  runnerStop?: () => Promise<void>;
  noRunner?: boolean;
  ptyWrite?: () => boolean;
  ptyResize?: () => boolean;
  ptyStop?: () => boolean;
  onNewPtySession?: PtyHandler extends { handleNewSession: infer _; } ? never : never;
  markLost?: (id: string) => void;
  sendSessions?: () => void;
} = {}) {
  const subscriptions = new SubscriptionManager();
  const session = overrides.session ?? makeSession();
  const errors: ErrorCapture[] = [];
  const emitted: SessionEvent[] = [];
  const lostIds: string[] = [];
  const sender = makeSender();
  const sessionsSent: unknown[] = [];

  if (!overrides.noSubscription) {
    subscriptions.set('c1', session.id, { mode: overrides.subscriptionMode ?? 'control' });
  }

  const sessionCatalog = {
    get: (id: string) => (overrides.noSession ? undefined : id === session.id ? session : undefined),
    markSessionLost: (id: string) => {
      overrides.markLost?.(id);
      lostIds.push(id);
    }
  };

  const runnerClient = overrides.noRunner ? undefined : {
    write: overrides.runnerWrite ?? (() => Promise.resolve()),
    resize: overrides.runnerResize ?? (() => Promise.resolve()),
    stop: overrides.runnerStop ?? (() => Promise.resolve())
  };

  const ptySessions = {
    write: overrides.ptyWrite ?? (() => true),
    resize: overrides.ptyResize ?? (() => true),
    stop: overrides.ptyStop ?? (() => true)
  };

  const options = {
    relaySender: sender as never,
    sessionCatalog: sessionCatalog as never,
    subscriptions,
    ptySessions: ptySessions as never,
    runnerClientForSession: runnerClient ? () => runnerClient as never : undefined,
    sendSessions: overrides.sendSessions ?? (() => { sessionsSent.push(true); }),
    sendError: (clientId: string, sessionId: string, code: string, message: string) => {
      errors.push({ clientId, sessionId, code, message });
    }
  };

  return { options, errors, emitted, lostIds, sender, sessionsSent, session, subscriptions };
}

// ---------------------------------------------------------------------------
// writeInput
// ---------------------------------------------------------------------------

test('writeInput: not subscribed → not_subscribed error', async () => {
  const { options, errors } = makeOptions({ noSubscription: true });
  const handler = new PtyHandler(options);
  await handler.writeInput('c1', 'sess_001', 'ls\n');
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'not_subscribed');
});

test('writeInput: observe mode → observe_only error', async () => {
  const { options, errors } = makeOptions({ subscriptionMode: 'observe' });
  const handler = new PtyHandler(options);
  await handler.writeInput('c1', 'sess_001', 'ls\n');
  assert.equal(errors[0]!.code, 'observe_only');
});

test('writeInput: runnerClient.write success → no error', async () => {
  const { options, errors } = makeOptions({ runnerWrite: () => Promise.resolve() });
  const handler = new PtyHandler(options);
  await handler.writeInput('c1', 'sess_001', 'echo hi\n');
  assert.equal(errors.length, 0);
});

test('writeInput: runnerClient.write throws → session_lost error and markSessionLost', async () => {
  const { options, errors, lostIds } = makeOptions({
    runnerWrite: () => Promise.reject(new Error('socket closed'))
  });
  const handler = new PtyHandler(options);
  await handler.writeInput('c1', 'sess_001', 'bad\n');
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

test('writeInput: no runner, ptySessions.write false → session_lost', async () => {
  const { options, errors, lostIds } = makeOptions({
    noRunner: true,
    ptyWrite: () => false
  });
  const handler = new PtyHandler(options);
  await handler.writeInput('c1', 'sess_001', 'data');
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

// ---------------------------------------------------------------------------
// resizePty
// ---------------------------------------------------------------------------

test('resizePty: bad dimensions (0,0) → bad_resize error', async () => {
  const { options, errors } = makeOptions();
  const handler = new PtyHandler(options);
  await handler.resizePty('c1', 'sess_001', 0, 0);
  assert.equal(errors[0]!.code, 'bad_resize');
});

test('resizePty: negative dimensions → bad_resize error', async () => {
  const { options, errors } = makeOptions();
  const handler = new PtyHandler(options);
  await handler.resizePty('c1', 'sess_001', -1, 24);
  assert.equal(errors[0]!.code, 'bad_resize');
});

test('resizePty: runnerClient.resize success → no error', async () => {
  const { options, errors } = makeOptions({ runnerResize: () => Promise.resolve() });
  const handler = new PtyHandler(options);
  await handler.resizePty('c1', 'sess_001', 80, 24);
  assert.equal(errors.length, 0);
});

test('resizePty: runnerClient.resize throws → session_lost', async () => {
  const { options, errors, lostIds } = makeOptions({
    runnerResize: () => Promise.reject(new Error('fail'))
  });
  const handler = new PtyHandler(options);
  await handler.resizePty('c1', 'sess_001', 80, 24);
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

test('resizePty: no runner, ptySessions.resize false → session_lost', async () => {
  const { options, errors, lostIds } = makeOptions({
    noRunner: true,
    ptyResize: () => false
  });
  const handler = new PtyHandler(options);
  await handler.resizePty('c1', 'sess_001', 80, 24);
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

// ---------------------------------------------------------------------------
// stopPty
// ---------------------------------------------------------------------------

test('stopPty: observe mode → observe_only error', async () => {
  const { options, errors } = makeOptions({ subscriptionMode: 'observe' });
  const handler = new PtyHandler(options);
  await handler.stopPty('c1', 'sess_001');
  assert.equal(errors[0]!.code, 'observe_only');
});

test('stopPty: runnerClient.stop success → no error', async () => {
  const { options, errors } = makeOptions({ runnerStop: () => Promise.resolve() });
  const handler = new PtyHandler(options);
  await handler.stopPty('c1', 'sess_001');
  assert.equal(errors.length, 0);
});

test('stopPty: runnerClient.stop throws → session_lost', async () => {
  const { options, errors, lostIds } = makeOptions({
    runnerStop: () => Promise.reject(new Error('dead'))
  });
  const handler = new PtyHandler(options);
  await handler.stopPty('c1', 'sess_001');
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

test('stopPty: no runner, ptySessions.stop false → session_lost + markSessionLost', async () => {
  const { options, errors, lostIds } = makeOptions({
    noRunner: true,
    ptyStop: () => false
  });
  const handler = new PtyHandler(options);
  await handler.stopPty('c1', 'sess_001');
  assert.equal(errors[0]!.code, 'session_lost');
  assert.ok(lostIds.includes('sess_001'));
});

// ---------------------------------------------------------------------------
// handleNewSession
// ---------------------------------------------------------------------------

function makeNewSessionFrame(overrides: Partial<Extract<RelayServerToGatewayFrame, { type: 'client.new-pty-session' }>> = {}): Extract<RelayServerToGatewayFrame, { type: 'client.new-pty-session' }> {
  return {
    type: 'client.new-pty-session',
    clientId: 'c1',
    provider: 'shell',
    launchMode: 'background',
    clientRequestId: 'req_001',
    ...overrides
  } as never;
}

test('handleNewSession: no onNewPtySession handler → session_create_not_supported error', async () => {
  const { options, sender } = makeOptions();
  const noHandlerOptions = { ...options, onNewPtySession: undefined };
  const handler = new PtyHandler(noHandlerOptions);
  handler.handleNewSession(makeNewSessionFrame());
  await new Promise(r => setTimeout(r, 10));
  const error = sender.frames.find(f => f.type === 'gateway.error');
  assert.ok(error !== undefined);
  assert.equal(error.code, 'session_create_not_supported');
});

test('handleNewSession: background launch → sessionCreated + sendSessions', async () => {
  const sessionsSent: unknown[] = [];
  const { options, sender } = makeOptions({ sendSessions: () => { sessionsSent.push(true); } });
  const handlerOptions = {
    ...options,
    onNewPtySession: async () => ({ launchMode: 'background' as const, sessionId: 'new_sess' })
  };
  const handler = new PtyHandler(handlerOptions);
  handler.handleNewSession(makeNewSessionFrame({ launchMode: 'background' }));
  await new Promise(r => setTimeout(r, 20));

  const created = sender.frames.find(f => f.type === 'gateway.session-created');
  assert.ok(created !== undefined);
  assert.equal(created.sessionId, 'new_sess');
  assert.ok(sessionsSent.length > 0);
});

test('handleNewSession: local-terminal launch → localTerminalOpened', async () => {
  const { options, sender } = makeOptions();
  const handlerOptions = {
    ...options,
    onNewPtySession: async () => ({ launchMode: 'local-terminal' as const, provider: 'shell' as const })
  };
  const handler = new PtyHandler(handlerOptions);
  handler.handleNewSession(makeNewSessionFrame({ launchMode: 'local-terminal', clientRequestId: 'req_lt' }));
  await new Promise(r => setTimeout(r, 20));

  const opened = sender.frames.find(f => f.type === 'gateway.local-terminal-opened');
  assert.ok(opened !== undefined);
  assert.equal(opened.clientRequestId, 'req_lt');
  assert.equal(opened.provider, 'shell');
});

test('handleNewSession: handler throws → session_create_failed error', async () => {
  const { options, sender } = makeOptions();
  const handlerOptions = {
    ...options,
    onNewPtySession: async () => { throw new Error('spawn failed'); }
  };
  const handler = new PtyHandler(handlerOptions);
  handler.handleNewSession(makeNewSessionFrame());
  await new Promise(r => setTimeout(r, 20));

  const error = sender.frames.find(f => f.type === 'gateway.error');
  assert.ok(error !== undefined);
  assert.equal(error.code, 'session_create_failed');
  assert.ok((error.message as string).includes('spawn failed'));
});
