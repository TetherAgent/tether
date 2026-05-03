import type { Context } from 'egg';

import type { AuthTokenClass } from '@tether/core';

type VerifyLoginOptions = {
  expected?: AuthTokenClass[];
};

function normalizePath(url: string): string {
  return url.split('?')[0] ?? url;
}

export default function verifyLogin(options: VerifyLoginOptions = {}) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const path = normalizePath(ctx.url);
    const whitelist = new Set<string>(ctx.app.config.verifyLoginWhitelist ?? []);
    if (whitelist.has(path) || path === '/') {
      await next();
      return;
    }

    const authorization = ctx.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
      ctx.throw(402, 'Token 必填');
    }
    const token = authorization.slice(7).trim();
    const payload = await ctx.service.auth.verifyToken(token);
    const expected = options.expected ?? [
      'normal_client_access',
      'management_access',
      'gateway_access'
    ] satisfies AuthTokenClass[];
    if (!expected.includes(payload.tokenClass)) {
      ctx.throw(402, 'Token 异常');
    }
    ctx.state.auth = payload;
    await next();
  };
}
