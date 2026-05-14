import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameRouter, type FrameRouterHandlers } from '../src/relay/frame-router.js';

function makeHandlers(target: string): { handlers: FrameRouterHandlers; calls: string[] } {
  const calls: string[] = [];
  const handler = (name: string) => () => { calls.push(name); };
  const handlers: FrameRouterHandlers = {
    onAuthOk: handler('onAuthOk'),
    onSessionsRestore: handler('onSessionsRestore'),
    onAuthFailed: handler('onAuthFailed'),
    onList: handler('onList'),
    onSubscribe: handler('onSubscribe'),
    onInput: handler('onInput'),
    onResize: handler('onResize'),
    onStop: handler('onStop'),
    onUnsubscribe: handler('onUnsubscribe'),
    onDetach: handler('onDetach'),
    onChat: handler('onChat'),
    onListProviders: handler('onListProviders'),
    onCwdSuggest: handler('onCwdSuggest'),
    onSwitchModel: handler('onSwitchModel'),
    onPermissionResponse: handler('onPermissionResponse'),
    onNewPtySession: handler('onNewPtySession'),
  };
  return { handlers, calls };
}

const cases: Array<[string, unknown, string]> = [
  ['gateway.auth.ok', { type: 'gateway.auth.ok', gatewayId: 'gw1' }, 'onAuthOk'],
  ['gateway.sessions-restore', { type: 'gateway.sessions-restore', sessions: [] }, 'onSessionsRestore'],
  ['gateway.auth.failed', { type: 'gateway.auth.failed', reason: 'bad' }, 'onAuthFailed'],
  ['client.list', { type: 'client.list', clientId: 'c1' }, 'onList'],
  ['client.subscribe', { type: 'client.subscribe', clientId: 'c1', sessionId: 's1', after: 0, mode: 'control' }, 'onSubscribe'],
  ['client.input', { type: 'client.input', clientId: 'c1', sessionId: 's1', data: 'x' }, 'onInput'],
  ['client.resize', { type: 'client.resize', clientId: 'c1', sessionId: 's1', cols: 80, rows: 24 }, 'onResize'],
  ['client.stop', { type: 'client.stop', clientId: 'c1', sessionId: 's1' }, 'onStop'],
  ['client.unsubscribe', { type: 'client.unsubscribe', clientId: 'c1', sessionId: 's1' }, 'onUnsubscribe'],
  ['client.detach', { type: 'client.detach', clientId: 'c1', sessionId: 's1' }, 'onDetach'],
  ['client.chat', { type: 'client.chat', clientId: 'c1', sessionId: 's1', message: 'hi' }, 'onChat'],
  ['client.list-providers', { type: 'client.list-providers', clientId: 'c1' }, 'onListProviders'],
  ['client.cwd-suggest', { type: 'client.cwd-suggest', clientId: 'c1', partial: '/' }, 'onCwdSuggest'],
  ['client.switch-model', { type: 'client.switch-model', clientId: 'c1', sessionId: 's1', model: 'm1' }, 'onSwitchModel'],
  ['client.permission_response', { type: 'client.permission_response', clientId: 'c1', sessionId: 's1', toolUseId: 't1', behavior: 'allow', updatedInput: {} }, 'onPermissionResponse'],
  ['client.new-pty-session', { type: 'client.new-pty-session', clientId: 'c1', provider: 'shell', launchMode: 'background' }, 'onNewPtySession'],
];

for (const [frameType, frame, expectedHandler] of cases) {
  test(`routes ${frameType} to ${expectedHandler} only`, () => {
    const { handlers, calls } = makeHandlers(expectedHandler);
    const router = new FrameRouter(handlers);
    router.route(frame as never);
    assert.deepEqual(calls, [expectedHandler]);
  });
}
