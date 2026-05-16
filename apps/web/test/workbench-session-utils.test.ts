import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkbenchSessionRunning,
  workbenchSessionRoute
} from '../src/components/workbench/session-utils.js';

test('workbenchSessionRoute keeps chat sessions navigable by id', () => {
  assert.equal(workbenchSessionRoute('chats', 'chat-session-1'), '/chats/chat-session-1');
});

test('workbenchSessionRoute encodes terminal session ids', () => {
  assert.equal(workbenchSessionRoute('terminal', 'term/session 1'), '/terminal/term%2Fsession%201');
});

test('isWorkbenchSessionRunning treats chat running state as navigable even when owner gateway is offline', () => {
  assert.equal(
    isWorkbenchSessionRunning({
      gatewayId: 'gw-offline',
      gatewayIdsOnline: new Set(['gw-online']),
      status: 'running',
      tab: 'chats'
    }),
    true
  );
});

test('isWorkbenchSessionRunning hides terminal running dot when owner gateway is offline', () => {
  assert.equal(
    isWorkbenchSessionRunning({
      gatewayId: 'gw-offline',
      gatewayIdsOnline: new Set(['gw-online']),
      status: 'running',
      tab: 'terminal'
    }),
    false
  );
});

test('isWorkbenchSessionRunning keeps terminal running dot when no gateway snapshot is available', () => {
  assert.equal(
    isWorkbenchSessionRunning({
      gatewayId: 'gw-unknown',
      gatewayIdsOnline: new Set(),
      status: 'running',
      tab: 'terminal'
    }),
    true
  );
});
