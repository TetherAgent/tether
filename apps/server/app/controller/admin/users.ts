import { Controller } from 'egg';
import { requireManagementToken } from '../../middleware/admin-auth';
import { listAdminUsers, getDashboardStats } from '../../service/admin/users';

export default class AdminUsersController extends Controller {
  public async index(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.body = await listAdminUsers(this.app.config, page, limit);
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'list_users_failed' };
    }
  }

  public async dashboard(): Promise<void> {
    try {
      requireManagementToken(this.ctx.get('authorization'), this.app.config);
      this.ctx.body = await getDashboardStats(this.app.config);
    } catch (error) {
      this.ctx.status = error instanceof Error && (error.message === 'missing_token' || error.message === 'wrong_token_class') ? 401 : 400;
      this.ctx.body = { error: error instanceof Error ? error.message : 'dashboard_failed' };
    }
  }
}
