import { Controller } from 'egg';
import { ResponseCode } from '../types/response';

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
      this.ctx.success(result);
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'email_already_registered'
          ? ResponseCode.CONFLICT
          : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'register_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
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
      this.ctx.success(result);
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'invalid_credentials'
          ? ResponseCode.UNAUTHORIZED
          : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'login_failed',
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
        msg: error instanceof Error ? error.message : 'refresh_failed',
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
        msg: error instanceof Error ? error.message : 'logout_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async me(): Promise<void> {
    try {
      const payload = await currentUserFromToken(this.ctx.get('authorization'), this.app.config);
      this.ctx.success(payload);
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'me_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
