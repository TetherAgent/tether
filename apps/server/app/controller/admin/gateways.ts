import { Controller } from 'egg';
import { requireManagementToken } from '../../middleware/admin-auth';
import { listAdminGateways, unlinkAdminGateway } from '../../service/admin/gateways';

export default class AdminGatewaysController extends Controller {
  public async index(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.body = await listAdminGateways(this.app.config, page, limit);
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_gateways_failed' };
    }
  }

  public async unlink(): Promise<void> {
    try {
      const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
      if (!identity.adminUserId) throw new Error('missing_admin_user_id');
      const { id } = this.ctx.params as Record<string, string>;
      await unlinkAdminGateway(id, identity.adminUserId, identity.accountId, identity.workspaceId);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'not_found' ? 404
        : error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401
        : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'unlink_gateway_failed' };
    }
  }
}
