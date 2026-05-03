export type AdminUser = {
  id: string;
  email: string;
  createdAt: number;
  loginCount: number;
  failedLoginCount: number;
  lastLoginAt: number | null;
  activeDeviceCount: number;
};

export type AdminUserItem = {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: number;
};

export type AdminDevice = {
  id: string;
  name: string;
  platform: string;
  userId: string | null;
  userEmail: string | null;
  status: 'active' | 'revoked';
  lastSeenAt: number | null;
};

export type AdminGateway = {
  id: string;
  lastSeenAt: number | null;
  status: 'online' | 'offline' | 'unlinked';
};

export type AdminAuditEvent = {
  id: number;
  action: string;
  userId: string | null;
  adminUserId: string | null;
  deviceId: string | null;
  gatewayId: string | null;
  createdAt: number;
  payload: Record<string, unknown>;
};

type RequestOptions = RequestInit & { token?: string };

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type') && options.body) {
    headers.set('content-type', 'application/json');
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => undefined) as { error?: string } | T | undefined;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `request_failed_${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function listUsers(token: string, page = 1) {
  return requestJson<{ users: AdminUser[]; total: number }>(
    `/admin/api/users?page=${page}&limit=20`, { token });
}

export async function listAdmins(token: string) {
  return requestJson<{ admins: AdminUserItem[] }>('/admin/api/admins', { token });
}

export async function listDevices(token: string, page = 1) {
  return requestJson<{ devices: AdminDevice[]; total: number }>(
    `/admin/api/devices?page=${page}&limit=20`, { token });
}

export async function revokeDevice(token: string, deviceId: string) {
  return requestJson<{ ok: true }>(
    `/admin/api/devices/${encodeURIComponent(deviceId)}/revoke`,
    { method: 'POST', token });
}

export async function listGateways(token: string, page = 1) {
  return requestJson<{ gateways: AdminGateway[]; total: number }>(
    `/admin/api/gateways?page=${page}&limit=20`, { token });
}

export async function unlinkGateway(token: string, gatewayId: string) {
  return requestJson<{ ok: true }>(
    `/admin/api/gateways/${encodeURIComponent(gatewayId)}/unlink`,
    { method: 'DELETE', token });
}

export async function listAuditEvents(token: string, params: {
  page?: number; limit?: number; userId?: string; action?: string;
  from?: string; to?: string;
} = {}) {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 50));
  if (params.userId) qs.set('userId', params.userId);
  if (params.action) qs.set('action', params.action);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return requestJson<{ events: AdminAuditEvent[]; total: number }>(
    `/admin/api/audit?${qs.toString()}`, { token });
}

export async function getDashboardStats(token: string) {
  return requestJson<{
    totalUsers: number; activeDevices: number;
    registeredGateways: number; auditEventsLast7Days: number;
  }>('/admin/api/dashboard/stats', { token });
}
