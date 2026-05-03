import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/app/service/gateway.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
    ctx.service.runtime.resetRuntimeStore()
    await ctx.service.auth.registerNormalUser({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
  })

  it('bind returns gateway-scoped token pair', async () => {
    const bound = await ctx.service.gateway.bindGateway({
      email: 'owner@example.com',
      password: 'pw-123456',
      gatewayName: 'macbook',
    })
    const payload = await ctx.service.auth.verifyToken(bound.gatewayAccessToken)
    assert.strictEqual(payload.tokenClass, 'gateway_access')
    assert.strictEqual(payload.accountId, bound.accountId)
    assert.strictEqual(payload.workspaceId, bound.workspaceId)

    const gatewayEvents = (await ctx.service.audit.auditEvents()).filter(
      (event) => event.action === 'gateway.bound',
    )
    assert.strictEqual(gatewayEvents.length, 1)
  })

  it('refresh succeeds before revoke and fails after revoke', async () => {
    const bound = await ctx.service.gateway.bindGateway({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    const refreshed = await ctx.service.gateway.refreshGatewayToken(
      bound.gatewayRefreshToken,
    )
    assert(refreshed)
    assert.strictEqual(
      (await ctx.service.auth.verifyToken(refreshed.accessToken)).tokenClass,
      'gateway_access',
    )

    await ctx.service.auth.revokeToken(bound.gatewayRefreshToken)
    await assert.rejects(
      () => ctx.service.gateway.refreshGatewayToken(bound.gatewayRefreshToken),
      /token_revoked/,
    )
  })
})
