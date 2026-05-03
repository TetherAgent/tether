import type { Context } from 'egg';
import { ResponseCode, ResponseMsg } from '../types/response';

type ApiErrorPayload = {
  code?: number;
  msg?: string;
  data?: unknown;
  stack?: string;
};

declare module 'egg' {
  interface Context {
    success<T = unknown>(data: T): void;
    error(payload: ApiErrorPayload): void;
  }
}

export default {
  success<T = unknown>(this: Context, data: T): void {
    this.status = 200;
    this.body = {
      code: ResponseCode.SUCCESS,
      msg: ResponseMsg.SUCCESS,
      data
    };
  },

  error(this: Context, payload: ApiErrorPayload): void {
    this.status = 200;
    this.body = {
      code: payload.code ?? ResponseCode.INTERNAL_SERVER_ERROR,
      msg: payload.msg ?? ResponseMsg.ERROR,
      data: payload.data ?? null,
      stack: payload.stack
    };
  }
};
