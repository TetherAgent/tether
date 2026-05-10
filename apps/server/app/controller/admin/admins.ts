import { Controller } from 'egg';

export default class AdminAdminsController extends Controller {
  public async index(): Promise<void> {
    const { ctx } = this;
    const data = await ctx.service.admin.admins.listAdminManagers();
    ctx.success(data);
  }

  public async create(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, string | undefined>;
    const data = await ctx.service.auth.registerManagementUser({
      email: body.email ?? '',
      password: body.password ?? '',
      displayName: body.displayName,
      deviceName: body.deviceName ?? 'admin-web',
      platform: body.platform ?? 'web',
      ip: ctx.ip,
      userAgent: ctx.get('user-agent')
    });
    ctx.success(data);
  }

  public async destroy(): Promise<void> {
    const { ctx } = this;
    const identity = ctx.state.auth as { adminUserId?: string; accountId: string };
    const { id } = ctx.params as Record<string, string>;
    await ctx.service.admin.admins.deleteAdminManager(id, identity.adminUserId ?? '', identity.accountId);
    ctx.success({ ok: true });
  }
}
