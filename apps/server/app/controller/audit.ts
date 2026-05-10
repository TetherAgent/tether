import { Controller } from 'egg';

export default class AuditController extends Controller {
  public async create(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const event = await ctx.service.audit.recordAuditEvent({
      accountId: String(body.accountId),
      userId: body.userId ? String(body.userId) : undefined,
      adminUserId: body.adminUserId ? String(body.adminUserId) : undefined,
      deviceId: body.deviceId ? String(body.deviceId) : undefined,
      gatewayId: body.gatewayId ? String(body.gatewayId) : undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      action: String(body.action ?? 'custom.audit'),
      tokenClass: body.tokenClass ? String(body.tokenClass) : undefined,
      failureReason: body.failureReason ? String(body.failureReason) : undefined,
      ip: ctx.ip,
      userAgent: ctx.get('user-agent'),
      payload: typeof body.payload === 'object' && body.payload ? body.payload as Record<string, unknown> : {}
    });
    ctx.success(event);
  }

  public async index(): Promise<void> {
    const { ctx } = this;
    ctx.success({
      events: await ctx.service.audit.auditEvents()
    });
  }
}
