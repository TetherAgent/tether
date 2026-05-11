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
        accountId: g.accountId,
        userId: g.userId,
        name: g.name,
        deviceKey: g.deviceKey ?? null,
        hostname: g.hostname ?? null,
        localPort: g.localPort ?? null,
        lastSeenAt: g.lastSeenAt,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        status: g.status === 'revoked' ? 'unlinked' : g.status
      })),
      total
    };
  }

  public async unlinkAdminGateway(
    gatewayId: string,
    adminUserId: string,
    accountId: string
  ) {
    const { ctx } = this;
    if (!adminUserId) ctx.throw(400, 'missing_admin_user_id');

    const gateway = await ctx.service.gatewayRepository.loadGatewayById(gatewayId);
    if (!gateway || gateway.accountId !== accountId) {
      ctx.throw(404, 'not_found');
      return;
    }

    await ctx.service.gatewayRepository.deleteGatewayById(gatewayId);
    await ctx.service.audit.recordAuditEvent({
      accountId,
      adminUserId,
      action: 'admin.gateway.unlinked',
      tokenClass: 'management_access',
      payload: { gatewayId }
    });
    return { ok: true };
  }
}
