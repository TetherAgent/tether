import { Service } from 'egg';

import { createId } from '../utils/id';
import type {
  AccountRecord,
  AdminUserRecord,
  DeviceRecord,
  RefreshTokenRecord,
  UserRecord
} from './runtime';


export default class AuthRepositoryService extends Service {
  private mysqlModeEnabled() {
    const { ctx } = this;
    return ctx.service.db.mysqlModeEnabled();
  }

  private runtimeStore() {
    const { ctx } = this;
    return ctx.service.runtime.runtimeStore();
  }

  private async query(sql: string, values: any[] = []) {
    const { ctx } = this;
    return await ctx.service.db.query(sql, values);
  }

  private async transaction<T>(run: (connection: any) => Promise<T>): Promise<T> {
    const { ctx } = this;
    return await ctx.service.db.transaction(run);
  }

  private sqlDateToMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return Date.now();
  }

  private nullableId(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  private accountFromRow(row: Record<string, unknown>): AccountRecord {
    return {
      id: String(row.id),
      email: String(row.email),
      displayName: String(row.display_name),
      status: row.status === 'disabled' ? 'disabled' : 'active',
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  private userFromRow(row: Record<string, unknown>): UserRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      status: row.status === 'disabled' ? 'disabled' : 'active',
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  private adminUserFromRow(row: Record<string, unknown>): AdminUserRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      role: row.role === 'admin' ? 'admin' : 'super_admin',
      status: row.status === 'disabled' ? 'disabled' : 'active',
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  private deviceFromRow(row: Record<string, unknown>): DeviceRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      userId: this.nullableId(row.user_id),
      adminUserId: this.nullableId(row.admin_user_id),
      name: String(row.name),
      platform: String(row.platform),
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  private refreshTokenFromRow(row: Record<string, unknown>): RefreshTokenRecord {
    return {
      id: String(row.id),
      jti: String(row.jti),
      tokenClass: String(row.token_class),
      accountId: String(row.account_id),
      userId: this.nullableId(row.user_id),
      adminUserId: this.nullableId(row.admin_user_id),
      deviceId: this.nullableId(row.device_id),
      gatewayId: this.nullableId(row.gateway_id),
      expiresAt: this.sqlDateToMs(row.expires_at),
      revokedAt: row.revoked_at ? this.sqlDateToMs(row.revoked_at) : undefined,
      createdAt: this.sqlDateToMs(row.created_at)
    };
  }

  public async loadPrimaryAccount(): Promise<AccountRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().accounts.values()][0];
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1');
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.accountFromRow(row) : undefined;
  }

  public async loadUserByEmail(email: string): Promise<UserRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().users.values()].find(user => user.email === email);
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.userFromRow(row) : undefined;
  }

  public async loadUserById(id: string): Promise<UserRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().users.get(id);
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.userFromRow(row) : undefined;
  }

  public async loadAdminUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().adminUsers.values()].find(user => user.email === email);
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM admin_users WHERE email = ? LIMIT 1', [email]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.adminUserFromRow(row) : undefined;
  }

  public async loadAdminUserById(id: string): Promise<AdminUserRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().adminUsers.get(id);
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM admin_users WHERE id = ? LIMIT 1', [id]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.adminUserFromRow(row) : undefined;
  }

  public async countAdminUsers(): Promise<number> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().adminUsers.size;
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT COUNT(*) AS count FROM admin_users');
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async loadDeviceById(id: string): Promise<DeviceRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().devices.get(id);
    }
    const { ctx } = this;
    const rows = await ctx.service.db.query('SELECT * FROM devices WHERE id = ? LIMIT 1', [id]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.deviceFromRow(row) : undefined;
  }

  public async bootstrapAccount(input: {
    account: AccountRecord & { passwordHash?: string };
  }): Promise<{ accountId: string }> {
    if (!this.mysqlModeEnabled()) {
      const store = this.runtimeStore();
      store.accounts.set(input.account.id, input.account);
      return { accountId: input.account.id };
    }
    let accountId = '';
    await this.transaction(async connection => {
      const r1 = await connection.query(
        `INSERT INTO accounts (email, display_name, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
        [input.account.email, input.account.displayName, input.account.passwordHash ?? '', input.account.status, input.account.createdAt, input.account.updatedAt]
      );
      accountId = String((r1 as { insertId: number }).insertId);
    });
    return { accountId };
  }

  public async createAccountOwnerUser(input: {
    account: AccountRecord & { passwordHash: string };
    user: UserRecord;
    device: DeviceRecord;
  }): Promise<{ accountId: string; userId: string; deviceId: string }> {
    if (!this.mysqlModeEnabled()) {
      const store = this.runtimeStore();
      store.accounts.set(input.account.id, input.account);
      store.users.set(input.user.id, input.user);
      store.devices.set(input.device.id, input.device);
      return {
        accountId: input.account.id,
        userId: input.user.id,
        deviceId: input.device.id
      };
    }
    let accountId = '', userId = '', deviceId = '';
    await this.transaction(async connection => {
      const r1 = await connection.query(
        `INSERT INTO accounts (email, display_name, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
        [input.account.email, input.account.displayName, input.account.passwordHash, input.account.status, input.account.createdAt, input.account.updatedAt]
      );
      accountId = String((r1 as { insertId: number }).insertId);
      const r3 = await connection.query(
        `INSERT INTO users (account_id, email, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
        [accountId, input.user.email, input.user.passwordHash, input.user.status, input.user.createdAt, input.user.updatedAt]
      );
      userId = String((r3 as { insertId: number }).insertId);
      deviceId = await this.insertDeviceWithConnection(connection, { ...input.device, accountId, userId });
    });
    return { accountId, userId, deviceId };
  }

  public async createNormalUser(input: {
    user: UserRecord;
    device: DeviceRecord;
  }): Promise<{ userId: string; deviceId: string }> {
    if (!this.mysqlModeEnabled()) {
      const store = this.runtimeStore();
      store.users.set(input.user.id, input.user);
      store.devices.set(input.device.id, input.device);
      return { userId: input.user.id, deviceId: input.device.id };
    }
    let userId = '', deviceId = '';
    await this.transaction(async connection => {
      const result = await connection.query(
        `INSERT INTO users (account_id, email, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
        [input.user.accountId, input.user.email, input.user.passwordHash, input.user.status, input.user.createdAt, input.user.updatedAt]
      );
      userId = String((result as { insertId: number }).insertId);
      deviceId = await this.insertDeviceWithConnection(connection, { ...input.device, userId });
    });
    return { userId, deviceId };
  }

  public async createAdminUser(input: {
    adminUser: AdminUserRecord;
    device: DeviceRecord;
  }): Promise<{ adminId: string; deviceId: string }> {
    if (!this.mysqlModeEnabled()) {
      const store = this.runtimeStore();
      store.adminUsers.set(input.adminUser.id, input.adminUser);
      store.devices.set(input.device.id, input.device);
      return { adminId: input.adminUser.id, deviceId: input.device.id };
    }
    let adminId = '', deviceId = '';
    await this.transaction(async connection => {
      const result = await connection.query(
        `INSERT INTO admin_users (account_id, email, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
        [input.adminUser.accountId, input.adminUser.email, input.adminUser.passwordHash, input.adminUser.role, input.adminUser.status, input.adminUser.createdAt, input.adminUser.updatedAt]
      );
      adminId = String((result as { insertId: number }).insertId);
      input.device.adminUserId = adminId;
      deviceId = await this.insertDeviceWithConnection(connection, input.device);
    });
    return { adminId, deviceId };
  }

  public async saveDevice(device: DeviceRecord): Promise<string> {
    if (!this.mysqlModeEnabled()) {
      this.runtimeStore().devices.set(device.id, device);
      return device.id;
    }
    let deviceId = '';
    await this.transaction(async connection => {
      deviceId = await this.insertDeviceWithConnection(connection, device);
    });
    return deviceId;
  }

  private async insertDeviceWithConnection(connection: any, device: DeviceRecord): Promise<string> {
    const result = await connection.query(
      `INSERT INTO devices (
        account_id, user_id, admin_user_id, name, platform, token_class, jti, expires_at, revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        device.accountId,
        device.userId ?? null,
        device.adminUserId ?? null,
        device.name,
        device.platform,
        'device_identity',
        createId('devicejti'),
        device.createdAt,
        device.updatedAt
      ]
    );
    return String((result as { insertId: number }).insertId);
  }

  public async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      this.runtimeStore().refreshTokens.set(record.jti, record);
      return;
    }
    if (record.gatewayId) {
      await this.query(
        `INSERT INTO gateway_refresh_tokens (
          account_id, gateway_id, device_id, session_id, token_class, jti, expires_at, revoked_at, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
        ON DUPLICATE KEY UPDATE
          device_id = VALUES(device_id),
          token_class = VALUES(token_class),
          expires_at = VALUES(expires_at),
          revoked_at = VALUES(revoked_at),
          updated_at = VALUES(updated_at)`,
        [record.accountId, record.gatewayId, record.deviceId ?? null, record.tokenClass, record.jti, record.expiresAt, record.revokedAt ? new Date(record.revokedAt) : null, record.createdAt, record.createdAt]
      );
      return;
    }

    await this.query(
      `INSERT INTO refresh_tokens (
        account_id, user_id, admin_user_id, device_id, session_id, token_class, jti, expires_at, revoked_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        admin_user_id = VALUES(admin_user_id),
        device_id = VALUES(device_id),
        token_class = VALUES(token_class),
        expires_at = VALUES(expires_at),
        revoked_at = VALUES(revoked_at),
        updated_at = VALUES(updated_at)`,
      [record.accountId, record.userId ?? null, record.adminUserId ?? null, record.deviceId ?? null, record.tokenClass, record.jti, record.expiresAt, record.revokedAt ? new Date(record.revokedAt) : null, record.createdAt, record.createdAt]
    );
  }

  public async loadRefreshTokenByJti(jti: string): Promise<RefreshTokenRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().refreshTokens.get(jti);
    }
    const rows = await this.query(
      `SELECT id, account_id, user_id, admin_user_id, device_id, NULL AS gateway_id, token_class, jti, expires_at, revoked_at, created_at
       FROM refresh_tokens WHERE jti = ?
       UNION ALL
       SELECT id, account_id, NULL AS user_id, NULL AS admin_user_id, device_id, gateway_id, token_class, jti, expires_at, revoked_at, created_at
       FROM gateway_refresh_tokens WHERE jti = ?
       LIMIT 1`,
      [jti, jti]
    );
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.refreshTokenFromRow(row) : undefined;
  }

  public async revokeRefreshTokenByJti(jti: string, revokedAt: number): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      const refreshRecord = this.runtimeStore().refreshTokens.get(jti);
      if (refreshRecord) {
        refreshRecord.revokedAt = revokedAt;
      }
      return;
    }
    await this.query(
      `UPDATE refresh_tokens SET revoked_at = FROM_UNIXTIME(? / 1000), updated_at = FROM_UNIXTIME(? / 1000) WHERE jti = ?`,
      [revokedAt, revokedAt, jti]
    );
    await this.query(
      `UPDATE gateway_refresh_tokens SET revoked_at = FROM_UNIXTIME(? / 1000), updated_at = FROM_UNIXTIME(? / 1000) WHERE jti = ?`,
      [revokedAt, revokedAt, jti]
    );
  }


  public async loadAllUsers(limit = 20, offset = 0): Promise<UserRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().users.values()].slice(offset, offset + limit);
    }
    const rows = await this.query(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return (rows as Record<string, unknown>[]).map(row => this.userFromRow(row));
  }

  public async countUsers(): Promise<number> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().users.size;
    }
    const rows = await this.query('SELECT COUNT(*) AS count FROM users');
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async loadAllAdminUsers(limit = 100, offset = 0): Promise<AdminUserRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().adminUsers.values()].slice(offset, offset + limit);
    }
    const rows = await this.query(
      'SELECT * FROM admin_users ORDER BY created_at ASC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return (rows as Record<string, unknown>[]).map(row => this.adminUserFromRow(row));
  }

  public async deleteAdminUserById(id: string): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      this.runtimeStore().adminUsers.delete(id);
      return;
    }
    await this.query('DELETE FROM admin_users WHERE id = ?', [id]);
  }

  public async loadUserLoginStats(userId: string): Promise<{
    loginCount: number;
    failedLoginCount: number;
    lastLoginAt: number | null;
  }> {
    if (!this.mysqlModeEnabled()) {
      const events = this.runtimeStore().auditEvents;
      const loginEvents = events.filter(e => e.userId === userId && e.action === 'auth.login.succeeded');
      const failedLoginEvents = events.filter(e => e.userId === userId && e.action === 'auth.login.failed');
      return {
        loginCount: loginEvents.length,
        failedLoginCount: failedLoginEvents.length,
        lastLoginAt: loginEvents.sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt ?? null
      };
    }
    const loginRows = await this.query(
      "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.succeeded'",
      [userId]
    );
    const failRows = await this.query(
      "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.failed'",
      [userId]
    );
    const lastRows = await this.query(
      "SELECT created_at FROM audit_events WHERE user_id = ? AND event_type = 'auth.login.succeeded' ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    const loginCount = Number((loginRows as Record<string, unknown>[])[0]?.count ?? 0);
    const failedLoginCount = Number((failRows as Record<string, unknown>[])[0]?.count ?? 0);
    const lastRow = (lastRows as Record<string, unknown>[])[0];
    return {
      loginCount,
      failedLoginCount,
      lastLoginAt: lastRow?.created_at ? this.sqlDateToMs(lastRow.created_at) : null
    };
  }

  public async countActiveDevices(): Promise<number> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().devices.size;
    }
    const rows = await this.query(
      "SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL AND token_class = 'device_identity'"
    );
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async countActiveDevicesByUserId(userId: string): Promise<number> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().devices.values()].filter(device => device.userId === userId).length;
    }
    const rows = await this.query(
      'SELECT COUNT(*) AS count FROM devices WHERE user_id = ? AND revoked_at IS NULL',
      [userId]
    );
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async loadAllDevices(limit = 20, offset = 0): Promise<Array<DeviceRecord & { revokedAt: number | null; userEmail: string | null }>> {
    if (!this.mysqlModeEnabled()) {
      return [...this.runtimeStore().devices.values()]
        .slice(offset, offset + limit)
        .map(device => ({ ...device, revokedAt: null, userEmail: null }));
    }
    const rows = await this.query(
      `SELECT d.*, u.email AS user_email
       FROM devices d
       LEFT JOIN users u ON d.user_id = u.id
       WHERE d.token_class = 'device_identity'
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return (rows as Record<string, unknown>[]).map(row => ({
      ...this.deviceFromRow(row),
      revokedAt: row.revoked_at ? this.sqlDateToMs(row.revoked_at) : null,
      userEmail: typeof row.user_email === 'string' ? row.user_email : null
    }));
  }

  public async countDevices(): Promise<number> {
    if (!this.mysqlModeEnabled()) {
      return this.runtimeStore().devices.size;
    }
    const rows = await this.query(
      "SELECT COUNT(*) AS count FROM devices WHERE token_class = 'device_identity'"
    );
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async revokeDeviceById(id: string): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      this.runtimeStore().devices.delete(id);
      return;
    }
    await this.query(
      'UPDATE devices SET revoked_at = NOW(), updated_at = NOW() WHERE id = ?',
      [id]
    );
  }

  public async revokeRefreshTokensByDeviceId(deviceId: string): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      for (const token of this.runtimeStore().refreshTokens.values()) {
        if (token.deviceId === deviceId) {
          token.revokedAt = Date.now();
        }
      }
      return;
    }
    await this.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(), updated_at = NOW() WHERE device_id = ? AND revoked_at IS NULL',
      [deviceId]
    );
  }
}
