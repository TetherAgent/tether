import type { Context } from 'egg';

import type { AuthTokenClass } from '@tether/core';

type RequireTokenClassOptions = {
  expected: AuthTokenClass[];
};

export default function requireTokenClass(options: RequireTokenClassOptions) {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const payload = ctx.state.auth as { tokenClass?: AuthTokenClass } | undefined;
    if (!payload?.tokenClass) {
      ctx.throw(402, 'Token 必填');
    }
    if (!options.expected.includes(payload.tokenClass)) {
      ctx.throw(402, 'Token 异常');
    }
    await next();
  };
}
