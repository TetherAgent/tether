import type { AuthConfig } from '../auth.js';
import { runtimeStore } from '../runtime.js';
import { mysqlModeEnabled, loadAllGateways, countGateways, deleteGatewayById, loadGatewayById } from '../storage.js';
import { recordAuditEvent } from '../audit.js';

export async function listAdminGateways(_config: AuthConfig, page: number, limit: number) {
  if (mysqlModeEnabled()) {
    const offset = (page - 1) * limit;
    const gateways = await loadAllGateways(limit, offset);
    const total = await countGateways();
    return {
      gateways: gateways.map(g => ({
        id: g.id,
        lastSeenAt: g.lastSeenAt,
        status: g.status
      })),
      total
    };
  }
  const store = runtimeStore();
  const all = [...store.gateways.values()];
  const total = all.length;
  const paginated = all.slice((page - 1) * limit, page * limit);
  return {
    gateways: paginated.map(g => ({ id: g.id, lastSeenAt: g.lastSeenAt, status: g.status })),
    total
  };
}

export async function unlinkAdminGateway(
  gatewayId: string,
  adminUserId: string,
  accountId: string,
  workspaceId: string
) {
  if (mysqlModeEnabled()) {
    const gateway = await loadGatewayById(gatewayId);
    if (!gateway) throw new Error('not_found');
    await deleteGatewayById(gatewayId);
    await recordAuditEvent({
      accountId, workspaceId, adminUserId,
      action: 'admin.gateway.unlinked',
      tokenClass: 'management_access',
      payload: { gatewayId }
    });
    return { ok: true };
  }
  const store = runtimeStore();
  if (!store.gateways.has(gatewayId)) throw new Error('not_found');
  store.gateways.delete(gatewayId);
  return { ok: true };
}
