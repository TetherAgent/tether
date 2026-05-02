import { Controller } from 'egg';

import {
  currentUserFromToken,
  loginNormalUser,
  logoutToken,
  refreshFromToken,
  registerNormalUser
} from '../service/auth';

export default class AuthController extends Controller {
  public async register(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      const result = await registerNormalUser({
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
      this.ctx.body = { error: error instanceof Error ? error.message : 'register_failed' };
    }
  }

  public async login(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      const result = await loginNormalUser({
        email: body.email ?? '',
        password: body.password ?? '',
        deviceName: body.deviceName,
        platform: body.platform,
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config);
      this.ctx.body = result;
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'invalid_credentials' ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'login_failed' };
    }
  }

  public async refresh(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await refreshFromToken(body.refreshToken ?? '', this.app.config);
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'refresh_failed' };
    }
  }

  public async logout(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      await logoutToken(body.token ?? body.refreshToken ?? '', this.app.config);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'logout_failed' };
    }
  }

  public async me(): Promise<void> {
    try {
      const payload = await currentUserFromToken(this.ctx.get('authorization'), this.app.config);
      this.ctx.body = payload;
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'me_failed' };
    }
  }
}
