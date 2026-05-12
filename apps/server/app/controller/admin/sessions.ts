import { Controller } from 'egg';

export default class AdminSessionsController extends Controller {
  public async index(): Promise<void> {
    const { ctx } = this;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
    const data = await ctx.service.admin.sessions.listAdminSessions(page, limit, {
      userId: query.userId,
      gatewayId: query.gatewayId,
      transport: query.transport,
      status: query.status,
    });
    ctx.success(data);
  }

  public async show(): Promise<void> {
    const { ctx } = this;
    const { id } = ctx.params as Record<string, string>;
    const session = await ctx.service.admin.sessions.getAdminSession(id);
    if (!session) ctx.throw(404, 'not_found');
    ctx.success(session);
  }

  public async messages(): Promise<void> {
    const { ctx } = this;
    const { id } = ctx.params as Record<string, string>;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
    const data = await ctx.service.admin.sessions.listAdminChatMessages(id, page, limit);
    ctx.success(data);
  }

  public async events(): Promise<void> {
    const { ctx } = this;
    const { id } = ctx.params as Record<string, string>;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
    const data = await ctx.service.admin.sessions.listAdminRuntimeEvents(id, page, limit);
    ctx.success(data);
  }

  public async chatEvents(): Promise<void> {
    const { ctx } = this;
    const { id } = ctx.params as Record<string, string>;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
    const data = await ctx.service.admin.sessions.listAdminChatEvents(id, page, limit);
    ctx.success(data);
  }
}
