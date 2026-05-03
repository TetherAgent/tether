import { Controller } from 'egg';
import { requireManagementToken } from '../../middleware/admin-auth';
import { listAdminManagers, deleteAdminManager } from '../../service/admin/admins';
import { registerManagementUser } from '../../service/auth';

export default class AdminAdminsController extends Controller {
  public async index(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      this.ctx.body = await listAdminManagers(this.app.config);
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_admins_failed' };
    }
  }

  public async create(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const body = this.ctx.request.body as Record<string, string | undefined>;
      const result = await registerManagementUser({
        email: body.email ?? '',
        password: body.password ?? '',
        displayName: body.displayName,
        deviceName: body.deviceName ?? 'admin-web',
        platform: body.platform ?? 'web',
        ip: this.ctx.ip,
        userAgent: this.ctx.get('user-agent')
      }, this.app.config);
      this.ctx.status = 201;
      this.ctx.body = result;
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'email_already_registered' ? 409
        : error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401
        : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'create_admin_failed' };
    }
  }

  public async destroy(): Promise<void> {
    try {
      const identity = requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const { id } = this.ctx.params as Record<string, string>;
      await deleteAdminManager(id, identity.adminUserId ?? '', identity.accountId, identity.workspaceId);
      this.ctx.body = { ok: true };
    } catch (error) {
      this.ctx.status = error instanceof Error && error.message === 'not_found' ? 404
        : error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401
        : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'delete_admin_failed' };
    }
  }
}
