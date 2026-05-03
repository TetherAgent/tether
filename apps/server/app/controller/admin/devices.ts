import { Controller } from 'egg';
import { listAdminDevices, revokeAdminDevice } from '../../service/admin/devices';
import { ResponseCode } from '../../types/response';

export default class AdminDevicesController extends Controller {
  public async index(): Promise<void> {
    try {
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.success(await listAdminDevices(this.app.config, page, limit));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'list_devices_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async revoke(): Promise<void> {
    try {
      const identity = this.ctx.state.auth as { adminUserId?: string; accountId: string; workspaceId: string };
      if (!identity.adminUserId) throw new Error('missing_admin_user_id');
      const { id } = this.ctx.params as Record<string, string>;
      await revokeAdminDevice(id, identity.adminUserId, identity.accountId, identity.workspaceId);
      this.ctx.success({ ok: true });
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'not_found' ? ResponseCode.NOT_FOUND : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'revoke_device_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
