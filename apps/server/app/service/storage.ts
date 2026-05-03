import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import {
  newId,
  type AccountRecord,
  type AdminUserRecord,
  type AuditEventRecord,
  type DeviceRecord,
  type GatewayRecord,
  type RefreshTokenRecord,
  type UserRecord,
  type WorkspaceRecord
} from './runtime';

type RevokedTokenRecord = {
  jti: string;
  tokenClass?: string;
  accountId?: string;
  workspaceId?: string;
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  gatewayId?: string;
  expiresAt?: number;
};

type AuditInsert = Omit<AuditEventRecord, 'id' | 'createdAt'> & {
  createdAt?: number;
};

type MysqlClientConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __tetherServerMysqlPool: mysql.Pool | undefined;
  // eslint-disable-next-line no-var
  var __tetherServerMysqlSchemaReady: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __tetherServerMysqlRuntimeConfig: { enabled: boolean; client: MysqlClientConfig } | undefined;
};

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function mysqlModeEnabled(): boolean {
  if (globalThis.__tetherServerMysqlRuntimeConfig) {
    return globalThis.__tetherServerMysqlRuntimeConfig.enabled;
  }
  return envFlag('TETHER_SERVER_ENABLE_MYSQL');
}

export function configureMysqlRuntime(input: { enabled: boolean; client: MysqlClientConfig }): void {
  globalThis.__tetherServerMysqlRuntimeConfig = input;
  globalThis.__tetherServerMysqlPool = undefined;
  globalThis.__tetherServerMysqlSchemaReady = undefined;
}

function sqlDateToMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value).getTime();
  }
  return Date.now();
}

function nullableString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function actorTypeOf(input: AuditInsert): string {
  if (input.adminUserId) {
    return 'admin_user';
  }
  if (input.userId) {
    return 'user';
  }
  if (input.gatewayId) {
    return 'gateway';
  }
  return 'system';
}

function actorIdOf(input: AuditInsert): string | undefined {
  return input.adminUserId ?? input.userId ?? input.gatewayId;
}

function mysqlPool(): mysql.Pool {
  if (!globalThis.__tetherServerMysqlPool) {
    const runtimeClient = globalThis.__tetherServerMysqlRuntimeConfig?.client;
    globalThis.__tetherServerMysqlPool = mysql.createPool({
      host: runtimeClient?.host ?? process.env.TETHER_SERVER_MYSQL_HOST ?? '127.0.0.1',
      port: runtimeClient?.port ?? Number(process.env.TETHER_SERVER_MYSQL_PORT ?? '3306'),
      user: runtimeClient?.user ?? process.env.TETHER_SERVER_MYSQL_USER ?? 'root',
      password: runtimeClient?.password ?? process.env.TETHER_SERVER_MYSQL_PASSWORD ?? '',
      database: runtimeClient?.database ?? process.env.TETHER_SERVER_MYSQL_DATABASE ?? 'tether',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true
    });
  }
  return globalThis.__tetherServerMysqlPool;
}

async function ensureSchema(): Promise<void> {
  if (!mysqlModeEnabled()) {
    return;
  }
  if (!globalThis.__tetherServerMysqlSchemaReady) {
    globalThis.__tetherServerMysqlSchemaReady = (async () => {
      const sqlPath = path.resolve(__dirname, '../../sql/001_init.sql');
      const sql = await readFile(sqlPath, 'utf8');
      await mysqlPool().query(sql);
    })();
  }
  await globalThis.__tetherServerMysqlSchemaReady;
}

async function execute(sql: string, values: any[] = []) {
  await ensureSchema();
  return await mysqlPool().execute(sql, values);
}

async function transaction<T>(run: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  await ensureSchema();
  const connection = await mysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await run(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function accountFromRow(row: Record<string, unknown>): AccountRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    slug: String(row.slug),
    name: String(row.name),
    isDefault: Boolean(row.is_default),
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function userFromRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function adminUserFromRow(row: Record<string, unknown>): AdminUserRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: row.role === 'admin' ? 'admin' : 'super_admin',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function deviceFromRow(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    userId: nullableString(row.user_id),
    adminUserId: nullableString(row.admin_user_id),
    name: String(row.name),
    platform: String(row.platform),
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function gatewayFromRow(row: Record<string, unknown>): GatewayRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    name: String(row.name),
    status: row.status === 'offline' ? 'offline' : 'online',
    lastSeenAt: sqlDateToMs(row.last_seen_at),
    createdAt: sqlDateToMs(row.created_at),
    updatedAt: sqlDateToMs(row.updated_at)
  };
}

function refreshTokenFromRow(row: Record<string, unknown>): RefreshTokenRecord {
  return {
    id: String(row.id),
    jti: String(row.jti),
    tokenClass: String(row.token_class),
    accountId: String(row.account_id),
    workspaceId: String(row.workspace_id),
    userId: nullableString(row.user_id),
    adminUserId: nullableString(row.admin_user_id),
    deviceId: nullableString(row.device_id),
    gatewayId: nullableString(row.gateway_id),
    expiresAt: sqlDateToMs(row.expires_at),
    revokedAt: row.revoked_at ? sqlDateToMs(row.revoked_at) : undefined,
    createdAt: sqlDateToMs(row.created_at)
  };
}

function auditEventFromRow(row: Record<string, unknown>): AuditEventRecord {
  const payload = row.payload_json && typeof row.payload_json === 'string'
    ? JSON.parse(String(row.payload_json)) as Record<string, unknown>
    : (row.payload_json as Record<string, unknown> | null) ?? {};
  return {
    id: Number(row.id),
    accountId: String(row.account_id),
    workspaceId: nullableString(row.workspace_id),
    userId: nullableString(row.user_id),
    adminUserId: nullableString(row.admin_user_id),
    deviceId: nullableString(row.device_id),
    gatewayId: nullableString(row.gateway_id),
    sessionId: nullableString(row.session_id),
    action: String(row.event_type),
    tokenClass: nullableString(row.token_class),
    failureReason: undefined,
    payload,
    createdAt: sqlDateToMs(row.created_at)
  };
}

export async function loadPrimaryAccount(): Promise<AccountRecord | undefined> {
  const [rows] = await execute('SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1');
  const row = (rows as Record<string, unknown>[])[0];
  return row ? accountFromRow(row) : undefined;
}

export async function loadDefaultWorkspace(accountId: string): Promise<WorkspaceRecord | undefined> {
  const [rows] = await execute(
    'SELECT * FROM workspaces WHERE account_id = ? AND is_default = 1 LIMIT 1',
    [accountId]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? workspaceFromRow(row) : undefined;
}

export async function loadUserByEmail(email: string): Promise<UserRecord | undefined> {
  const [rows] = await execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? userFromRow(row) : undefined;
}

export async function loadUserById(id: string): Promise<UserRecord | undefined> {
  const [rows] = await execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? userFromRow(row) : undefined;
}

export async function loadAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
  const [rows] = await execute('SELECT * FROM admin_users WHERE email = ? LIMIT 1', [email]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? adminUserFromRow(row) : undefined;
}

export async function loadAdminUserById(id: string): Promise<AdminUserRecord | undefined> {
  const [rows] = await execute('SELECT * FROM admin_users WHERE id = ? LIMIT 1', [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? adminUserFromRow(row) : undefined;
}

export async function countAdminUsers(): Promise<number> {
  const [rows] = await execute('SELECT COUNT(*) AS count FROM admin_users');
  return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
}

export async function loadDeviceById(id: string): Promise<DeviceRecord | undefined> {
  const [rows] = await execute('SELECT * FROM devices WHERE id = ? LIMIT 1', [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? deviceFromRow(row) : undefined;
}

export async function createAccountOwnerUser(input: {
  account: AccountRecord & { passwordHash: string };
  workspace: WorkspaceRecord;
  user: UserRecord;
  device: DeviceRecord;
}): Promise<void> {
  await transaction(async (connection) => {
    await connection.execute(
      `INSERT INTO accounts (id, email, display_name, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.account.id,
        input.account.email,
        input.account.displayName,
        input.account.passwordHash,
        input.account.status,
        input.account.createdAt,
        input.account.updatedAt
      ]
    );
    await connection.execute(
      `INSERT INTO workspaces (id, account_id, slug, name, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.workspace.id,
        input.workspace.accountId,
        input.workspace.slug,
        input.workspace.name,
        input.workspace.isDefault ? 1 : 0,
        input.workspace.createdAt,
        input.workspace.updatedAt
      ]
    );
    await connection.execute(
      `INSERT INTO users (id, account_id, workspace_id, email, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.user.id,
        input.user.accountId,
        input.user.workspaceId,
        input.user.email,
        input.user.passwordHash,
        input.user.status,
        input.user.createdAt,
        input.user.updatedAt
      ]
    );
    await insertDeviceWithConnection(connection, input.device);
  });
}

export async function createNormalUser(input: {
  user: UserRecord;
  device: DeviceRecord;
}): Promise<void> {
  await transaction(async (connection) => {
    await connection.execute(
      `INSERT INTO users (id, account_id, workspace_id, email, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.user.id,
        input.user.accountId,
        input.user.workspaceId,
        input.user.email,
        input.user.passwordHash,
        input.user.status,
        input.user.createdAt,
        input.user.updatedAt
      ]
    );
    await insertDeviceWithConnection(connection, input.device);
  });
}

export async function createAdminUser(input: {
  adminUser: AdminUserRecord;
  device: DeviceRecord;
}): Promise<void> {
  await transaction(async (connection) => {
    await connection.execute(
      `INSERT INTO admin_users (id, account_id, workspace_id, email, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.adminUser.id,
        input.adminUser.accountId,
        input.adminUser.workspaceId,
        input.adminUser.email,
        input.adminUser.passwordHash,
        input.adminUser.role,
        input.adminUser.status,
        input.adminUser.createdAt,
        input.adminUser.updatedAt
      ]
    );
    await insertDeviceWithConnection(connection, input.device);
  });
}

export async function saveDevice(device: DeviceRecord): Promise<void> {
  await transaction(async (connection) => {
    await insertDeviceWithConnection(connection, device);
  });
}

async function insertDeviceWithConnection(connection: mysql.PoolConnection, device: DeviceRecord): Promise<void> {
  await connection.execute(
    `INSERT INTO devices (
      id, account_id, workspace_id, user_id, admin_user_id, name, platform, token_class, jti, expires_at, revoked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
    [
      device.id,
      device.accountId,
      device.workspaceId,
      device.userId ?? null,
      device.adminUserId ?? null,
      device.name,
      device.platform,
      'device_identity',
      newId('devicejti'),
      device.createdAt,
      device.updatedAt
    ]
  );
}

export async function saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
  if (record.gatewayId) {
    await execute(
      `INSERT INTO gateway_refresh_tokens (
        id, account_id, workspace_id, gateway_id, device_id, session_id, token_class, jti, expires_at, revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
      ON DUPLICATE KEY UPDATE
        device_id = VALUES(device_id),
        token_class = VALUES(token_class),
        expires_at = VALUES(expires_at),
        revoked_at = VALUES(revoked_at),
        updated_at = VALUES(updated_at)`,
      [
        record.id,
        record.accountId,
        record.workspaceId,
        record.gatewayId,
        record.deviceId ?? null,
        record.tokenClass,
        record.jti,
        record.expiresAt,
        record.revokedAt ? new Date(record.revokedAt) : null,
        record.createdAt,
        record.createdAt
      ]
    );
    return;
  }

  await execute(
    `INSERT INTO refresh_tokens (
      id, account_id, workspace_id, user_id, admin_user_id, device_id, session_id, token_class, jti, expires_at, revoked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
    ON DUPLICATE KEY UPDATE
      user_id = VALUES(user_id),
      admin_user_id = VALUES(admin_user_id),
      device_id = VALUES(device_id),
      token_class = VALUES(token_class),
      expires_at = VALUES(expires_at),
      revoked_at = VALUES(revoked_at),
      updated_at = VALUES(updated_at)`,
    [
      record.id,
      record.accountId,
      record.workspaceId,
      record.userId ?? null,
      record.adminUserId ?? null,
      record.deviceId ?? null,
      record.tokenClass,
      record.jti,
      record.expiresAt,
      record.revokedAt ? new Date(record.revokedAt) : null,
      record.createdAt,
      record.createdAt
    ]
  );
}

export async function loadRefreshTokenByJti(jti: string): Promise<RefreshTokenRecord | undefined> {
  const [rows] = await execute(
    `SELECT id, account_id, workspace_id, user_id, admin_user_id, device_id, NULL AS gateway_id, token_class, jti, expires_at, revoked_at, created_at
     FROM refresh_tokens WHERE jti = ?
     UNION ALL
     SELECT id, account_id, workspace_id, NULL AS user_id, NULL AS admin_user_id, device_id, gateway_id, token_class, jti, expires_at, revoked_at, created_at
     FROM gateway_refresh_tokens WHERE jti = ?
     LIMIT 1`,
    [jti, jti]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? refreshTokenFromRow(row) : undefined;
}

export async function revokeRefreshTokenByJti(jti: string, revokedAt: number): Promise<void> {
  await execute(
    `UPDATE refresh_tokens SET revoked_at = FROM_UNIXTIME(? / 1000), updated_at = FROM_UNIXTIME(? / 1000) WHERE jti = ?`,
    [revokedAt, revokedAt, jti]
  );
  await execute(
    `UPDATE gateway_refresh_tokens SET revoked_at = FROM_UNIXTIME(? / 1000), updated_at = FROM_UNIXTIME(? / 1000) WHERE jti = ?`,
    [revokedAt, revokedAt, jti]
  );
}

export async function markTokenRevoked(record: RevokedTokenRecord): Promise<void> {
  await execute(
    `INSERT INTO revoked_tokens (
      jti, token_class, account_id, workspace_id, user_id, admin_user_id, device_id, gateway_id, expires_at, revoked_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE revoked_at = CURRENT_TIMESTAMP`,
    [
      record.jti,
      record.tokenClass ?? null,
      record.accountId ?? null,
      record.workspaceId ?? null,
      record.userId ?? null,
      record.adminUserId ?? null,
      record.deviceId ?? null,
      record.gatewayId ?? null,
      record.expiresAt ? new Date(record.expiresAt) : null
    ]
  );
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  const [rows] = await execute('SELECT 1 AS found FROM revoked_tokens WHERE jti = ? LIMIT 1', [jti]);
  return Boolean((rows as Record<string, unknown>[])[0]?.found);
}

export async function saveGateway(gateway: GatewayRecord): Promise<void> {
  await execute(
    `INSERT INTO gateways (
      id, account_id, workspace_id, device_id, user_id, admin_user_id, name, status, last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      status = VALUES(status),
      last_seen_at = VALUES(last_seen_at),
      updated_at = VALUES(updated_at)`,
    [
      gateway.id,
      gateway.accountId,
      gateway.workspaceId,
      gateway.userId,
      gateway.name,
      gateway.status,
      gateway.lastSeenAt,
      gateway.createdAt,
      gateway.updatedAt
    ]
  );
}

export async function loadGatewayByUserId(userId: string): Promise<GatewayRecord | undefined> {
  const [rows] = await execute('SELECT * FROM gateways WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', [userId]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? gatewayFromRow(row) : undefined;
}

export async function loadGatewayById(id: string): Promise<GatewayRecord | undefined> {
  const [rows] = await execute('SELECT * FROM gateways WHERE id = ? LIMIT 1', [id]);
  const row = (rows as Record<string, unknown>[])[0];
  return row ? gatewayFromRow(row) : undefined;
}

export async function insertAuditEvent(input: AuditInsert): Promise<AuditEventRecord> {
  const createdAt = input.createdAt ?? Date.now();
  const [result] = await execute(
    `INSERT INTO audit_events (
      account_id, workspace_id, user_id, admin_user_id, device_id, gateway_id, session_id,
      token_class, jti, event_type, actor_type, actor_id, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
    [
      input.accountId,
      input.workspaceId ?? null,
      input.userId ?? null,
      input.adminUserId ?? null,
      input.deviceId ?? null,
      input.gatewayId ?? null,
      input.sessionId ?? null,
      input.tokenClass ?? null,
      typeof input.payload.jti === 'string' ? input.payload.jti : null,
      input.action,
      actorTypeOf(input),
      actorIdOf(input) ?? null,
      JSON.stringify(input.payload),
      createdAt,
      createdAt
    ]
  );
  return {
    id: Number((result as mysql.ResultSetHeader).insertId),
    createdAt,
    accountId: input.accountId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    adminUserId: input.adminUserId,
    deviceId: input.deviceId,
    gatewayId: input.gatewayId,
    sessionId: input.sessionId,
    action: input.action,
    tokenClass: input.tokenClass,
    failureReason: input.failureReason,
    ip: input.ip,
    userAgent: input.userAgent,
    payload: input.payload
  };
}

export async function loadAuditEvents(): Promise<AuditEventRecord[]> {
  const [rows] = await execute('SELECT * FROM audit_events ORDER BY id ASC');
  return (rows as Record<string, unknown>[]).map(auditEventFromRow);
}

// --- Phase 6 Admin Management Queries ---

export async function loadAllUsers(limit = 20, offset = 0): Promise<UserRecord[]> {
  const [rows] = await execute(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return (rows as Record<string, unknown>[]).map(userFromRow);
}

export async function countUsers(): Promise<number> {
  const [rows] = await execute('SELECT COUNT(*) AS count FROM users');
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function loadAllAdminUsers(limit = 100, offset = 0): Promise<AdminUserRecord[]> {
  const [rows] = await execute(
    'SELECT * FROM admin_users ORDER BY created_at ASC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return (rows as Record<string, unknown>[]).map(adminUserFromRow);
}

export async function countActiveDevices(): Promise<number> {
  const [rows] = await execute(
    "SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL AND token_class = 'normal_client_access'"
  );
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function countRegisteredGateways(): Promise<number> {
  const [rows] = await execute('SELECT COUNT(*) AS count FROM gateways');
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function countAuditEventsLast7Days(): Promise<number> {
  const [rows] = await execute(
    'SELECT COUNT(*) AS count FROM audit_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function loadUserLoginStats(userId: string): Promise<{
  loginCount: number;
  failedLoginCount: number;
  lastLoginAt: number | null;
}> {
  const [loginRows] = await execute(
    "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.succeeded'",
    [userId]
  );
  const [failRows] = await execute(
    "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.failed'",
    [userId]
  );
  const [lastRows] = await execute(
    "SELECT created_at FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.succeeded' ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  const loginCount = Number((loginRows as Record<string, unknown>[])[0]?.count ?? 0);
  const failedLoginCount = Number((failRows as Record<string, unknown>[])[0]?.count ?? 0);
  const lastRow = (lastRows as Record<string, unknown>[])[0];
  const lastLoginAt = lastRow?.created_at ? sqlDateToMs(lastRow.created_at) : null;
  return { loginCount, failedLoginCount, lastLoginAt };
}

export async function countActiveDevicesByUserId(userId: string): Promise<number> {
  const [rows] = await execute(
    'SELECT COUNT(*) AS count FROM devices WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function deleteAdminUserById(id: string): Promise<void> {
  await execute('DELETE FROM admin_users WHERE id = ?', [id]);
}

// --- Phase 6 Admin: Devices ---

export async function loadAllDevices(limit = 20, offset = 0): Promise<Array<DeviceRecord & { revokedAt: number | null; userEmail: string | null }>> {
  const [rows] = await execute(
    `SELECT d.*, u.email AS user_email
     FROM devices d
     LEFT JOIN users u ON d.user_id = u.id
     WHERE d.token_class = 'normal_client_access'
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return (rows as Record<string, unknown>[]).map(row => ({
    ...deviceFromRow(row),
    revokedAt: row.revoked_at ? sqlDateToMs(row.revoked_at) : null,
    userEmail: typeof row.user_email === 'string' ? row.user_email : null
  }));
}

export async function countDevices(): Promise<number> {
  const [rows] = await execute(
    "SELECT COUNT(*) AS count FROM devices WHERE token_class = 'normal_client_access'"
  );
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function revokeDeviceById(id: string): Promise<void> {
  await execute(
    'UPDATE devices SET revoked_at = NOW(), updated_at = NOW() WHERE id = ?',
    [id]
  );
}

export async function revokeRefreshTokensByDeviceId(deviceId: string): Promise<void> {
  // 撤销该设备关联的所有 active refresh tokens，防止已吊销设备继续刷新
  // refresh_tokens 表使用 revoked_at 列（不是布尔 revoked）标记撤销状态
  await execute(
    'UPDATE refresh_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
    [deviceId]
  );
}

// --- Phase 6 Admin: Gateways ---

export async function loadAllGateways(limit = 20, offset = 0): Promise<GatewayRecord[]> {
  const [rows] = await execute(
    'SELECT * FROM gateways ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return (rows as Record<string, unknown>[]).map(gatewayFromRow);
}

export async function countGateways(): Promise<number> {
  const [rows] = await execute('SELECT COUNT(*) AS count FROM gateways');
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}

export async function deleteGatewayById(id: string): Promise<void> {
  await execute('DELETE FROM gateways WHERE id = ?', [id]);
}

// --- Phase 6 Admin: Audit (filtered) ---

export async function loadAuditEventsFiltered(params: {
  userId?: string;
  eventType?: string;
  deviceId?: string;
  gatewayId?: string;
  fromMs?: number;
  toMs?: number;
  limit: number;
  offset: number;
}): Promise<AuditEventRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.userId) {
    conditions.push('user_id = ?');
    values.push(params.userId);
  }
  if (params.eventType) {
    conditions.push('event_type = ?');
    values.push(params.eventType);
  }
  if (params.deviceId) {
    conditions.push('device_id = ?');
    values.push(params.deviceId);
  }
  if (params.gatewayId) {
    conditions.push('gateway_id = ?');
    values.push(params.gatewayId);
  }
  if (params.fromMs) {
    conditions.push('created_at >= FROM_UNIXTIME(? / 1000)');
    values.push(params.fromMs);
  }
  if (params.toMs) {
    conditions.push('created_at <= FROM_UNIXTIME(? / 1000)');
    values.push(params.toMs);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`;
  values.push(params.limit, params.offset);

  const [rows] = await execute(sql, values);
  return (rows as Record<string, unknown>[]).map(auditEventFromRow);
}

export async function countAuditEventsFiltered(params: {
  userId?: string;
  eventType?: string;
  deviceId?: string;
  gatewayId?: string;
  fromMs?: number;
  toMs?: number;
}): Promise<number> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.userId) { conditions.push('user_id = ?'); values.push(params.userId); }
  if (params.eventType) { conditions.push('event_type = ?'); values.push(params.eventType); }
  if (params.deviceId) { conditions.push('device_id = ?'); values.push(params.deviceId); }
  if (params.gatewayId) { conditions.push('gateway_id = ?'); values.push(params.gatewayId); }
  if (params.fromMs) { conditions.push('created_at >= FROM_UNIXTIME(? / 1000)'); values.push(params.fromMs); }
  if (params.toMs) { conditions.push('created_at <= FROM_UNIXTIME(? / 1000)'); values.push(params.toMs); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await execute(`SELECT COUNT(*) AS count FROM audit_events ${where}`, values);
  const row = (rows as Record<string, unknown>[])[0];
  return Number(row?.count ?? 0);
}
