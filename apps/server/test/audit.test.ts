import assert from 'node:assert/strict';
import test from 'node:test';

import { auditEvents, recordAuditEvent } from '../app/service/audit';
import { resetRuntimeStore } from '../app/service/runtime';

test('audit payload masks token and secret fields', async () => {
  resetRuntimeStore();
  await recordAuditEvent({
    accountId: 'acct_1',
    workspaceId: 'ws_1',
    action: 'auth.login.succeeded',
    payload: {
      accessToken: 'Bearer super-secret-token-value',
      relaySecret: 'relay-secret-value',
      note: 'safe'
    }
  });

  const [event] = await auditEvents();
  assert.equal(typeof event.payload.accessToken, 'string');
  assert.equal(String(event.payload.accessToken).includes('super-secret-token-value'), false);
  assert.equal(String(event.payload.relaySecret).includes('relay-secret-value'), false);
  assert.equal(event.payload.note, 'safe');
});
