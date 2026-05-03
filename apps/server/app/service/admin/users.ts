import { Service } from 'egg';

export default class AdminUsersService extends Service {
  public async listAdminUsers(page: number, limit: number) {
    const { ctx } = this;

    const offset = (page - 1) * limit;
    const users = await ctx.service.authRepository.loadAllUsers(limit, offset);
    const total = await ctx.service.authRepository.countUsers();
    const items = await Promise.all(users.map(async (u) => {
      const stats = await ctx.service.authRepository.loadUserLoginStats(u.id);
      const activeDeviceCount = await ctx.service.authRepository.countActiveDevicesByUserId(u.id);
      return {
        id: u.id,
        email: u.email,
        createdAt: u.createdAt,
        loginCount: stats.loginCount,
        failedLoginCount: stats.failedLoginCount,
        lastLoginAt: stats.lastLoginAt,
        activeDeviceCount
      };
    }));
    return { users: items, total };
  }

  public async getDashboardStats() {
    const { ctx } = this;

    const [totalUsers, activeDevices, registeredGateways, auditEventsLast7Days] = await Promise.all([
      ctx.service.authRepository.countUsers(),
      ctx.service.authRepository.countActiveDevices(),
      ctx.service.gatewayRepository.countGateways(),
      ctx.service.auditRepository.countAuditEventsLast7Days()
    ]);
    return { totalUsers, activeDevices, registeredGateways, auditEventsLast7Days };
  }
}
