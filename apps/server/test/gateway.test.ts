import assert from 'node:assert/strict';
import test from 'node:test';

import { registerNormalUser, revokeToken, verifyToken } from '../app/service/auth';
import { auditEvents } from '../app/service/audit';
import { bindGateway, refreshGatewayToken } from '../app/service/gateway';
import { resetRuntimeStore } from '../app/service/runtime';

const config = {
  jwt: {
    secret: 'phase5-test-secret'
  }
};

test('gateway bind returns gateway-scoped token pair', async () => {
  resetRuntimeStore();
  await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);

  const bound = await bindGateway({ email: 'owner@example.com', password: 'pw-123456', gatewayName: 'macbook' }, config);
  const payload = verifyToken(bound.gatewayAccessToken, config);
  assert.equal(payload.tokenClass, 'gateway_access');
  assert.equal(payload.accountId, bound.accountId);
  assert.equal(payload.workspaceId, bound.workspaceId);

  const gatewayEvents = (await auditEvents()).filter((event) => event.action === 'gateway.bound');
  assert.equal(gatewayEvents.length, 1);
});

test('gateway refresh succeeds before revoke and fails after revoke', async () => {
  resetRuntimeStore();
  await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);

  const bound = await bindGateway({ email: 'owner@example.com', password: 'pw-123456' }, config);
  const refreshed = await refreshGatewayToken(bound.gatewayRefreshToken, config);
  assert.equal(verifyToken(refreshed.accessToken, config).tokenClass, 'gateway_access');

  await revokeToken(bound.gatewayRefreshToken, config);
  await assert.rejects(() => refreshGatewayToken(bound.gatewayRefreshToken, config), /token_revoked/);
});
