import type { Context } from 'egg';

export default function requireRuntimeSyncSecret() {
  return async (ctx: Context, next: () => Promise<unknown>) => {
    const secret = ctx.get('x-tether-runtime-sync-secret');
    const expected = (ctx.app.config as Record<string, unknown>).runtimeSyncSecret as string | undefined;
    if (!expected || secret !== expected) {
      ctx.throw(403, 'Invalid sync secret');
    }
    await next();
  };
}
