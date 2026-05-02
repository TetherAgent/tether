import { Controller } from 'egg';

import { bindGateway, refreshGatewayToken } from '../service/gateway';

export default class GatewayController extends Controller {
  public async bind(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await bindGateway({
        email: body.email ?? '',
        password: body.password ?? '',
        gatewayName: body.gatewayName,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config);
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'gateway_bind_failed' };
    }
  }

  public async refresh(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await refreshGatewayToken(body.refreshToken ?? '', this.app.config);
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'gateway_refresh_failed' };
    }
  }
}
