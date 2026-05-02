import { randomUUID } from 'node:crypto';

export type AuthRealm = 'normal' | 'management';

export type AccountRecord = {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceRecord = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

export type UserRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};

export type AdminUserRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  email: string;
  passwordHash: string;
  role: 'super_admin' | 'admin';
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};

export type DeviceRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  userId?: string;
  adminUserId?: string;
  name: string;
  platform: string;
  createdAt: number;
  updatedAt: number;
};

export type GatewayRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  userId: string;
  name: string;
  status: 'online' | 'offline';
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

export type RefreshTokenRecord = {
  id: string;
  jti: string;
  tokenClass: string;
  accountId: string;
  workspaceId: string;
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  gatewayId?: string;
  expiresAt: number;
  revokedAt?: number;
  createdAt: number;
};

export type AuditEventRecord = {
  id: number;
  accountId: string;
  workspaceId?: string;
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  gatewayId?: string;
  sessionId?: string;
  action: string;
  tokenClass?: string;
  failureReason?: string;
  ip?: string;
  userAgent?: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type NotificationEvent = {
  accountId: string;
  workspaceId: string;
  eventType:
    | 'session.list.refresh'
    | 'session.started'
    | 'session.stopped'
    | 'gateway.online'
    | 'gateway.offline'
    | 'auth.logout'
    | 'token.revoked'
    | 'device.revoked'
    | 'auth.state.changed';
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  gatewayId?: string;
  sessionId?: string;
  ts: number;
  payload?: Record<string, unknown>;
};

type NotificationSink = {
  id: string;
  accountId: string;
  realm: AuthRealm;
  userId?: string;
  adminUserId?: string;
  events: NotificationEvent[];
};

export type RuntimeStore = {
  accounts: Map<string, AccountRecord>;
  workspaces: Map<string, WorkspaceRecord>;
  users: Map<string, UserRecord>;
  adminUsers: Map<string, AdminUserRecord>;
  devices: Map<string, DeviceRecord>;
  gateways: Map<string, GatewayRecord>;
  refreshTokens: Map<string, RefreshTokenRecord>;
  revokedJtis: Set<string>;
  auditEvents: AuditEventRecord[];
  notificationSinks: Map<string, NotificationSink>;
  nextAuditId: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __tetherServerRuntimeStore: RuntimeStore | undefined;
}

function createStore(): RuntimeStore {
  return {
    accounts: new Map(),
    workspaces: new Map(),
    users: new Map(),
    adminUsers: new Map(),
    devices: new Map(),
    gateways: new Map(),
    refreshTokens: new Map(),
    revokedJtis: new Set(),
    auditEvents: [],
    notificationSinks: new Map(),
    nextAuditId: 1
  };
}

export function runtimeStore(): RuntimeStore {
  if (!globalThis.__tetherServerRuntimeStore) {
    globalThis.__tetherServerRuntimeStore = createStore();
  }
  return globalThis.__tetherServerRuntimeStore;
}

export function resetRuntimeStore(): RuntimeStore {
  globalThis.__tetherServerRuntimeStore = createStore();
  return globalThis.__tetherServerRuntimeStore;
}

export function now(): number {
  return Date.now();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export function defaultWorkspaceForAccount(accountId: string): WorkspaceRecord | undefined {
  return [...runtimeStore().workspaces.values()].find((workspace) => workspace.accountId === accountId && workspace.isDefault);
}

export function primaryAccount(): AccountRecord | undefined {
  return [...runtimeStore().accounts.values()][0];
}

export function primaryWorkspace(): WorkspaceRecord | undefined {
  const account = primaryAccount();
  return account ? defaultWorkspaceForAccount(account.id) : undefined;
}

export function registerNotificationSink(sink: Omit<NotificationSink, 'id' | 'events'>): NotificationSink {
  const registered: NotificationSink = {
    id: newId('notif'),
    events: [],
    ...sink
  };
  runtimeStore().notificationSinks.set(registered.id, registered);
  return registered;
}

export function notificationEventsForSink(sinkId: string): NotificationEvent[] {
  return runtimeStore().notificationSinks.get(sinkId)?.events ?? [];
}
