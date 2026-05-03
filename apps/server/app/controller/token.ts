import { Controller } from 'egg';
import { ResponseCode } from '../types/response';

import { revokeToken, validateToken } from '../service/auth';

export default class TokenController extends Controller {
  public async revoke(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      await revokeToken(body.token ?? '', this.app.config);
      this.ctx.success({ ok: true });
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'token_revoke_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async validate(): Promise<void> {
    try {
      const body = this.ctx.request.body as Record<string, string | undefined>;
      this.ctx.success(await validateToken(body.token ?? '', this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.UNAUTHORIZED,
        msg: error instanceof Error ? error.message : 'token_validate_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
