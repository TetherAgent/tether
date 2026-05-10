import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/app/service/audit.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
    ctx.service.runtime.resetRuntimeStore()
  })

  it('masks token and secret fields in audit payloads', async () => {
    await ctx.service.audit.recordAuditEvent({
      accountId: 'acct_1',
      action: 'auth.login.succeeded',
      payload: {
        accessToken: 'Bearer super-secret-token-value',
        relaySecret: 'relay-secret-value',
        note: 'safe',
      },
    })

    const [event] = await ctx.service.audit.auditEvents()
    assert.strictEqual(typeof event.payload.accessToken, 'string')
    assert.strictEqual(
      String(event.payload.accessToken).includes('super-secret-token-value'),
      false,
    )
    assert.strictEqual(
      String(event.payload.relaySecret).includes('relay-secret-value'),
      false,
    )
    assert.strictEqual(event.payload.note, 'safe')
  })
})
