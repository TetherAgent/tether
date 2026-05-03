import type { AuthConfig } from '../auth';
import { runtimeStore } from '../runtime';
import { mysqlModeEnabled, loadAllAdminUsers, deleteAdminUserById, loadAdminUserById } from '../storage';
import { recordAuditEvent } from '../audit';

export async function listAdminManagers(_config: AuthConfig) {
  if (mysqlModeEnabled()) {
    const items = await loadAllAdminUsers();
    return {
      admins: items.map(u => ({
        id: u.id, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt
      }))
    };
  }
  const store = runtimeStore();
  return {
    admins: [...store.adminUsers.values()].map(u => ({
      id: u.id, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt
    }))
  };
}

export async function deleteAdminManager(
  id: string,
  adminUserId: string,
  accountId: string,
  workspaceId: string
) {
  if (mysqlModeEnabled()) {
    const target = await loadAdminUserById(id);
    if (!target) throw new Error('not_found');
    await deleteAdminUserById(id);
    await recordAuditEvent({
      accountId, workspaceId, adminUserId,
      action: 'admin.admin_user.deleted',
      tokenClass: 'management_access',
      payload: { targetAdminUserId: id }
    });
    return { ok: true };
  }
  const store = runtimeStore();
  if (!store.adminUsers.has(id)) throw new Error('not_found');
  store.adminUsers.delete(id);
  return { ok: true };
}
