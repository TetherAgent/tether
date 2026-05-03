import { Controller } from 'egg';

export default class AdminAuthController extends Controller {
  public async register(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.registerManagementUser({
      email: body.email ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
      deviceName: body.deviceName,
      platform: body.platform,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }

  public async login(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.loginManagementUser({
      email: body.email ?? '',
      password: body.password ?? '',
      deviceName: body.deviceName,
      platform: body.platform,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }

  public async refresh(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.refreshFromToken(body.refreshToken ?? '');
    ctx.success(data);
  }

  public async logout(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    await ctx.service.auth.logoutToken(body.token ?? body.refreshToken ?? '');
    ctx.success({ ok: true });
  }
}
