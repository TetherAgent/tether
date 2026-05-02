import assert from 'node:assert/strict';
import test from 'node:test';

import { loginNormalUser, registerNormalUser } from '../app/service/auth';
import { notificationEvents, openNotificationSink } from '../app/service/notification';
import { resetRuntimeStore } from '../app/service/runtime';

const config = {
  jwt: {
    secret: 'phase5-test-secret'
  }
};

test('notification sinks only receive same-account same-user metadata events', async () => {
  resetRuntimeStore();
  const owner = await registerNormalUser({ email: 'owner@example.com', password: 'pw-123456' }, config);
  await registerNormalUser({ email: 'other@example.com', password: 'pw-123456' }, config);

  const ownerSink = openNotificationSink({
    accountId: owner.account.id,
    realm: 'normal',
    userId: owner.user.id
  });

  const otherLogin = await loginNormalUser({ email: 'other@example.com', password: 'pw-123456' }, config);
  const ownerEvents = notificationEvents(ownerSink.id);
  assert.equal(ownerEvents.some((event) => event.userId === otherLogin.user.id), false);
  assert.equal(ownerEvents.some((event) => event.eventType === 'auth.state.changed'), true);
  assert.equal(ownerEvents.every((event) => event.payload?.terminalOutput === undefined), true);
});
