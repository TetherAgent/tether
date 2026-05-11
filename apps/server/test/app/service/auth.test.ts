import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/app/service/auth.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
    ctx.service.runtime.resetRuntimeStore()
  })

  it('register and login issue separate normal and management token classes', async () => {
    const registered = await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    const normalPayload = await ctx.service.auth.verifyToken(registered.accessToken)
    assert.strictEqual(normalPayload.tokenClass, 'normal_client_access')
    assert.strictEqual(normalPayload.userId, registered.user.id)

    const admin = await ctx.service.auth.registerManagementUser({
      email: 'admin@example.com',
      password: 'pw-123456',
    })
    const adminPayload = await ctx.service.auth.verifyToken(admin.accessToken)
    assert.strictEqual(adminPayload.tokenClass, 'management_access')
    assert.strictEqual(adminPayload.adminUserId, admin.adminUser.id)

    await assert.rejects(
      () => ctx.service.auth.currentUserFromToken(admin.accessToken),
      /wrong_token_class/,
    )
  })


  it('login failure writes audit trail and login success can resolve current user', async () => {
    await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })

    await assert.rejects(
      () => ctx.service.auth.loginNormalUser({
        email: 'owner@example.com',
        password: 'bad-pass',
      }),
      /invalid_credentials/,
    )
    const success = await ctx.service.auth.loginNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    const me = await ctx.service.auth.currentUserFromToken(success.accessToken)
    assert.strictEqual(me.email, 'owner@example.com')

    const events = await ctx.service.audit.auditEvents()
    const failures = events.filter((event) => event.action === 'auth.login.failed')
    const successes = events.filter((event) => event.action === 'auth.login.succeeded')
    assert.strictEqual(failures.length, 1)
    assert.strictEqual(successes.length, 1)
  })

  it('management login uses separate realm and refresh path', async () => {
    await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    await ctx.service.auth.registerManagementUser({
      email: 'admin@example.com',
      password: 'pw-123456',
    })

    const adminLogin = await ctx.service.auth.loginManagementUser({
      email: 'admin@example.com',
      password: 'pw-123456',
    })
    const adminRefresh = await ctx.service.auth.refreshFromToken(
      adminLogin.refreshToken,
    )
    assert(adminRefresh)
    assert.strictEqual(
      (await ctx.service.auth.verifyToken(adminRefresh.accessToken)).tokenClass,
      'management_access',
    )
  })

  it('token validate is available for server-to-server introspection without authorization header', async () => {
    const registered = await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })

    const response = await app.httpRequest()
      .post('/api/server/token/validate')
      .send({ token: registered.accessToken })
      .expect(200)

    assert.strictEqual(response.body.code, 200)
    assert.strictEqual(response.body.data.tokenClass, 'normal_client_access')
    assert.strictEqual(response.body.data.userId, registered.user.id)
  })
})
