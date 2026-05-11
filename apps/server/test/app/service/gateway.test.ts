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

    const gatewayEvents = (await ctx.service.audit.auditEvents()).filter(
      (event) => event.action === 'gateway.bound',
    )
    assert.strictEqual(gatewayEvents.length, 1)
  })

  it('refresh succeeds for gateway refresh token', async () => {
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
  })

  it('admin unlink revokes gateway refresh tokens and keeps gateway row', async () => {
    const bound = await ctx.service.gateway.bindGateway({
      email: 'owner@example.com',
      password: 'pw-123456',
    })
    await ctx.service.auth.registerManagementUser({
      email: 'admin@example.com',
      password: 'pw-123456',
    })
    const admin = await ctx.service.auth.loginManagementUser({
      email: 'admin@example.com',
      password: 'pw-123456',
    })

    await ctx.service.admin.gateways.unlinkAdminGateway(
      bound.gateway.id,
      admin.adminUser.id,
      bound.accountId,
    )

    const gateway = await ctx.service.gatewayRepository.loadGatewayById(bound.gateway.id)
    assert(gateway)
    assert.strictEqual(gateway.status, 'revoked')
    const refreshPayload = await ctx.service.auth.verifyToken(bound.gatewayRefreshToken)
    const refreshRecord = await ctx.service.authRepository.loadRefreshTokenByJti(refreshPayload.jti)
    assert(refreshRecord?.revokedAt)
    await assert.rejects(
      () => ctx.service.gateway.refreshGatewayToken(bound.gatewayRefreshToken),
      /gateway_unlinked|token_revoked/,
    )
  })
})
