import { Controller } from 'egg';

import { revokeToken, validateToken } from '../service/auth';

export default class TokenController extends Controller {
  public async revoke(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      await revokeToken(body.token ?? '', this.app.config);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'token_revoke_failed' };
    }
  }

  public async validate(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.body = await validateToken(body.token ?? '', this.app.config);
    } catch (error) {
      this.ctx.status = 401;
      this.ctx.body = { error: error instanceof Error ? error.message : 'token_validate_failed' };
    }
  }
}
