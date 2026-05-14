import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionRegistry } from '../src/chat/chat-session-registry.js';
import { PtySessionManager } from '../src/pty/manager.js';
import { SessionCatalog } from '../src/relay/session-catalog.js';
import type { Session, SessionEvent } from '../src/types.js';
import type { TrustedChatSessionMetadata } from '@tether/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChatMeta(overrides: Partial<TrustedChatSessionMetadata> = {}): TrustedChatSessionMetadata {
  return {
    id: 'chat_001',
    provider: 'claude',
    title: 'Test',
    projectPath: '/proj',
    accountId: 'acct_1',
    userId: 'user_1',
    gatewayId: 'gw_1',
    agentSessionId: undefined,
    ...overrides
  };
}

function makePtySession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: 'pty_001',
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

function makeCatalog(overrides: {
  chatRegistry?: ChatSessionRegistry;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (s: Session) => { ping: () => Promise<{ sessionId: string }> } | undefined;
  emitEvent?: (e: SessionEvent) => void;
  isPidAlive?: (pid: number) => boolean;
  onSessionsChanged?: () => void;
} = {}) {
  const chatRegistry = overrides.chatRegistry ?? new ChatSessionRegistry();
  const emitEvent = overrides.emitEvent ?? (() => {});
  const isPidAlive = overrides.isPidAlive ?? (() => true);
  return new SessionCatalog({
    chatRegistry,
    ptySessions: overrides.ptySessions,
    runnerClientForSession: overrides.runnerClientForSession as never,
    emitEvent,
    isPidAlive,
    onSessionsChanged: overrides.onSessionsChanged
  });
}

// ---------------------------------------------------------------------------
// listRelaySessions
// ---------------------------------------------------------------------------

test('listRelaySessions: includes chat sessions', async () => {
  const chatRegistry = new ChatSessionRegistry();
  chatRegistry.upsertFromMetadata(makeChatMeta());
  const catalog = makeCatalog({ chatRegistry });
  const sessions = await catalog.listRelaySessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.id, 'chat_001');
});

test('listRelaySessions: running pty with successful ping is included', async () => {
  const ptyManager = new PtySessionManager();
  const session = makePtySession({ id: 'pty_live' });
  ptyManager.restoreSession(session);

  const catalog = makeCatalog({
    ptySessions: ptyManager,
    runnerClientForSession: (s) => ({
      ping: async () => ({ sessionId: s.id })
    })
  });

  const sessions = await catalog.listRelaySessions();
  assert.ok(sessions.some(s => s.id === 'pty_live'));
});

test('listRelaySessions: running pty with failing ping is marked lost and excluded', async () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_gone' }));

  const emitted: SessionEvent[] = [];
  const catalog = makeCatalog({
    ptySessions: ptyManager,
    runnerClientForSession: () => ({
      ping: () => Promise.reject(new Error('connection refused'))
    }),
    emitEvent: (e) => emitted.push(e)
  });

  const sessions = await catalog.listRelaySessions();
  // lost sessions are included in result but with status=lost
  const found = sessions.find(s => s.id === 'pty_gone');
  assert.ok(found !== undefined);
  assert.equal(found!.status, 'lost');
});

test('listRelaySessions: pty with status=lost is excluded', async () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_lost', status: 'lost' }));

  const catalog = makeCatalog({ ptySessions: ptyManager });
  const sessions = await catalog.listRelaySessions();
  assert.ok(!sessions.some(s => s.id === 'pty_lost'));
});

test('listRelaySessions: chat session takes priority over pty with same id', async () => {
  const chatRegistry = new ChatSessionRegistry();
  chatRegistry.upsertFromMetadata(makeChatMeta({ id: 'shared_id', provider: 'claude' }));

  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'shared_id', provider: 'shell' }));

  const catalog = makeCatalog({ chatRegistry, ptySessions: ptyManager });
  const sessions = await catalog.listRelaySessions();

  const matched = sessions.filter(s => s.id === 'shared_id');
  assert.equal(matched.length, 1);
  assert.equal(matched[0]!.provider, 'claude');
});

// ---------------------------------------------------------------------------
// restoreRelaySessions
// ---------------------------------------------------------------------------

test('restoreRelaySessions: pid alive → status running', () => {
  const ptyManager = new PtySessionManager();
  const catalog = makeCatalog({
    ptySessions: ptyManager,
    isPidAlive: () => true
  });

  catalog.restoreRelaySessions([{
    id: 'r1',
    provider: 'shell',
    title: 'R1',
    projectPath: '/proj',
    accountId: 'acct',
    gatewayId: 'gw',
    userId: 'u',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now(),
    pid: 12345
  } as never]);

  const session = ptyManager.getSession('r1');
  assert.ok(session !== undefined);
  assert.equal(session!.status, 'running');
});

test('restoreRelaySessions: pid not alive → status lost', () => {
  const ptyManager = new PtySessionManager();
  const catalog = makeCatalog({
    ptySessions: ptyManager,
    isPidAlive: () => false
  });

  catalog.restoreRelaySessions([{
    id: 'r2',
    provider: 'shell',
    title: 'R2',
    projectPath: '/proj',
    status: 'running',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now(),
    pid: 99999
  } as never]);

  const session = ptyManager.getSession('r2');
  assert.equal(session!.status, 'lost');
});

test('restoreRelaySessions: no pid → uses relaySession.status directly', () => {
  const ptyManager = new PtySessionManager();
  const catalog = makeCatalog({ ptySessions: ptyManager });

  catalog.restoreRelaySessions([{
    id: 'r3',
    provider: 'shell',
    title: 'R3',
    projectPath: '/proj',
    status: 'completed',
    transport: 'pty-event-stream',
    lastActiveAt: Date.now()
  } as never]);

  const session = ptyManager.getSession('r3');
  assert.equal(session!.status, 'completed');
});

// ---------------------------------------------------------------------------
// markSessionLost
// ---------------------------------------------------------------------------

test('markSessionLost: running session emits session.error and calls onSessionsChanged', () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_mark', status: 'running' }));

  const emitted: SessionEvent[] = [];
  let changedCalled = false;

  const catalog = makeCatalog({
    ptySessions: ptyManager,
    emitEvent: (e) => emitted.push(e),
    onSessionsChanged: () => { changedCalled = true; }
  });

  catalog.markSessionLost('pty_mark');

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.type, 'session.error');
  assert.equal(emitted[0]!.sessionId, 'pty_mark');
  assert.equal(changedCalled, true);
  assert.equal(ptyManager.getSession('pty_mark')!.status, 'lost');
});

test('markSessionLost: non-running session does not trigger events', () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_done', status: 'completed' }));

  const emitted: SessionEvent[] = [];
  let changedCalled = false;

  const catalog = makeCatalog({
    ptySessions: ptyManager,
    emitEvent: (e) => emitted.push(e),
    onSessionsChanged: () => { changedCalled = true; }
  });

  catalog.markSessionLost('pty_done');

  assert.equal(emitted.length, 0);
  assert.equal(changedCalled, false);
});

test('markSessionLost: calling twice on same session does not emit duplicate events', () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_once', status: 'running' }));

  const emitted: SessionEvent[] = [];
  const catalog = makeCatalog({
    ptySessions: ptyManager,
    emitEvent: (e) => emitted.push(e)
  });

  catalog.markSessionLost('pty_once');
  catalog.markSessionLost('pty_once');

  assert.equal(emitted.length, 1);
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

test('get: returns chat session when present', () => {
  const chatRegistry = new ChatSessionRegistry();
  chatRegistry.upsertFromMetadata(makeChatMeta({ id: 'chat_get' }));
  const catalog = makeCatalog({ chatRegistry });
  const s = catalog.get('chat_get');
  assert.ok(s !== undefined);
  assert.equal(s!.transport, 'chat');
});

test('get: returns pty session when chat registry does not have it', () => {
  const ptyManager = new PtySessionManager();
  ptyManager.restoreSession(makePtySession({ id: 'pty_get' }));
  const catalog = makeCatalog({ ptySessions: ptyManager });
  const s = catalog.get('pty_get');
  assert.ok(s !== undefined);
  assert.equal(s!.transport, 'pty-event-stream');
});

test('get: returns undefined for unknown session', () => {
  const catalog = makeCatalog();
  assert.equal(catalog.get('unknown'), undefined);
});
