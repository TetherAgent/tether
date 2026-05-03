import { Controller } from 'egg';
import { requireManagementToken } from '../../middleware/admin-auth.js';
import { listAdminDevices, revokeAdminDevice } from '../../service/admin/devices.js';

export default class AdminDevicesController extends Controller {
  public async index(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.body = await listAdminDevices(this.app.config, page, limit);
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_devices_failed' };
    }
  }

  public async revoke(): Promise<void> {
    try {
      const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const { id } = this.ctx.params as Record<string, string>;
      await revokeAdminDevice(id, identity.adminUserId, identity.accountId, identity.workspaceId);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'not_found' ? 404
        : error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401
        : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'revoke_device_failed' };
    }
  }
}
