import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  userId?: string;
};

export default class GatewayAuthController extends Controller {
  public async bind(): Promise<void> {
    const { ctx } = this;
    const auth = ctx.state.auth as AuthScope | undefined;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.gateway.bindGatewayForUser({
      accountId: auth?.accountId ?? '',
      userId: auth?.userId ?? '',
      gatewayName: body.hostname,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }
}
