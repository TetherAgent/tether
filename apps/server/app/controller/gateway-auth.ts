import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  userId?: string;
};

export default class GatewayAuthController extends Controller {
  public async bind(): Promise<void> {
    const { ctx } = this;
    const auth = ctx.state.auth as AuthScope | undefined;
    const body = ctx.request.body as Record<string, string | number | undefined>;
    const deviceKey = typeof body.deviceKey === 'string' ? body.deviceKey : '';
    if (!deviceKey) {
      ctx.throw(400, 'device_key_required');
    }
    const data = await ctx.service.gateway.bindGatewayForUser({
      accountId: auth?.accountId ?? '',
      userId: auth?.userId ?? '',
      deviceKey,
      gatewayName: typeof body.hostname === 'string' ? body.hostname : undefined,
      hostname: typeof body.hostname === 'string' ? body.hostname : undefined,
      localPort: typeof body.port === 'number' ? body.port : undefined,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }
}
