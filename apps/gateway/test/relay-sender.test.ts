import assert from 'node:assert/strict';
import test from 'node:test';
import { RelaySender } from '../src/relay/relay-sender.js';
import type { RelayGatewayToServerFrame } from '@tether/protocol';

function makeCapture() {
  const frames: RelayGatewayToServerFrame[] = [];
  const sender = new RelaySender(
    (frame) => { frames.push(frame); },
    () => 'gw_test'
  );
  return { sender, frames };
}

test('sessions sends gateway.sessions with gatewayId', () => {
  const { sender, frames } = makeCapture();
  sender.sessions([]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.type, 'gateway.sessions');
  assert.equal((frames[0] as { gatewayId: string }).gatewayId, 'gw_test');
  assert.deepEqual((frames[0] as { sessions: unknown[] }).sessions, []);
});

test('event sends gateway.event with gatewayId', () => {
  const { sender, frames } = makeCapture();
  const event = { id: 1, sessionId: 's1', type: 'terminal.output', ts: 0, payload: { data: 'hi' } } as never;
  sender.event(event);
  assert.equal(frames[0]!.type, 'gateway.event');
  assert.equal((frames[0] as { gatewayId: string }).gatewayId, 'gw_test');
  assert.deepEqual((frames[0] as { event: unknown }).event, event);
});

test('error sends gateway.error with required fields', () => {
  const { sender, frames } = makeCapture();
  sender.error('c1', 's1', 'session_lost', 'lost!');
  const f = frames[0] as { type: string; clientId: string; sessionId: string; code: string; message: string; clientRequestId?: string };
  assert.equal(f.type, 'gateway.error');
  assert.equal(f.clientId, 'c1');
  assert.equal(f.sessionId, 's1');
  assert.equal(f.code, 'session_lost');
  assert.equal(f.message, 'lost!');
  assert.equal(f.clientRequestId, undefined);
});

test('error includes clientRequestId when provided', () => {
  const { sender, frames } = makeCapture();
  sender.error('c1', 's1', 'err', 'msg', 'req_123');
  assert.equal((frames[0] as { clientRequestId: string }).clientRequestId, 'req_123');
});

test('error omits clientRequestId key when not provided', () => {
  const { sender, frames } = makeCapture();
  sender.error('c1', 's1', 'err', 'msg');
  assert.equal('clientRequestId' in frames[0]!, false);
});

test('sessionCreated sends gateway.session-created', () => {
  const { sender, frames } = makeCapture();
  sender.sessionCreated('c1', 'sess1', 'req_abc');
  const f = frames[0] as { type: string; clientId: string; sessionId: string; clientRequestId: string };
  assert.equal(f.type, 'gateway.session-created');
  assert.equal(f.clientId, 'c1');
  assert.equal(f.sessionId, 'sess1');
  assert.equal(f.clientRequestId, 'req_abc');
});

test('sessionCreated omits clientRequestId when not provided', () => {
  const { sender, frames } = makeCapture();
  sender.sessionCreated('c1', 'sess1');
  assert.equal('clientRequestId' in frames[0]!, false);
});

test('localTerminalOpened sends gateway.local-terminal-opened', () => {
  const { sender, frames } = makeCapture();
  sender.localTerminalOpened('c1', 'req_x', 'shell');
  const f = frames[0] as { type: string; clientId: string; clientRequestId: string; provider: string };
  assert.equal(f.type, 'gateway.local-terminal-opened');
  assert.equal(f.clientId, 'c1');
  assert.equal(f.clientRequestId, 'req_x');
  assert.equal(f.provider, 'shell');
});

test('chatSessionCreated sends gateway.chat-session-created', () => {
  const { sender, frames } = makeCapture();
  const session = { id: 's1', provider: 'claude' } as never;
  sender.chatSessionCreated('c1', session);
  const f = frames[0] as { type: string; clientId: string; session: unknown };
  assert.equal(f.type, 'gateway.chat-session-created');
  assert.equal(f.clientId, 'c1');
  assert.deepEqual(f.session, session);
});

test('chatCatchup sends gateway.chat-catchup with text', () => {
  const { sender, frames } = makeCapture();
  sender.chatCatchup('c1', 's1', 'hello world');
  const f = frames[0] as { type: string; clientId: string; sessionId: string; text: string };
  assert.equal(f.type, 'gateway.chat-catchup');
  assert.equal(f.text, 'hello world');
});

test('replay sends gateway.replay with all fields', () => {
  const { sender, frames } = makeCapture();
  const events = [{ id: 5 } as never];
  sender.replay('c1', 's1', events, 5, false);
  const f = frames[0] as { type: string; clientId: string; sessionId: string; events: unknown[]; done: boolean; latestEventId: number };
  assert.equal(f.type, 'gateway.replay');
  assert.equal(f.done, false);
  assert.equal(f.latestEventId, 5);
  assert.deepEqual(f.events, events);
});

test('replay defaults done to true', () => {
  const { sender, frames } = makeCapture();
  sender.replay('c1', 's1', [], 0);
  assert.equal((frames[0] as { done: boolean }).done, true);
});

test('all send methods include gatewayId from getter', () => {
  let id = 'gw_first';
  const frames: RelayGatewayToServerFrame[] = [];
  const sender = new RelaySender((f) => { frames.push(f); }, () => id);

  sender.sessions([]);
  id = 'gw_second';
  sender.sessions([]);

  assert.equal((frames[0] as { gatewayId: string }).gatewayId, 'gw_first');
  assert.equal((frames[1] as { gatewayId: string }).gatewayId, 'gw_second');
});
