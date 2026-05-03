import type { AuthConfig } from '../auth.js';
import { runtimeStore } from '../runtime.js';
import { mysqlModeEnabled, loadAuditEventsFiltered, countAuditEventsFiltered } from '../storage.js';

export async function listAdminAuditEvents(
  _config: AuthConfig,
  params: {
    page: number;
    limit: number;
    userId?: string;
    action?: string;
    deviceId?: string;
    gatewayId?: string;
    from?: string;  // ISO date string or timestamp ms string
    to?: string;
  }
) {
  const fromMs = params.from ? (Number(params.from) || new Date(params.from).getTime() || undefined) : undefined;
  const toMs = params.to ? (Number(params.to) || new Date(params.to).getTime() || undefined) : undefined;

  if (mysqlModeEnabled()) {
    const offset = (params.page - 1) * params.limit;
    const events = await loadAuditEventsFiltered({
      userId: params.userId,
      eventType: params.action,
      deviceId: params.deviceId,
      gatewayId: params.gatewayId,
      fromMs: fromMs !== undefined && !isNaN(fromMs) ? fromMs : undefined,
      toMs: toMs !== undefined && !isNaN(toMs) ? toMs : undefined,
      limit: params.limit,
      offset
    });
    const total = await countAuditEventsFiltered({
      userId: params.userId,
      eventType: params.action,
      deviceId: params.deviceId,
      gatewayId: params.gatewayId,
      fromMs: fromMs !== undefined && !isNaN(fromMs) ? fromMs : undefined,
      toMs: toMs !== undefined && !isNaN(toMs) ? toMs : undefined
    });
    return {
      events: events.map(e => ({
        id: e.id, action: e.action,
        userId: e.userId ?? null, adminUserId: e.adminUserId ?? null,
        deviceId: e.deviceId ?? null, gatewayId: e.gatewayId ?? null,
        createdAt: e.createdAt, payload: e.payload
      })),
      total
    };
  }
  const store = runtimeStore();
  let all = store.auditEvents;
  if (params.userId) all = all.filter(e => e.userId === params.userId);
  if (params.action) all = all.filter(e => e.action === params.action);
  if (params.deviceId) all = all.filter(e => e.deviceId === params.deviceId);
  if (params.gatewayId) all = all.filter(e => e.gatewayId === params.gatewayId);
  if (fromMs !== undefined && !isNaN(fromMs)) all = all.filter(e => e.createdAt >= fromMs);
  if (toMs !== undefined && !isNaN(toMs)) all = all.filter(e => e.createdAt <= toMs);
  const total = all.length;
  const paginated = all.slice((params.page - 1) * params.limit, params.page * params.limit);
  return {
    events: paginated.map(e => ({
      id: e.id, action: e.action,
      userId: e.userId ?? null, adminUserId: e.adminUserId ?? null,
      deviceId: e.deviceId ?? null, gatewayId: e.gatewayId ?? null,
      createdAt: e.createdAt, payload: e.payload
    })),
    total
  };
}
