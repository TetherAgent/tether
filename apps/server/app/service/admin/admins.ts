import { Service } from 'egg';

export default class AdminAdminsService extends Service {
  public async listAdminManagers() {
    const { ctx } = this;

    const items = await ctx.service.authRepository.loadAllAdminUsers();
    return {
      admins: items.map(u => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt
      }))
    };
  }

  public async deleteAdminManager(
    id: string,
    adminUserId: string,
    accountId: string,
    workspaceId: string
  ) {
    const { ctx } = this;

    const target = await ctx.service.authRepository.loadAdminUserById(id);
    if (!target) ctx.throw(404, 'not_found');

    await ctx.service.authRepository.deleteAdminUserById(id);
    await ctx.service.audit.recordAuditEvent({
      accountId,
      workspaceId,
      adminUserId,
      action: 'admin.admin_user.deleted',
      tokenClass: 'management_access',
      payload: { targetAdminUserId: id }
    });
    return { ok: true };
  }
}
