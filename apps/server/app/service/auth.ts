import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AuthScopePayload, AuthTokenClass } from '@tether/core';

import { recordAuditEvent } from './audit';
import { emitNotification } from './notification';
import {
  defaultWorkspaceForAccount,
  newId,
  now,
  primaryAccount,
  runtimeStore,
  type AccountRecord,
  type AdminUserRecord,
  type DeviceRecord,
  type UserRecord
} from './runtime';
import {
  bootstrapAccountAndWorkspace,
  countAdminUsers,
  createAccountOwnerUser,
  createAdminUser,
  createNormalUser,
  isTokenRevoked,
  loadAdminUserByEmail,
  loadAdminUserById,
  loadDefaultWorkspace,
  loadDeviceById,
  loadGatewayById,
  loadPrimaryAccount,
  loadRefreshTokenByJti,
  loadUserByEmail,
  loadUserById,
  markTokenRevoked,
  mysqlModeEnabled,
  revokeRefreshTokenByJti,
  saveDevice,
  saveRefreshToken
} from './storage';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  accessPayload: AuthScopePayload;
  refreshPayload: AuthScopePayload;
};

export type VerifiedToken = AuthScopePayload & {
  realm: 'normal' | 'management' | 'gateway';
};

export type AuthConfig = {
  [key: string]: unknown;
  jwt?: {
    secret?: string;
  };
};

type RegisterInput = {
  email: string;
  password: string;
  displayName?: string;
  deviceName?: string;
  platform?: string;
  ip?: string;
  userAgent?: string;
};

type LoginInput = {
  email: string;
  password: string;
  deviceName?: string;
  platform?: string;
  ip?: string;
  userAgent?: string;
};

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeSegment(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSegment<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function serverSecret(config: AuthConfig): string {
  const secret = config.jwt?.secret;
  if (!secret) {
    throw new Error('jwt_secret_missing');
  }
  return secret;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHmac('sha256', salt).update(password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(':');
  if (!salt || !storedHash) {
    return false;
  }
  const candidate = createHmac('sha256', salt).update(password).digest('hex');
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash));
}

function issueToken(payload: AuthScopePayload, config: AuthConfig): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = encodeSegment(header);
  const encodedPayload = encodeSegment(payload);
  const signature = signValue(`${encodedHeader}.${encodedPayload}`, serverSecret(config));
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function extractBearerToken(rawToken: string): string {
  return rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
}

export function verifyToken(token: string, config: AuthConfig): VerifiedToken {
  const normalizedToken = extractBearerToken(token);
  const parts = normalizedToken.split('.');
  if (parts.length !== 3) {
    throw new Error('invalid_token');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`, serverSecret(config));
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('invalid_signature');
  }

  const payload = decodeSegment<AuthScopePayload>(encodedPayload);
  if (payload.expiresAt <= now()) {
    throw new Error('token_expired');
  }
  if (runtimeStore().revokedJtis.has(payload.jti)) {
    throw new Error('token_revoked');
  }

  const realm =
    payload.tokenClass === 'management_access' || payload.tokenClass === 'management_refresh'
      ? 'management'
      : payload.tokenClass === 'gateway_access' || payload.tokenClass === 'gateway_refresh'
        ? 'gateway'
        : 'normal';

  return {
    ...payload,
    realm
  };
}

async function verifyTokenState(token: string, config: AuthConfig): Promise<VerifiedToken> {
  const payload = verifyToken(token, config);
  if (mysqlModeEnabled() && await isTokenRevoked(payload.jti)) {
    throw new Error('token_revoked');
  }
  return payload;
}

export function issueTokenBundle(
  payload: Omit<AuthScopePayload, 'tokenClass' | 'expiresAt' | 'jti'>,
  config: AuthConfig,
  accessTokenClass: AuthTokenClass,
  refreshTokenClass: AuthTokenClass
): TokenBundle {
  const issuedAt = now();
  const accessPayload: AuthScopePayload = {
    ...payload,
    tokenClass: accessTokenClass,
    expiresAt: issuedAt + THIRTY_DAYS_MS,
    jti: newId('jti')
  };
  const refreshPayload: AuthScopePayload = {
    ...payload,
    tokenClass: refreshTokenClass,
    expiresAt: issuedAt + THIRTY_DAYS_MS,
    jti: newId('jti')
  };

  return {
    accessToken: issueToken(accessPayload, config),
    refreshToken: issueToken(refreshPayload, config),
    accessPayload,
    refreshPayload
  };
}

export async function persistRefreshTokenPayload(payload: AuthScopePayload): Promise<void> {
  const record = {
    id: newId('rt'),
    jti: payload.jti,
    tokenClass: payload.tokenClass,
    accountId: payload.accountId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    adminUserId: payload.adminUserId,
    deviceId: payload.deviceId,
    gatewayId: payload.gatewayId,
    expiresAt: payload.expiresAt,
    createdAt: now()
  };

  if (mysqlModeEnabled()) {
    await saveRefreshToken(record);
    return;
  }

  runtimeStore().refreshTokens.set(record.jti, record);
}

async function createDevice(base: {
  accountId: string;
  workspaceId: string;
  userId?: string;
  adminUserId?: string;
  deviceName?: string;
  platform?: string;
}, options?: { persist?: boolean }): Promise<DeviceRecord> {
  const createdAt = now();
  const device: DeviceRecord = {
    id: newId('device'),
    accountId: base.accountId,
    workspaceId: base.workspaceId,
    userId: base.userId,
    adminUserId: base.adminUserId,
    name: base.deviceName ?? 'web-browser',
    platform: base.platform ?? 'web',
    createdAt,
    updatedAt: createdAt
  };
  if (mysqlModeEnabled() && options?.persist !== false) {
    device.id = await saveDevice(device);
  } else if (!mysqlModeEnabled()) {
    runtimeStore().devices.set(device.id, device);
  }
  return device;
}

function normalTokenPayload(user: UserRecord, device: DeviceRecord) {
  return {
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    userId: user.id,
    deviceId: device.id
  };
}

function managementTokenPayload(user: AdminUserRecord, device: DeviceRecord) {
  return {
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    adminUserId: user.id,
    adminEmail: user.email,
    deviceId: device.id
  };
}

async function primaryAccountRecord(): Promise<AccountRecord | undefined> {
  return mysqlModeEnabled() ? await loadPrimaryAccount() : primaryAccount();
}

async function defaultWorkspaceRecord(accountId: string) {
  return mysqlModeEnabled() ? await loadDefaultWorkspace(accountId) : defaultWorkspaceForAccount(accountId);
}

async function normalUserByEmail(email: string): Promise<UserRecord | undefined> {
  if (mysqlModeEnabled()) {
    return await loadUserByEmail(email);
  }
  return [...runtimeStore().users.values()].find((user) => user.email === email);
}

async function normalUserById(id: string): Promise<UserRecord | undefined> {
  return mysqlModeEnabled() ? await loadUserById(id) : runtimeStore().users.get(id);
}

async function managementUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
  if (mysqlModeEnabled()) {
    return await loadAdminUserByEmail(email);
  }
  return [...runtimeStore().adminUsers.values()].find((candidate) => candidate.email === email);
}

async function managementUserById(id: string): Promise<AdminUserRecord | undefined> {
  return mysqlModeEnabled() ? await loadAdminUserById(id) : runtimeStore().adminUsers.get(id);
}

async function deviceById(id: string): Promise<DeviceRecord | undefined> {
  return mysqlModeEnabled() ? await loadDeviceById(id) : runtimeStore().devices.get(id);
}

async function adminUserCount(): Promise<number> {
  return mysqlModeEnabled() ? await countAdminUsers() : runtimeStore().adminUsers.size;
}

export async function registerNormalUser(input: RegisterInput, config: AuthConfig) {
  const store = runtimeStore();
  const existing = await normalUserByEmail(input.email);
  if (existing) {
    throw new Error('email_already_registered');
  }

  const createdAt = now();
  let account = await primaryAccountRecord();
  let workspace;
  if (!account) {
    const passwordHash = hashPassword(input.password);
    const workspaceId = newId('ws');
    account = {
      id: newId('acct'),
      email: input.email,
      displayName: input.displayName ?? input.email.split('@')[0] ?? 'owner',
      status: 'active',
      createdAt,
      updatedAt: createdAt
    };
    workspace = {
      id: workspaceId,
      accountId: account.id,
      slug: 'default',
      name: 'Default Workspace',
      isDefault: true,
      createdAt,
      updatedAt: createdAt
    };
    const user: UserRecord = {
      id: newId('user'),
      accountId: account.id,
      workspaceId: workspace.id,
      email: input.email,
      passwordHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt
    };
    const device = await createDevice({
      accountId: account.id,
      workspaceId: workspace.id,
      userId: user.id,
      deviceName: input.deviceName,
      platform: input.platform
    }, mysqlModeEnabled() ? { persist: false } : undefined);

    if (mysqlModeEnabled()) {
      const ids = await createAccountOwnerUser({
        account: { ...account, passwordHash },
        workspace,
        user,
        device
      });
      account.id = ids.accountId;
      workspace.id = ids.workspaceId;
      workspace.accountId = ids.accountId;
      user.id = ids.userId;
      user.accountId = ids.accountId;
      user.workspaceId = ids.workspaceId;
      device.id = ids.deviceId;
      device.accountId = ids.accountId;
      device.workspaceId = ids.workspaceId;
      device.userId = ids.userId;
    } else {
      store.accounts.set(account.id, account);
      store.workspaces.set(workspace.id, workspace);
      store.users.set(user.id, user);
    }

    const tokens = issueTokenBundle(normalTokenPayload(user, device), config, 'normal_client_access', 'normal_client_refresh');
    await persistRefreshTokenPayload(tokens.refreshPayload);
    await recordAuditEvent({
      accountId: account.id,
      workspaceId: workspace.id,
      userId: user.id,
      deviceId: device.id,
      action: 'auth.registered',
      tokenClass: 'normal_client_access',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: { email: input.email }
    });
    emitNotification({
      accountId: account.id,
      workspaceId: workspace.id,
      userId: user.id,
      deviceId: device.id,
      eventType: 'auth.state.changed',
      ts: now()
    });

    return {
      account,
      workspace,
      user,
      device,
      ...tokens
    };
  }

  workspace = await defaultWorkspaceRecord(account.id);
  if (!workspace) {
    throw new Error('default_workspace_missing');
  }

  const passwordHash = hashPassword(input.password);
  const user: UserRecord = {
    id: newId('user'),
    accountId: account.id,
    workspaceId: workspace.id,
    email: input.email,
    passwordHash,
    status: 'active',
    createdAt,
    updatedAt: createdAt
  };
  const device = await createDevice({
    accountId: account.id,
    workspaceId: workspace.id,
    userId: user.id,
    deviceName: input.deviceName,
    platform: input.platform
  }, mysqlModeEnabled() ? { persist: false } : undefined);

  if (mysqlModeEnabled()) {
    const ids = await createNormalUser({ user, device });
    user.id = ids.userId;
    device.id = ids.deviceId;
    device.userId = ids.userId;
  } else {
    store.users.set(user.id, user);
  }

  const tokens = issueTokenBundle(normalTokenPayload(user, device), config, 'normal_client_access', 'normal_client_refresh');
  await persistRefreshTokenPayload(tokens.refreshPayload);
  await recordAuditEvent({
    accountId: account.id,
    workspaceId: workspace.id,
    userId: user.id,
    deviceId: device.id,
    action: 'auth.registered',
    tokenClass: 'normal_client_access',
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { email: input.email }
  });
  emitNotification({
    accountId: account.id,
    workspaceId: workspace.id,
    userId: user.id,
    deviceId: device.id,
    eventType: 'auth.state.changed',
    ts: now()
  });

  return {
    account,
    workspace,
    user,
    device,
    ...tokens
  };
}

export async function loginNormalUser(input: LoginInput, config: AuthConfig) {
  const user = await normalUserByEmail(input.email);

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    if (user) {
      await recordAuditEvent({
        accountId: user.accountId,
        workspaceId: user.workspaceId,
        userId: user.id,
        action: 'auth.login.failed',
        failureReason: 'invalid_credentials',
        ip: input.ip,
        userAgent: input.userAgent,
        payload: { email: input.email }
      });
    }
    throw new Error('invalid_credentials');
  }

  const device = await createDevice({
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    userId: user.id,
    deviceName: input.deviceName,
    platform: input.platform
  });
  const tokens = issueTokenBundle(normalTokenPayload(user, device), config, 'normal_client_access', 'normal_client_refresh');
  await persistRefreshTokenPayload(tokens.refreshPayload);
  await recordAuditEvent({
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    userId: user.id,
    deviceId: device.id,
    action: 'auth.login.succeeded',
    tokenClass: 'normal_client_access',
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { email: input.email }
  });
  emitNotification({
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    deviceId: device.id,
    eventType: 'auth.state.changed',
    ts: now()
  });

  return {
    user,
    device,
    ...tokens
  };
}

export async function registerManagementUser(input: RegisterInput, config: AuthConfig) {
  const store = runtimeStore();
  let account = await primaryAccountRecord();
  let workspace = account ? await defaultWorkspaceRecord(account.id) : undefined;

  if (!account || !workspace) {
    const bootstrapAt = now();
    account = {
      id: newId('acct'),
      email: input.email,
      displayName: input.email,
      status: 'active',
      createdAt: bootstrapAt,
      updatedAt: bootstrapAt
    };
    workspace = {
      id: newId('ws'),
      accountId: account.id,
      slug: 'default',
      name: 'Default Workspace',
      isDefault: true,
      createdAt: bootstrapAt,
      updatedAt: bootstrapAt
    };
    if (mysqlModeEnabled()) {
      const ids = await bootstrapAccountAndWorkspace({ account, workspace });
      account.id = ids.accountId;
      workspace.id = ids.workspaceId;
      workspace.accountId = ids.accountId;
    } else {
      store.accounts.set(account.id, account);
      store.workspaces.set(workspace.id, workspace);
    }
  }

  const existing = await managementUserByEmail(input.email);
  if (existing) {
    throw new Error('email_already_registered');
  }

  const createdAt = now();
  const adminUser: AdminUserRecord = {
    id: newId('admin'),
    accountId: account.id,
    workspaceId: workspace.id,
    email: input.email,
    passwordHash: hashPassword(input.password),
    role: (await adminUserCount()) === 0 ? 'super_admin' : 'admin',
    status: 'active',
    createdAt,
    updatedAt: createdAt
  };

  const device = await createDevice({
    accountId: account.id,
    workspaceId: workspace.id,
    adminUserId: adminUser.id,
    deviceName: input.deviceName,
    platform: input.platform
  }, mysqlModeEnabled() ? { persist: false } : undefined);

  if (mysqlModeEnabled()) {
    const ids = await createAdminUser({ adminUser, device });
    adminUser.id = ids.adminId;
    device.id = ids.deviceId;
    device.adminUserId = ids.adminId;
  } else {
    store.adminUsers.set(adminUser.id, adminUser);
  }

  const tokens = issueTokenBundle(managementTokenPayload(adminUser, device), config, 'management_access', 'management_refresh');
  await persistRefreshTokenPayload(tokens.refreshPayload);
  await recordAuditEvent({
    accountId: account.id,
    workspaceId: workspace.id,
    adminUserId: adminUser.id,
    deviceId: device.id,
    action: 'admin.registered',
    tokenClass: 'management_access',
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { email: input.email, role: adminUser.role }
  });

  return {
    adminUser,
    device,
    ...tokens
  };
}

export async function loginManagementUser(input: LoginInput, config: AuthConfig) {
  const adminUser = await managementUserByEmail(input.email);
  if (!adminUser || !verifyPassword(input.password, adminUser.passwordHash)) {
    if (adminUser) {
      await recordAuditEvent({
        accountId: adminUser.accountId,
        workspaceId: adminUser.workspaceId,
        adminUserId: adminUser.id,
        action: 'admin.login.failed',
        failureReason: 'invalid_credentials',
        ip: input.ip,
        userAgent: input.userAgent,
        payload: { email: input.email }
      });
    }
    throw new Error('invalid_credentials');
  }
  const device = await createDevice({
    accountId: adminUser.accountId,
    workspaceId: adminUser.workspaceId,
    adminUserId: adminUser.id,
    deviceName: input.deviceName,
    platform: input.platform
  });
  const tokens = issueTokenBundle(managementTokenPayload(adminUser, device), config, 'management_access', 'management_refresh');
  await persistRefreshTokenPayload(tokens.refreshPayload);
  await recordAuditEvent({
    accountId: adminUser.accountId,
    workspaceId: adminUser.workspaceId,
    adminUserId: adminUser.id,
    deviceId: device.id,
    action: 'admin.login.succeeded',
    tokenClass: 'management_access',
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { email: input.email, role: adminUser.role }
  });

  return {
    adminUser,
    device,
    ...tokens
  };
}

export async function refreshFromToken(refreshToken: string, config: AuthConfig) {
  const payload = await verifyTokenState(refreshToken, config);
  if (!payload.tokenClass.endsWith('_refresh')) {
    throw new Error('wrong_token_class');
  }

  const record = mysqlModeEnabled()
    ? await loadRefreshTokenByJti(payload.jti)
    : runtimeStore().refreshTokens.get(payload.jti);
  if (!record || record.revokedAt) {
    throw new Error('token_revoked');
  }

  if (payload.realm === 'normal' && payload.userId && payload.deviceId) {
    const user = await normalUserById(payload.userId);
    const device = await deviceById(payload.deviceId);
    if (!user || !device) {
      throw new Error('subject_missing');
    }
    const tokens = issueTokenBundle(normalTokenPayload(user, device), config, 'normal_client_access', 'normal_client_refresh');
    await persistRefreshTokenPayload(tokens.refreshPayload);
    return tokens;
  }

  if (payload.realm === 'management' && payload.adminUserId && payload.deviceId) {
    const user = await managementUserById(payload.adminUserId);
    const device = await deviceById(payload.deviceId);
    if (!user || !device) {
      throw new Error('subject_missing');
    }
    const tokens = issueTokenBundle(managementTokenPayload(user, device), config, 'management_access', 'management_refresh');
    await persistRefreshTokenPayload(tokens.refreshPayload);
    return tokens;
  }

  if (payload.realm === 'gateway' && payload.gatewayId) {
    const gateway = mysqlModeEnabled()
      ? await loadGatewayById(payload.gatewayId)
      : runtimeStore().gateways.get(payload.gatewayId);
    if (!gateway) {
      throw new Error('subject_missing');
    }
    const tokens = issueTokenBundle({
      accountId: gateway.accountId,
      workspaceId: gateway.workspaceId,
      gatewayId: gateway.id,
      userId: gateway.userId,
      deviceId: record.deviceId
    }, config, 'gateway_access', 'gateway_refresh');
    await persistRefreshTokenPayload(tokens.refreshPayload);
    return tokens;
  }

  throw new Error('unsupported_refresh_subject');
}

export async function revokeToken(rawToken: string, config: AuthConfig, reason = 'manual_revoke') {
  const payload = await verifyTokenState(rawToken, config);
  if (mysqlModeEnabled()) {
    await markTokenRevoked({
      jti: payload.jti,
      tokenClass: payload.tokenClass,
      accountId: payload.accountId,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      adminUserId: payload.adminUserId,
      deviceId: payload.deviceId,
      gatewayId: payload.gatewayId,
      expiresAt: payload.expiresAt
    });
    await revokeRefreshTokenByJti(payload.jti, now());
  } else {
    runtimeStore().revokedJtis.add(payload.jti);
    const refreshRecord = runtimeStore().refreshTokens.get(payload.jti);
    if (refreshRecord) {
      refreshRecord.revokedAt = now();
    }
  }
  await recordAuditEvent({
    accountId: payload.accountId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    adminUserId: payload.adminUserId,
    deviceId: payload.deviceId,
    gatewayId: payload.gatewayId,
    action: 'auth.token.revoked',
    tokenClass: payload.tokenClass,
    failureReason: reason,
    payload: { jti: payload.jti }
  });
  emitNotification({
    accountId: payload.accountId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    adminUserId: payload.adminUserId,
    deviceId: payload.deviceId,
    gatewayId: payload.gatewayId,
    eventType: 'token.revoked',
    ts: now()
  });
}

export async function logoutToken(rawToken: string, config: AuthConfig) {
  const payload = await verifyTokenState(rawToken, config);
  await revokeToken(rawToken, config, 'logout');
  await recordAuditEvent({
    accountId: payload.accountId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    adminUserId: payload.adminUserId,
    deviceId: payload.deviceId,
    gatewayId: payload.gatewayId,
    action: 'auth.logout',
    tokenClass: payload.tokenClass,
    payload: {}
  });
  emitNotification({
    accountId: payload.accountId,
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    adminUserId: payload.adminUserId,
    deviceId: payload.deviceId,
    gatewayId: payload.gatewayId,
    eventType: 'auth.logout',
    ts: now()
  });
}

export async function currentUserFromToken(rawToken: string, config: AuthConfig) {
  const payload = await verifyTokenState(rawToken, config);
  if (payload.realm !== 'normal' || !payload.userId) {
    throw new Error('wrong_token_class');
  }
  const user = await normalUserById(payload.userId);
  if (!user) {
    throw new Error('subject_missing');
  }
  return {
    accountId: user.accountId,
    workspaceId: user.workspaceId,
    userId: user.id,
    email: user.email,
    deviceId: payload.deviceId
  };
}

export async function validateToken(rawToken: string, config: AuthConfig) {
  return await verifyTokenState(rawToken, config);
}
