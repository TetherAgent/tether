import { Controller } from 'egg';

export default class GatewayController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const auth = ctx.state.auth as { userId?: string } | undefined;
    const gateways = await ctx.service.gatewayRepository.loadGatewaysByUserId(auth?.userId ?? '');
    ctx.success(gateways.map(gateway => ({
      gatewayId: gateway.id,
      deviceKey: gateway.deviceKey,
      hostname: gateway.hostname,
      name: gateway.name,
      status: gateway.status,
      lastSeenAt: gateway.lastSeenAt
    })));
  }

  public async bind(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.gateway.bindGateway({
      email: body.email ?? '',
      password: body.password ?? '',
      gatewayName: body.gatewayName,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }

  public async refresh(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.gateway.refreshGatewayToken(body.refreshToken ?? '');
    ctx.success(data);
  }

  public async heartbeat(): Promise<void> {
    const { ctx } = this;
    const auth = ctx.state.auth as { gatewayId?: string } | undefined;
    const data = await ctx.service.gateway.heartbeatGateway(auth?.gatewayId ?? '');
    ctx.success(data);
  }
}
