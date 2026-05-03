import type { Context } from 'egg';
import { ResponseCode, ResponseMsg } from '../types/response';

export default function errorMiddleware(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      ctx.app.emit('error', error as Error, ctx);

      ctx.error({
        code: ResponseCode.INTERNAL_SERVER_ERROR,
        msg: error instanceof Error ? error.message : ResponseMsg.INTERNAL_SERVER_ERROR,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  };
}
