import { Controller } from 'egg';

const APP_VERSION = process.env.TETHER_APP_VERSION ?? process.env.npm_package_version ?? '0.0.0-dev';

export default class AuthController extends Controller {
  public async register(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.registerNormalUser({
      email: body.email ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
      deviceName: body.deviceName,
      platform: body.platform ?? (ctx.get('x-client-platform') || undefined),
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }

  public async login(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.loginNormalUser({
      email: body.email ?? '',
      password: body.password ?? '',
      deviceName: body.deviceName,
      platform: body.platform ?? (ctx.get('x-client-platform') || undefined),
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

  public async me(): Promise<void> {
    const { ctx } = this;
    const data = await ctx.service.auth.currentUserFromToken(ctx.get('authorization'));
    ctx.success({
      ...data,
      app: {
        version: APP_VERSION
      }
    });
  }
}
