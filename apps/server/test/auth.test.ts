import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentUserFromToken,
  loginManagementUser,
  loginNormalUser,
  refreshFromToken,
  registerManagementUser,
  registerNormalUser,
  revokeToken,
  verifyToken
} from '../app/service/auth';
import { auditEvents } from '../app/service/audit';
import { resetRuntimeStore } from '../app/service/runtime';

const config = {
  jwt: {
    secret: 'phase5-test-secret'
  }
};

test('register and login issue separate normal and management token classes', async () => {
  resetRuntimeStore();
  const registered = await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);
  const normalPayload = verifyToken(registered.accessToken, config);
  assert.equal(normalPayload.tokenClass, 'normal_client_access');
  assert.equal(normalPayload.userId, registered.user.id);

  const admin = await registerManagementUser({ email: 'admin@example.com', password: 'pw-123456' }, config);
  const adminPayload = verifyToken(admin.accessToken, config);
  assert.equal(adminPayload.tokenClass, 'management_access');
  assert.equal(adminPayload.adminUserId, admin.adminUser.id);

  await assert.rejects(() => currentUserFromToken(admin.accessToken, config), /wrong_token_class/);
});

test('refresh rotates normal tokens and revoke blocks them', async () => {
  resetRuntimeStore();
  const registered = await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);
  const refreshed = await refreshFromToken(registered.refreshToken, config);
  assert.equal(verifyToken(refreshed.accessToken, config).tokenClass, 'normal_client_access');

  await revokeToken(registered.refreshToken, config);
  await assert.rejects(() => refreshFromToken(registered.refreshToken, config), /token_revoked/);
});

test('login failure writes audit trail and login success can resolve current user', async () => {
  resetRuntimeStore();
  await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);

  await assert.rejects(() => loginNormalUser({ email: 'owner@example.com', password: 'bad-pass' }, config), /invalid_credentials/);
  const success = await loginNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);
  const me = await currentUserFromToken(success.accessToken, config);
  assert.equal(me.email, 'owner@example.com');

  const events = await auditEvents();
  const failures = events.filter((event) => event.action === 'auth.login.failed');
  const successes = events.filter((event) => event.action === 'auth.login.succeeded');
  assert.equal(failures.length, 1);
  assert.equal(successes.length, 1);
});

test('management login uses separate realm and refresh path', async () => {
  resetRuntimeStore();
  await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);
  await registerManagementUser({ email: 'admin@example.com', password: 'pw-123456' }, config);

  const adminLogin = await loginManagementUser({ email: 'admin@example.com', password: 'pw-123456' }, config);
  const adminRefresh = await refreshFromToken(adminLogin.refreshToken, config);
  assert.equal(verifyToken(adminRefresh.accessToken, config).tokenClass, 'management_access');
});
