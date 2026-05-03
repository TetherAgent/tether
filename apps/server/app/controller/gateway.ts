import { Controller } from 'egg';
import { ResponseCode } from '../types/response';

import { bindGateway, refreshGatewayToken } from '../service/gateway';

export default class GatewayController extends Controller {
  public async bind(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.success(await bindGateway({
        email: body.email ?? '',
        password: body.password ?? '',
        gatewayName: body.gatewayName,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'gateway_bind_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async refresh(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.success(await refreshGatewayToken(body.refreshToken ?? '', this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'gateway_refresh_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
