import { Controller } from 'egg';
import { ResponseCode } from '../types/response';

import { auditEvents, recordAuditEvent } from '../service/audit';

export default class AuditController extends Controller {
  public async create(): Promise<void> {
    const body = this.ctx.request.body as Record<string, unknown>;
    if (!body.accountId) {
      this.ctx.error({ code: ResponseCode.BAD_REQUEST, msg: 'accountId 必填' });
      return;
    }
    const event = await recordAuditEvent({
      accountId: String(body.accountId),
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
    this.ctx.success(event);
  }

  public async index(): Promise<void> {
    this.ctx.success({
      events: await auditEvents()
    });
  }
}
