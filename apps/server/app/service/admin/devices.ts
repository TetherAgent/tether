import { Service } from 'egg';

export default class AdminDevicesService extends Service {
  public async listAdminDevices(page: number, limit: number) {
    const { ctx } = this;

    const offset = (page - 1) * limit;
    const devices = await ctx.service.authRepository.loadAllDevices(limit, offset);
    const total = await ctx.service.authRepository.countDevices();
    return {
      devices: devices.map(d => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        userId: d.userId ?? null,
        userEmail: d.userEmail,
        status: d.revokedAt ? 'revoked' : 'active' as const,
        lastSeenAt: null
      })),
      total
    };
  }

  public async revokeAdminDevice(
    deviceId: string,
    adminUserId: string,
    accountId: string,
    workspaceId: string
  ) {
    const { ctx } = this;
    if (!adminUserId) ctx.throw(400, 'missing_admin_user_id');

    const device = await ctx.service.authRepository.loadDeviceById(deviceId);
    if (!device) ctx.throw(404, 'not_found');

    await ctx.service.authRepository.revokeDeviceById(deviceId);
    await ctx.service.authRepository.revokeRefreshTokensByDeviceId(deviceId);
    await ctx.service.audit.recordAuditEvent({
      accountId,
      workspaceId,
      adminUserId,
      action: 'admin.device.revoked',
      tokenClass: 'management_access',
      payload: { deviceId }
    });
    return { ok: true };
  }
}
