import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  userId?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    userId: auth?.userId ?? ''
  };
}

export default class SessionController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const limit = Math.min(Number(ctx.query.limit) || 50, 200);
    const offset = Math.max(Number(ctx.query.offset) || 0, 0);
    const status = typeof ctx.query.status === 'string' && ctx.query.status.trim()
      ? ctx.query.status.trim()
      : 'running';
    const transport = typeof ctx.query.transport === 'string' && ctx.query.transport.trim()
      ? ctx.query.transport.trim()
      : undefined;
    const sessions = await ctx.service.sessionRepository.listSessions(accountId, userId, limit, offset, {
      status,
      transport
    });
    ctx.success({ sessions });
  }

  public async events(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const limit = Math.min(Number(ctx.query.limit) || Number(ctx.query.tail) || 100, 5000);
    const before = ctx.query.before !== undefined ? Number(ctx.query.before) : undefined;
    const after = ctx.query.after !== undefined ? Number(ctx.query.after) : undefined;
    const events = await ctx.service.sessionRepository.listEvents(ctx.params.id, accountId, userId, {
      limit,
      before,
      after
    });
    ctx.success({ events });
  }

  public async renameTitle(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { id } = ctx.params as { id: string };
    const { title } = ctx.request.body as { title?: string };
    if (!id || typeof title !== 'string' || !title.trim()) {
      ctx.throw(400, 'session id and title are required');
      return;
    }
    await ctx.service.sessionRepository.renameSessionTitle(id, accountId, userId, title.trim());
    ctx.success({ ok: true });
  }

  public async archive(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { id } = ctx.params as { id: string };
    if (!id) {
      ctx.throw(400, 'session id is required');
      return;
    }
    await ctx.service.sessionRepository.archiveSession(id, accountId, userId);
    ctx.success({ ok: true });
  }
}
