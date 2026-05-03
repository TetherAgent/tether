import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/app/service/notification.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
    ctx.service.runtime.resetRuntimeStore()
  })

  it('only delivers same-account same-user metadata events', async () => {
    const owner = await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    await ctx.service.auth.registerNormalUser({
      email: 'other@example.com',
      password: 'pw-123456',
    })

    const ownerSink = ctx.service.notification.openNotificationSink({
      accountId: owner.account.id,
      realm: 'normal',
      userId: owner.user.id,
    })

    const otherLogin = await ctx.service.auth.loginNormalUser({
      email: 'other@example.com',
      password: 'pw-123456',
    })
    const ownerEvents = ctx.service.notification.notificationEvents(ownerSink.id)
    assert(otherLogin.user)
    assert.strictEqual(
      ownerEvents.some((event) => event.userId === otherLogin.user.id),
      false,
    )
    assert.strictEqual(
      ownerEvents.some((event) => event.eventType === 'auth.state.changed'),
      true,
    )
    assert.strictEqual(
      ownerEvents.every((event) => event.payload?.terminalOutput === undefined),
      true,
    )
  })
})
