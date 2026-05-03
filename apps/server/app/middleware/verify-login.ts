import type { Context } from 'egg';

import { requireTokenClass } from './auth';
import { ResponseCode, ResponseMsg } from '../types/response';
import type { AuthTokenClass } from '@tether/core';

type VerifyLoginOptions = {
  expected: AuthTokenClass[];
};

function normalizePath(url: string): string {
  return url.split('?')[0] ?? url;
}

export default function verifyLogin(options: VerifyLoginOptions) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const path = normalizePath(ctx.url);
    const whitelist = new Set<string>(ctx.app.config.verifyLoginWhitelist ?? []);
    if (whitelist.has(path) || path === '/') {
      await next();
      return;
    }

    try {
      const payload = requireTokenClass(ctx.get('authorization'), ctx.app.config, options.expected);
      ctx.state.auth = payload;
      await next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'token_error';
      const code = message === 'missing_token' || message === 'wrong_token_class'
        ? ResponseCode.TOKEN_ERROR
        : ResponseCode.UNAUTHORIZED;

      ctx.error({
        code,
        msg: message === 'missing_token' ? 'Token 必填'
          : message === 'wrong_token_class' ? ResponseMsg.TOKEN_ERROR
          : ResponseMsg.UNAUTHORIZED,
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  };
}
