import { Controller } from 'egg';
import { ResponseCode } from '../types/response';

import {
  loginManagementUser,
  logoutToken,
  refreshFromToken,
  registerManagementUser
} from '../service/auth';

export default class AdminAuthController extends Controller {
  public async register(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      const result = await registerManagementUser({
        email: body.email ?? '',
        password: body.password ?? '',
        displayName: body.displayName,
        deviceName: body.deviceName,
        platform: body.platform,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config);
      this.ctx.success(result);
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'email_already_registered'
          ? ResponseCode.CONFLICT
          : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'admin_register_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async login(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.success(await loginManagementUser({
        email: body.email ?? '',
        password: body.password ?? '',
        deviceName: body.deviceName,
        platform: body.platform,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config));
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'invalid_credentials'
          ? ResponseCode.UNAUTHORIZED
          : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'admin_login_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async refresh(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.success(await refreshFromToken(body.refreshToken ?? '', this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'admin_refresh_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async logout(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      await logoutToken(body.token ?? body.refreshToken ?? '', this.app.config);
      this.ctx.success({ ok: true });
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'admin_logout_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
