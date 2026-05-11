import { Controller } from 'egg';

export default class TokenController extends Controller {

  public async validate(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.validateToken(body.token ?? '');
    ctx.success(data);
  }
}
