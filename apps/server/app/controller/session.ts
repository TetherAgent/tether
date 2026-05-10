import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  workspaceId?: string;
  userId?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; workspaceId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    workspaceId: auth?.workspaceId ?? '',
    userId: auth?.userId ?? ''
  };
}

export default class SessionController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId, userId } = authScope(ctx);
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const offset = Math.max(Number(ctx.query.offset) || 0, 0);
    const sessions = await ctx.service.sessionRepository.listSessions(accountId, workspaceId, userId, limit, offset);
    ctx.success({ sessions });
  }

  public async events(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId, userId } = authScope(ctx);
    const limit = Math.min(Number(ctx.query.limit) || Number(ctx.query.tail) || 100, 5000);
    const before = ctx.query.before !== undefined ? Number(ctx.query.before) : undefined;
    const after = ctx.query.after !== undefined ? Number(ctx.query.after) : undefined;
    const events = await ctx.service.sessionRepository.listEvents(ctx.params.id, accountId, workspaceId, userId, {
      limit,
      before,
      after
    });
    ctx.success({ events });
  }
}
