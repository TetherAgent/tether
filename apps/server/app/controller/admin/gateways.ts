import { Controller } from 'egg';

export default class AdminGatewaysController extends Controller {
  public async index(): Promise<void> {
    const { ctx } = this;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
    const data = await ctx.service.admin.gateways.listAdminGateways(page, limit);
    ctx.success(data);
  }

  public async unlink(): Promise<void> {
    const { ctx } = this;
    const identity = ctx.state.auth as { adminUserId?: string; accountId: string; workspaceId: string };
    const { id } = ctx.params as Record<string, string>;
    await ctx.service.admin.gateways.unlinkAdminGateway(id, identity.adminUserId ?? '', identity.accountId, identity.workspaceId);
    ctx.success({ ok: true });
  }
}
