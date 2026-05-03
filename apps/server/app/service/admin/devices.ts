import type { AuthConfig } from '../auth.js';
import { runtimeStore } from '../runtime.js';
import { mysqlModeEnabled, loadAllDevices, countDevices, revokeDeviceById, revokeRefreshTokensByDeviceId, loadDeviceById } from '../storage.js';
import { recordAuditEvent } from '../audit.js';

export async function listAdminDevices(_config: AuthConfig, page: number, limit: number) {
  if (mysqlModeEnabled()) {
    const offset = (page - 1) * limit;
    const devices = await loadAllDevices(limit, offset);
    const total = await countDevices();
    return {
      devices: devices.map(d => ({
        id: d.id, name: d.name, platform: d.platform,
        userId: d.userId ?? null, userEmail: d.userEmail,
        status: d.revokedAt ? 'revoked' : 'active' as const,
        lastSeenAt: null // devices 表当前无 last_seen_at 列
      })),
      total
    };
  }
  const store = runtimeStore();
  const all = [...store.devices.values()];
  const total = all.length;
  const paginated = all.slice((page - 1) * limit, page * limit);
  return {
    devices: paginated.map(d => ({
      id: d.id, name: d.name, platform: d.platform,
      userId: d.userId ?? null, userEmail: null,
      status: 'active' as const, lastSeenAt: null
    })),
    total
  };
}

export async function revokeAdminDevice(
  deviceId: string,
  adminUserId: string,
  accountId: string,
  workspaceId: string
) {
  if (mysqlModeEnabled()) {
    const device = await loadDeviceById(deviceId);
    if (!device) throw new Error('not_found');
    // 1. 标记设备为已吊销
    await revokeDeviceById(deviceId);
    // 2. 撤销该设备的所有 active refresh tokens（防止已吊销设备继续刷新 token）
    await revokeRefreshTokensByDeviceId(deviceId);
    // 3. 记录审计事件
    await recordAuditEvent({
      accountId, workspaceId, adminUserId,
      action: 'admin.device.revoked',
      tokenClass: 'management_access',
      payload: { deviceId }
    });
    return { ok: true };
  }
  const store = runtimeStore();
  const device = store.devices.get(deviceId);
  if (!device) throw new Error('not_found');
  // 内存模式：DeviceRecord 无 revokedAt 字段，简单从 store 中删除作为吊销标记
  store.devices.delete(deviceId);
  return { ok: true };
}
