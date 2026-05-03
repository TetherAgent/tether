import { Controller } from 'egg';
import { listAdminAuditEvents } from '../../service/admin/audit';
import { ResponseCode } from '../../types/response';

export default class AdminAuditController extends Controller {
  public async index(): Promise<void> {
    try {
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
      this.ctx.success(await listAdminAuditEvents(this.app.config, {
        page, limit,
        userId: query.userId,
        action: query.action,
        deviceId: query.deviceId,
        gatewayId: query.gatewayId,
        from: query.from,
        to: query.to
      }));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'list_audit_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
