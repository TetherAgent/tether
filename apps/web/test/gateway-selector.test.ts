import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayLabel,
  shouldAutoSelectGateway,
  type GatewayInfo
} from '../src/components/chats/shell/gateway-selector.js';

const offlineGateway: GatewayInfo = {
  gatewayId: 'gateway-offline-123',
  hostname: 'offline-host',
  name: 'Offline Gateway',
  status: 'offline'
};

const onlineGateway: GatewayInfo = {
  gatewayId: 'gateway-online-456',
  hostname: 'online-host',
  name: 'Online Gateway',
  status: 'online'
};

test('gatewayLabel prefers configured name over hostname and id', () => {
  assert.equal(gatewayLabel(onlineGateway), 'Online Gateway');
});

test('gatewayLabel falls back to hostname, then gateway id prefix', () => {
  assert.equal(gatewayLabel({ ...onlineGateway, name: '   ' }), 'online-host');
  assert.equal(gatewayLabel({ gatewayId: 'gateway-only-789', name: '', status: 'online' }), 'gateway-');
});

test('shouldAutoSelectGateway selects first online gateway for new session when selection is missing', () => {
  assert.deepEqual(
    shouldAutoSelectGateway({
      onlineGateways: [onlineGateway],
      readonly: false,
      selectedGatewayId: undefined,
      visibleGateways: [offlineGateway, onlineGateway]
    }),
    onlineGateway
  );
});

test('shouldAutoSelectGateway does not select offline gateway for new session', () => {
  assert.equal(
    shouldAutoSelectGateway({
      onlineGateways: [],
      readonly: false,
      selectedGatewayId: undefined,
      visibleGateways: [offlineGateway]
    }),
    undefined
  );
});

test('shouldAutoSelectGateway keeps existing visible owner gateway even when it is offline', () => {
  assert.equal(
    shouldAutoSelectGateway({
      onlineGateways: [onlineGateway],
      readonly: false,
      selectedGatewayId: offlineGateway.gatewayId,
      visibleGateways: [offlineGateway, onlineGateway]
    }),
    undefined
  );
});

test('shouldAutoSelectGateway never changes readonly existing session owner', () => {
  assert.equal(
    shouldAutoSelectGateway({
      onlineGateways: [onlineGateway],
      readonly: true,
      selectedGatewayId: offlineGateway.gatewayId,
      visibleGateways: [offlineGateway, onlineGateway]
    }),
    undefined
  );
});
