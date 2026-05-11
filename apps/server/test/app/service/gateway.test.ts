import assert from 'assert'
import { readFileSync } from 'fs'
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

  it('deletes gateway refresh tokens before deleting the gateway row', async () => {
    const source = readFileSync(
      require.resolve('../../../app/service/gatewayRepository.ts'),
      'utf8',
    )
    assert.match(
      source,
      /DELETE FROM gateway_refresh_tokens WHERE gateway_id = \?[\s\S]*DELETE FROM gateways WHERE id = \?/,
    )
  })
})
