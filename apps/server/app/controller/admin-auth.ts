import { Controller } from 'egg';

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
      this.ctx.status = 201;
      this.ctx.body = result;
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'email_already_registered' ? 409 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'admin_register_failed' };
    }
  }

  public async login(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await loginManagementUser({
        email: body.email ?? '',
        password: body.password ?? '',
        deviceName: body.deviceName,
        platform: body.platform,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config);
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'invalid_credentials' ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'admin_login_failed' };
    }
  }

  public async refresh(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await refreshFromToken(body.refreshToken ?? '', this.app.config);
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'admin_refresh_failed' };
    }
  }

  public async logout(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      await logoutToken(body.token ?? body.refreshToken ?? '', this.app.config);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'admin_logout_failed' };
    }
  }
}
