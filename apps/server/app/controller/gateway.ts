import { Controller } from 'egg';

export default class GatewayController extends Controller {
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
}
