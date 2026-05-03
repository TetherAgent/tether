import { Controller } from 'egg';

export default class AdminAuditController extends Controller {
  public async index(): Promise<void> {
    const { ctx } = this;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
    const data = await ctx.service.admin.audit.listAdminAuditEvents({
      page,
      limit,
      userId: query.userId,
      action: query.action,
      deviceId: query.deviceId,
      gatewayId: query.gatewayId,
      from: query.from,
      to: query.to
    });
    ctx.success(data);
  }
}
