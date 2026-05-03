import type { Context } from 'egg';
import { ResponseCode, ResponseMsg } from '../types/response';

type EggHttpError = Error & {
  status?: number;
  code?: number;
};

export default function errorMiddleware(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      const err = error as EggHttpError;
      ctx.app.emit('error', err, ctx);
      const status = err.status ?? ResponseCode.INTERNAL_SERVER_ERROR;

      ctx.error({
        code: typeof err.code === 'number' ? err.code : status,
        msg: err.message || ResponseMsg.INTERNAL_SERVER_ERROR,
        stack: err.stack
      });
    }
  };
}
