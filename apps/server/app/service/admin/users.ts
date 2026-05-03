import type { AuthConfig } from '../auth';
import { runtimeStore } from '../runtime';
import {
  mysqlModeEnabled,
  loadAllUsers,
  countUsers,
  loadUserLoginStats,
  countActiveDevicesByUserId,
  countActiveDevices,
  countRegisteredGateways,
  countAuditEventsLast7Days
} from '../storage';

export async function listAdminUsers(_config: AuthConfig, page: number, limit: number) {
  if (mysqlModeEnabled()) {
    const offset = (page - 1) * limit;
    const users = await loadAllUsers(limit, offset);
    const total = await countUsers();
    const items = await Promise.all(users.map(async (u) => {
      const stats = await loadUserLoginStats(u.id);
      const activeDeviceCount = await countActiveDevicesByUserId(u.id);
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
  const store = runtimeStore();
  const all = [...store.users.values()];
  const total = all.length;
  const paginated = all.slice((page - 1) * limit, page * limit);
  return {
    users: paginated.map(u => ({
      id: u.id, email: u.email, createdAt: u.createdAt,
      loginCount: 0, failedLoginCount: 0, lastLoginAt: null, activeDeviceCount: 0
    })),
    total
  };
}

export async function getDashboardStats(_config: AuthConfig) {
  if (mysqlModeEnabled()) {
    const [totalUsers, activeDevices, registeredGateways, auditEventsLast7Days] = await Promise.all([
      countUsers(),
      countActiveDevices(),
      countRegisteredGateways(),
      countAuditEventsLast7Days()
    ]);
    return { totalUsers, activeDevices, registeredGateways, auditEventsLast7Days };
  }
  const store = runtimeStore();
  return {
    totalUsers: store.users.size,
    activeDevices: store.devices.size,
    registeredGateways: store.gateways.size,
    auditEventsLast7Days: 0
  };
}
