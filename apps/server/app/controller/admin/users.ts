import { Controller } from 'egg';

export default class AdminUsersController extends Controller {
  public async index(): Promise<void> {
    const { ctx } = this;
    const query = ctx.query as Record<string, string | undefined>;
    const page = Math.max(1, Number(query.page ?? '1'));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? '20')));
    const data = await ctx.service.admin.users.listAdminUsers(page, limit);
    ctx.success(data);
  }

  public async dashboard(): Promise<void> {
    const { ctx } = this;
    const data = await ctx.service.admin.users.getDashboardStats();
    ctx.success(data);
  }
}
