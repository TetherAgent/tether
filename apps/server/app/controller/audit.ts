import { Controller } from 'egg';

import { auditEvents, recordAuditEvent } from '../service/audit';

export default class AuditController extends Controller {
  public async create(): Promise<void> {
    const body = this.ctx.request.body as Record<string, unknown>;
    const event = await recordAuditEvent({
      accountId: String(body.accountId ?? 'unknown'),
      workspaceId: body.workspaceId ? String(body.workspaceId) : undefined,
      userId: body.userId ? String(body.userId) : undefined,
      adminUserId: body.adminUserId ? String(body.adminUserId) : undefined,
      deviceId: body.deviceId ? String(body.deviceId) : undefined,
      gatewayId: body.gatewayId ? String(body.gatewayId) : undefined,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      action: String(body.action ?? 'custom.audit'),
      tokenClass: body.tokenClass ? String(body.tokenClass) : undefined,
      failureReason: body.failureReason ? String(body.failureReason) : undefined,
      ip: this.ctx.ip,
      userAgent: this.ctx.get('user-agent'),
      payload: typeof body.payload === 'object' && body.payload ? body.payload as Record<string, unknown> : {}
    });
    this.ctx.status = 201;
    this.ctx.body = event;
  }

  public async index(): Promise<void> {
    this.ctx.body = {
      events: await auditEvents()
    };
  }
}
