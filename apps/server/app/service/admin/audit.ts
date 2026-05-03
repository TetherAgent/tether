import { Service } from 'egg';

type ListAdminAuditEventsParams = {
  page: number;
  limit: number;
  userId?: string;
  action?: string;
  deviceId?: string;
  gatewayId?: string;
  from?: string;
  to?: string;
};

export default class AdminAuditService extends Service {
  private parseTime(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value) || new Date(value).getTime();
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  public async listAdminAuditEvents(params: ListAdminAuditEventsParams) {
    const { ctx } = this;
    const fromMs = this.parseTime(params.from);
    const toMs = this.parseTime(params.to);

    const offset = (params.page - 1) * params.limit;
    const filter = {
      userId: params.userId,
      eventType: params.action,
      deviceId: params.deviceId,
      gatewayId: params.gatewayId,
      fromMs,
      toMs
    };
    const events = await ctx.service.auditRepository.loadAuditEventsFiltered({
      ...filter,
      limit: params.limit,
      offset
    });
    const total = await ctx.service.auditRepository.countAuditEventsFiltered(filter);

    return {
      events: events.map(e => ({
        id: e.id,
        action: e.action,
        userId: e.userId ?? null,
        adminUserId: e.adminUserId ?? null,
        deviceId: e.deviceId ?? null,
        gatewayId: e.gatewayId ?? null,
        createdAt: e.createdAt,
        payload: e.payload
      })),
      total
    };
  }
}
