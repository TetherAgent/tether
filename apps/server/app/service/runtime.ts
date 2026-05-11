import { Service } from 'egg';

export type AuthRealm = 'normal' | 'management';

export type AccountRecord = {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};

export type UserRecord = {
  id: string;
  accountId: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number;
};

export type AdminUserRecord = {
  id: string;
  accountId: string;
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
  userId: string;
  name: string;
  deviceKey?: string;
  hostname?: string;
  localPort?: number;
  status: 'online' | 'offline' | 'revoked';
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

export type RefreshTokenRecord = {
  id: string;
  jti: string;
  tokenClass: string;
  accountId: string;
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

export default class RuntimeService extends Service {
  private createStore(): RuntimeStore {
    return {
      accounts: new Map(),
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

  public runtimeStore() {
    if (!globalThis.__tetherServerRuntimeStore) {
      globalThis.__tetherServerRuntimeStore = this.createStore();
    }
    return globalThis.__tetherServerRuntimeStore;
  }

  public resetRuntimeStore() {
    globalThis.__tetherServerRuntimeStore = this.createStore();
    return globalThis.__tetherServerRuntimeStore;
  }
}
