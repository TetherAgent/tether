import { Service } from 'egg';

export default class AdminGatewaysService extends Service {
  public async listAdminGateways(page: number, limit: number) {
    const { ctx } = this;

    const offset = (page - 1) * limit;
    const gateways = await ctx.service.gatewayRepository.loadAllGateways(limit, offset);
    const total = await ctx.service.gatewayRepository.countGateways();
    return {
      gateways: gateways.map(g => ({
        id: g.id,
        lastSeenAt: g.lastSeenAt,
        status: g.status
      })),
      total
    };
  }

  public async unlinkAdminGateway(
    gatewayId: string,
    adminUserId: string,
    accountId: string,
    workspaceId: string
  ) {
    const { ctx } = this;
    if (!adminUserId) ctx.throw(400, 'missing_admin_user_id');

    const gateway = await ctx.service.gatewayRepository.loadGatewayById(gatewayId);
    if (!gateway) ctx.throw(404, 'not_found');

    await ctx.service.gatewayRepository.deleteGatewayById(gatewayId);
    await ctx.service.audit.recordAuditEvent({
      accountId,
      workspaceId,
      adminUserId,
      action: 'admin.gateway.unlinked',
      tokenClass: 'management_access',
      payload: { gatewayId }
    });
    return { ok: true };
  }
}
