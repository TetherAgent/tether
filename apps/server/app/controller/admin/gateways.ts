import { Controller } from 'egg';
import { listAdminGateways, unlinkAdminGateway } from '../../service/admin/gateways';
import { ResponseCode } from '../../types/response';

export default class AdminGatewaysController extends Controller {
  public async index(): Promise<void> {
    try {
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.success(await listAdminGateways(this.app.config, page, limit));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'list_gateways_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async unlink(): Promise<void> {
    try {
      const identity = this.ctx.state.auth as { adminUserId?: string; accountId: string; workspaceId: string };
      if (!identity.adminUserId) throw new Error('missing_admin_user_id');
      const { id } = this.ctx.params as Record<string, string>;
      await unlinkAdminGateway(id, identity.adminUserId, identity.accountId, identity.workspaceId);
      this.ctx.success({ ok: true });
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'not_found' ? ResponseCode.NOT_FOUND : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'unlink_gateway_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
