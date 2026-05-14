import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionRegistry } from '../src/chat/chat-session-registry.js';
import type { TrustedChatSessionMetadata } from '@tether/protocol';

function makeMetadata(overrides: Partial<TrustedChatSessionMetadata> = {}): TrustedChatSessionMetadata {
  return {
    id: 'sess_001',
    provider: 'claude',
    title: 'Test Chat',
    projectPath: '/home/user/project',
    accountId: 'acct_1',
    userId: 'user_1',
    gatewayId: 'gw_1',
    transport: 'chat' as const,
    agentSessionId: undefined,
    ...overrides
  };
}

test('upsertFromMetadata creates a new session', () => {
  const registry = new ChatSessionRegistry();
  const session = registry.upsertFromMetadata(makeMetadata());
  assert.equal(session.id, 'sess_001');
  assert.equal(session.provider, 'claude');
  assert.equal(session.transport, 'chat');
  assert.equal(session.status, 'running');
});

test('upsertFromMetadata preserves createdAt on update', () => {
  const registry = new ChatSessionRegistry();
  const first = registry.upsertFromMetadata(makeMetadata());
  const createdAt = first.createdAt;

  // Small delay to ensure updatedAt differs
  const second = registry.upsertFromMetadata(makeMetadata({ title: 'Updated' }));
  assert.equal(second.createdAt, createdAt);
  assert.equal(second.title, 'Updated');
});

test('upsertFromMetadata uses provider as title when title is absent', () => {
  const registry = new ChatSessionRegistry();
  const session = registry.upsertFromMetadata(makeMetadata({ title: undefined }));
  assert.equal(session.title, 'claude');
});

test('upsertFromMetadata updates updatedAt and lastActiveAt on second call', () => {
  const registry = new ChatSessionRegistry();
  const first = registry.upsertFromMetadata(makeMetadata());
  const firstUpdated = first.updatedAt;

  // Force time to appear different by using a second call after a tiny tick
  // (both calls may happen in the same ms, so we only assert they are >= first)
  const second = registry.upsertFromMetadata(makeMetadata());
  assert.ok(second.updatedAt >= firstUpdated);
  assert.ok(second.lastActiveAt >= firstUpdated);
});

test('has returns true for existing session, false for unknown', () => {
  const registry = new ChatSessionRegistry();
  assert.equal(registry.has('sess_001'), false);
  registry.upsertFromMetadata(makeMetadata());
  assert.equal(registry.has('sess_001'), true);
  assert.equal(registry.has('sess_other'), false);
});

test('get returns session or undefined', () => {
  const registry = new ChatSessionRegistry();
  assert.equal(registry.get('sess_001'), undefined);
  registry.upsertFromMetadata(makeMetadata());
  assert.ok(registry.get('sess_001') !== undefined);
});

test('list returns all sessions', () => {
  const registry = new ChatSessionRegistry();
  assert.deepEqual(registry.list(), []);
  registry.upsertFromMetadata(makeMetadata({ id: 'a' }));
  registry.upsertFromMetadata(makeMetadata({ id: 'b' }));
  assert.equal(registry.list().length, 2);
});

test('in-flight: markInFlight / isInFlight / releaseInFlight', () => {
  const registry = new ChatSessionRegistry();
  assert.equal(registry.isInFlight('sess_001'), false);
  registry.markInFlight('sess_001');
  assert.equal(registry.isInFlight('sess_001'), true);
  registry.releaseInFlight('sess_001');
  assert.equal(registry.isInFlight('sess_001'), false);
});

test('in-flight does not require session to exist in registry', () => {
  const registry = new ChatSessionRegistry();
  registry.markInFlight('ghost_session');
  assert.equal(registry.isInFlight('ghost_session'), true);
  registry.releaseInFlight('ghost_session');
  assert.equal(registry.isInFlight('ghost_session'), false);
});

test('releaseInFlight on non-marked session is safe', () => {
  const registry = new ChatSessionRegistry();
  assert.doesNotThrow(() => registry.releaseInFlight('nonexistent'));
});

test('updateAgentSessionId updates existing session', () => {
  const registry = new ChatSessionRegistry();
  registry.upsertFromMetadata(makeMetadata({ id: 'sess_001' }));
  registry.updateAgentSessionId('sess_001', 'agent_abc');
  assert.equal(registry.get('sess_001')?.agentSessionId, 'agent_abc');
});

test('updateAgentSessionId is a no-op for missing session', () => {
  const registry = new ChatSessionRegistry();
  assert.doesNotThrow(() => registry.updateAgentSessionId('missing', 'agent_xyz'));
});

test('updateAgentSessionId updates updatedAt and lastActiveAt', () => {
  const registry = new ChatSessionRegistry();
  const session = registry.upsertFromMetadata(makeMetadata());
  const before = session.updatedAt;
  registry.updateAgentSessionId(session.id, 'new_agent');
  const updated = registry.get(session.id)!;
  assert.ok(updated.updatedAt >= before);
  assert.equal(updated.lastActiveAt, updated.updatedAt);
});

test('multiple sessions are isolated', () => {
  const registry = new ChatSessionRegistry();
  registry.upsertFromMetadata(makeMetadata({ id: 'a' }));
  registry.upsertFromMetadata(makeMetadata({ id: 'b' }));
  registry.markInFlight('a');
  assert.equal(registry.isInFlight('a'), true);
  assert.equal(registry.isInFlight('b'), false);
  registry.updateAgentSessionId('a', 'agent_a');
  assert.equal(registry.get('a')?.agentSessionId, 'agent_a');
  assert.equal(registry.get('b')?.agentSessionId, undefined);
});
