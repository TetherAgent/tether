import { Controller } from 'egg';

export default class TokenController extends Controller {
  public async revoke(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    await ctx.service.auth.revokeToken(body.token ?? '');
    ctx.success({ ok: true });
  }

  public async validate(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.validateToken(body.token ?? '');
    ctx.success(data);
  }
}
