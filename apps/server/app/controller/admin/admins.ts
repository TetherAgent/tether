import { Controller } from 'egg';
import { listAdminManagers, deleteAdminManager } from '../../service/admin/admins';
import { registerManagementUser } from '../../service/auth';
import { ResponseCode } from '../../types/response';

export default class AdminAdminsController extends Controller {
  public async index(): Promise<void> {
    try {
      this.ctx.success(await listAdminManagers(this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'list_admins_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async create(): Promise<void> {
    try {
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
      this.ctx.success(result);
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'email_already_registered'
          ? ResponseCode.CONFLICT
          : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'create_admin_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async destroy(): Promise<void> {
    try {
      const identity = this.ctx.state.auth as { adminUserId?: string; accountId: string; workspaceId: string };
      const { id } = this.ctx.params as Record<string, string>;
      await deleteAdminManager(id, identity.adminUserId ?? '', identity.accountId, identity.workspaceId);
      this.ctx.success({ ok: true });
    } catch (error) {
      this.ctx.error({
        code: error instanceof Error && error.message === 'not_found' ? ResponseCode.NOT_FOUND : ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'delete_admin_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
