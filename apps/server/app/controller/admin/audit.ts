import { Controller } from 'egg';
import { requireManagementToken } from '../../middleware/admin-auth.js';
import { listAdminAuditEvents } from '../../service/admin/audit.js';

export default class AdminAuditController extends Controller {
  public async index(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(200, Math.max(1, Number(query.limit ?? '50')));
      this.ctx.body = await listAdminAuditEvents(this.app.config, {
        page, limit,
        userId: query.userId,
        action: query.action,
        deviceId: query.deviceId,
        gatewayId: query.gatewayId,
        from: query.from,
        to: query.to
      });
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_audit_failed' };
    }
  }
}
