import { ApiRequestError, createHttpClient } from '@tether/http';

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
  accountId: string;
  userId: string;
  name: string;
  deviceKey: string | null;
  hostname: string | null;
  localPort: number | null;
  lastSeenAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
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

const http = createHttpClient();

function normalizeRequestError(error: unknown): Error {
  if (error instanceof ApiRequestError) {
    const detail = error.stackDetail ? `${error.message}\n\n${error.stackDetail}` : error.message;
    return new Error(detail);
  }
  return error instanceof Error ? error : new Error('network_error');
}

export async function listUsers(token: string, page = 1) {
  try {
    return await http.get<{ users: AdminUser[]; total: number }>(
      '/api/admin/users',
      { page, limit: 20 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listAdmins(token: string) {
  try {
    return await http.get<{ admins: AdminUserItem[] }>('/api/admin/admins', undefined, { token });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listDevices(token: string, page = 1) {
  try {
    return await http.get<{ devices: AdminDevice[]; total: number }>(
      '/api/admin/devices',
      { page, limit: 20 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function revokeDevice(token: string, deviceId: string) {
  try {
    return await http.post<{ ok: true }>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/revoke`,
      undefined,
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listGateways(token: string, page = 1) {
  try {
    return await http.get<{ gateways: AdminGateway[]; total: number }>(
      '/api/admin/gateways',
      { page, limit: 20 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function unlinkGateway(token: string, gatewayId: string) {
  try {
    return await http.delete<{ ok: true }>(
      `/api/admin/gateways/${encodeURIComponent(gatewayId)}/unlink`,
      undefined,
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listAuditEvents(token: string, params: {
  page?: number; limit?: number; userId?: string; action?: string;
  from?: string; to?: string;
} = {}) {
  try {
    return await http.get<{ events: AdminAuditEvent[]; total: number }>(
      '/api/admin/audit',
      {
        page: params.page ?? 1,
        limit: params.limit ?? 50,
        userId: params.userId,
        action: params.action,
        from: params.from,
        to: params.to
      },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function getDashboardStats(token: string) {
  try {
    return await http.get<{
      totalUsers: number; activeDevices: number;
      registeredGateways: number; auditEventsLast7Days: number;
    }>('/api/admin/dashboard/stats', undefined, { token });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function createAdmin(token: string, data: {
  email: string;
  password: string;
  displayName?: string;
}) {
  try {
    return await http.post<{ accessToken: string; refreshToken: string }>(
      '/api/admin/admins',
      {
        email: data.email,
        password: data.password,
        displayName: data.displayName,
        deviceName: 'admin-web',
        platform: 'web'
      },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export type AdminSession = {
  id: string;
  accountId: string;
  gatewayId: string;
  userId: string | null;
  userEmail: string | null;
  provider: string;
  title: string | null;
  projectPath: string | null;
  agentSessionId: string | null;
  status: string;
  transport: string;
  lastActiveAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AdminChatMessage = {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  usageJson: Record<string, unknown>;
  createdAt: number;
};

export type AdminRuntimeEvent = {
  eventId: number;
  sessionId: string;
  eventType: string;
  payloadJson: Record<string, unknown>;
  createdAt: number;
};

export type AdminChatEvent = {
  id: number;
  sessionId: string;
  eventId: number;
  eventType: string;
  createdAt: number;
};

export async function listSessions(token: string, params: {
  page?: number;
  limit?: number;
  userId?: string;
  gatewayId?: string;
  transport?: string;
  status?: string;
} = {}) {
  try {
    return await http.get<{ sessions: AdminSession[]; total: number }>(
      '/api/admin/sessions',
      {
        page: params.page ?? 1,
        limit: params.limit ?? 20,
        userId: params.userId,
        gatewayId: params.gatewayId,
        transport: params.transport,
        status: params.status,
      },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function getSession(token: string, sessionId: string) {
  try {
    return await http.get<AdminSession>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listSessionMessages(token: string, sessionId: string, page = 1) {
  try {
    return await http.get<{ messages: AdminChatMessage[]; total: number }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/messages`,
      { page, limit: 50 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listSessionRuntimeEvents(token: string, sessionId: string, page = 1) {
  try {
    return await http.get<{ events: AdminRuntimeEvent[]; total: number }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/events`,
      { page, limit: 50 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listSessionChatEvents(token: string, sessionId: string, page = 1) {
  try {
    return await http.get<{ events: AdminChatEvent[]; total: number }>(
      `/api/admin/sessions/${encodeURIComponent(sessionId)}/chat-events`,
      { page, limit: 50 },
      { token }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}
