import { Controller } from 'egg';
import { listAdminUsers, getDashboardStats } from '../../service/admin/users';
import { ResponseCode } from '../../types/response';

export default class AdminUsersController extends Controller {
  public async index(): Promise<void> {
    try {
      const query = this.ctx.query as Record<string, string | undefined>;
      const page = Math.max(1, Number(query.page ?? '1'));
      const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
      this.ctx.success(await listAdminUsers(this.app.config, page, limit));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'list_users_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  public async dashboard(): Promise<void> {
    try {
      this.ctx.success(await getDashboardStats(this.app.config));
    } catch (error) {
      this.ctx.error({
        code: ResponseCode.BAD_REQUEST,
        msg: error instanceof Error ? error.message : 'dashboard_failed',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}
