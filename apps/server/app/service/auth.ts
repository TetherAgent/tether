import { Service } from 'egg';

import type { AuthScopePayload, AuthTokenClass } from '@tether/core';

import {
  issueTokenBundle as issueSignedTokenBundle,
  verifySignedToken,
  type AuthConfig,
  type TokenBundle,
  type VerifiedToken
} from '../utils/auth-token';
import { createId } from '../utils/id';
import type {
  AccountRecord,
  AdminUserRecord,
  AuditEventRecord,
  DeviceRecord,
  NotificationEvent,
  RefreshTokenRecord,
  UserRecord
} from './runtime';

export type { AuthConfig, TokenBundle, VerifiedToken };

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

export type BcryptContext = {
  genHash(password: string): Promise<string | undefined>;
  compare(password: string, passwordHash: string): Promise<boolean | undefined>;
};

export default class AuthService extends Service {
  private get authConfig(): AuthConfig {
    const { app } = this;
    return app.config as AuthConfig;
  }

  private now() {
    return Date.now();
  }

  private newId(prefix: string) {
    return createId(prefix);
  }

  private statusForAuthError(message: string): number {
    if (message === 'email_already_registered') return 409;
    if (message === 'subject_missing') return 404;
    if (
      message === 'invalid_credentials' ||
      message === 'missing_token' ||
      message === 'wrong_token_class' ||
      message === 'invalid_token' ||
      message === 'invalid_signature' ||
      message === 'token_expired' ||
      message === 'token_revoked' ||
      message === 'unsupported_refresh_subject'
    ) {
      return 401;
    }
    return 400;
  }

  private async hashPassword(password: string): Promise<string> {
    const { ctx } = this;
    const hash = await (ctx as unknown as BcryptContext).genHash(password);
    if (!hash) {
      throw new Error('password_hash_failed');
    }
    return hash;
  }

  private async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    const { ctx } = this;
    return Boolean(await (ctx as unknown as BcryptContext).compare(password, passwordHash));
  }

  private issueTokenBundle(
    payload: Omit<AuthScopePayload, 'tokenClass' | 'expiresAt' | 'jti'>,
    accessTokenClass: AuthTokenClass,
    refreshTokenClass: AuthTokenClass
  ): TokenBundle {
    return issueSignedTokenBundle(
      payload,
      this.authConfig,
      accessTokenClass,
      refreshTokenClass,
      this.now(),
      () => this.newId('jti')
    );
  }

  private normalTokenPayload(user: UserRecord, device: DeviceRecord) {
    return {
      accountId: user.accountId,
      userId: user.id,
      deviceId: device.id
    };
  }

  private managementTokenPayload(user: AdminUserRecord, device: DeviceRecord) {
    return {
      accountId: user.accountId,
      adminUserId: user.id,
      adminEmail: user.email,
      deviceId: device.id
    };
  }

  private async persistRefreshTokenPayload(payload: AuthScopePayload): Promise<void> {
    const record: RefreshTokenRecord = {
      id: this.newId('rt'),
      jti: payload.jti,
      tokenClass: payload.tokenClass,
      accountId: payload.accountId,
      userId: payload.userId,
      adminUserId: payload.adminUserId,
      deviceId: payload.deviceId,
      gatewayId: payload.gatewayId,
      expiresAt: payload.expiresAt,
      createdAt: this.now()
    };

    const { ctx } = this;
    await ctx.service.authRepository.saveRefreshToken(record);
  }

  private async createDevice(base: {
    accountId: string;
    userId?: string;
    adminUserId?: string;
    deviceName?: string;
    platform?: string;
  }, options?: { persist?: boolean }): Promise<DeviceRecord> {
    const createdAt = this.now();
    const name = base.deviceName ?? 'web-browser';
    const platform = base.platform ?? 'web';

    if (options?.persist === false) {
      return {
        id: this.newId('device'),
        accountId: base.accountId,
        userId: base.userId,
        adminUserId: base.adminUserId,
        name,
        platform,
        createdAt,
        updatedAt: createdAt
      };
    }

    return await this.ctx.service.authRepository.findOrCreateDevice({
      accountId: base.accountId,
      userId: base.userId,
      adminUserId: base.adminUserId,
      name,
      platform,
      createdAt,
      updatedAt: createdAt
    });
  }

  private async primaryAccountRecord(): Promise<AccountRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadPrimaryAccount();
  }

  private async normalUserByEmail(email: string): Promise<UserRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadUserByEmail(email);
  }

  private async normalUserById(id: string): Promise<UserRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadUserById(id);
  }

  private async managementUserByEmail(email: string): Promise<AdminUserRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadAdminUserByEmail(email);
  }

  private async managementUserById(id: string): Promise<AdminUserRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadAdminUserById(id);
  }

  private async deviceById(id: string): Promise<DeviceRecord | undefined> {
    const { ctx } = this;
    return await ctx.service.authRepository.loadDeviceById(id);
  }

  private async adminUserCount(): Promise<number> {
    const { ctx } = this;
    return await ctx.service.authRepository.countAdminUsers();
  }

  private decodeToken(rawToken: string): VerifiedToken {
    const payload = verifySignedToken(rawToken, this.authConfig, this.now());
    return payload;
  }


  private async recordAuthAudit(input: Omit<AuditEventRecord, 'id' | 'createdAt'>) {
    const { ctx } = this;
    return await ctx.service.audit.recordAuditEvent(input);
  }

  private emitAuthNotification(input: NotificationEvent) {
    const { ctx } = this;
    ctx.service.notification.emitNotification(input);
  }

  private rethrow(error: unknown, fallback: string): never {
    const { ctx } = this;
    const message = error instanceof Error ? error.message : fallback;
    ctx.throw(this.statusForAuthError(message), message);
    throw new Error(message);
  }

  public async registerNormalUser(input: RegisterInput) {
    const { ctx } = this;
    try {
      const existing = await this.normalUserByEmail(input.email);
      if (existing) {
        return ctx.throw(409, 'email_already_registered');
      }

      const createdAt = this.now();
      let account = await this.primaryAccountRecord();

      if (!account) {
        const passwordHash = await this.hashPassword(input.password);
        account = {
          id: this.newId('acct'),
          email: input.email,
          displayName: input.displayName ?? input.email.split('@')[0] ?? 'owner',
          status: 'active',
          createdAt,
          updatedAt: createdAt
        };
        const user: UserRecord = {
          id: this.newId('user'),
          accountId: account.id,
          email: input.email,
          passwordHash,
          status: 'active',
          createdAt,
          updatedAt: createdAt
        };
        const device = await this.createDevice({
          accountId: account.id,
          userId: user.id,
          deviceName: input.deviceName,
          platform: input.platform
        }, { persist: false });

        const ids = await ctx.service.authRepository.createAccountOwnerUser({
            account: { ...account, passwordHash },
            user,
            device
        });
        account.id = ids.accountId;
        user.id = ids.userId;
        user.accountId = ids.accountId;
        device.id = ids.deviceId;
        device.accountId = ids.accountId;
        device.userId = ids.userId;

        const tokens = this.issueTokenBundle(this.normalTokenPayload(user, device), 'normal_client_access', 'normal_client_refresh');
        await this.persistRefreshTokenPayload(tokens.refreshPayload);
        await this.recordAuthAudit({
          accountId: account.id,
          userId: user.id,
          deviceId: device.id,
          action: 'auth.registered',
          tokenClass: 'normal_client_access',
          ip: input.ip,
          userAgent: input.userAgent,
          payload: { email: input.email }
        });
        this.emitAuthNotification({
          accountId: account.id,
          userId: user.id,
          deviceId: device.id,
          eventType: 'auth.state.changed',
          ts: this.now()
        });

        return {
          account,
          user,
          device,
          ...tokens
        };
      }

      const passwordHash = await this.hashPassword(input.password);
      const user: UserRecord = {
        id: this.newId('user'),
        accountId: account.id,
        email: input.email,
        passwordHash,
        status: 'active',
        createdAt,
        updatedAt: createdAt
      };
      const device = await this.createDevice({
        accountId: account.id,
        userId: user.id,
        deviceName: input.deviceName,
        platform: input.platform
      }, { persist: false });

      const ids = await ctx.service.authRepository.createNormalUser({ user, device });
      user.id = ids.userId;
      device.id = ids.deviceId;
      device.userId = ids.userId;

      const tokens = this.issueTokenBundle(this.normalTokenPayload(user, device), 'normal_client_access', 'normal_client_refresh');
      await this.persistRefreshTokenPayload(tokens.refreshPayload);
      await this.recordAuthAudit({
        accountId: account.id,
        userId: user.id,
        deviceId: device.id,
        action: 'auth.registered',
        tokenClass: 'normal_client_access',
        ip: input.ip,
        userAgent: input.userAgent,
        payload: { email: input.email }
      });
      this.emitAuthNotification({
        accountId: account.id,
        userId: user.id,
        deviceId: device.id,
        eventType: 'auth.state.changed',
        ts: this.now()
      });

      return {
        account,
        user,
        device,
        ...tokens
      };
    } catch (error) {
      return this.rethrow(error, 'register_failed');
    }
  }

  public async loginNormalUser(input: LoginInput) {
    const { ctx } = this;
    try {
      const user = await this.normalUserByEmail(input.email);
      if (!user || !(await this.verifyPassword(input.password, user.passwordHash))) {
        if (user) {
          await this.recordAuthAudit({
            accountId: user.accountId,
            userId: user.id,
            action: 'auth.login.failed',
            failureReason: 'invalid_credentials',
            ip: input.ip,
            userAgent: input.userAgent,
            payload: { email: input.email }
          });
        }
        return ctx.throw(401, 'invalid_credentials');
      }

      const device = await this.createDevice({
        accountId: user.accountId,
        userId: user.id,
        deviceName: input.deviceName,
        platform: input.platform
      });
      const tokens = this.issueTokenBundle(this.normalTokenPayload(user, device), 'normal_client_access', 'normal_client_refresh');
      await this.persistRefreshTokenPayload(tokens.refreshPayload);
      await this.recordAuthAudit({
        accountId: user.accountId,
        userId: user.id,
        deviceId: device.id,
        action: 'auth.login.succeeded',
        tokenClass: 'normal_client_access',
        ip: input.ip,
        userAgent: input.userAgent,
        payload: { email: input.email }
      });
      this.emitAuthNotification({
        accountId: user.accountId,
        deviceId: device.id,
        eventType: 'auth.state.changed',
        ts: this.now()
      });

      return {
        user,
        device,
        ...tokens
      };
    } catch (error) {
      return this.rethrow(error, 'login_failed');
    }
  }

  public async registerManagementUser(input: RegisterInput) {
    const { ctx } = this;
    try {
      let account = await this.primaryAccountRecord();

      if (!account) {
        const bootstrapAt = this.now();
        account = {
          id: this.newId('acct'),
          email: input.email,
          displayName: input.email,
          status: 'active',
          createdAt: bootstrapAt,
          updatedAt: bootstrapAt
        };
        const ids = await ctx.service.authRepository.bootstrapAccount({ account });
        account.id = ids.accountId;
      }

      const existing = await this.managementUserByEmail(input.email);
      if (existing) {
        return ctx.throw(409, 'email_already_registered');
      }

      const createdAt = this.now();
      const adminUser: AdminUserRecord = {
        id: this.newId('admin'),
        accountId: account.id,
        email: input.email,
        passwordHash: await this.hashPassword(input.password),
        role: (await this.adminUserCount()) === 0 ? 'super_admin' : 'admin',
        status: 'active',
        createdAt,
        updatedAt: createdAt
      };

      const device = await this.createDevice({
        accountId: account.id,
        adminUserId: adminUser.id,
        deviceName: input.deviceName,
        platform: input.platform
      }, { persist: false });

      const ids = await ctx.service.authRepository.createAdminUser({ adminUser, device });
      adminUser.id = ids.adminId;
      device.id = ids.deviceId;
      device.adminUserId = ids.adminId;

      const tokens = this.issueTokenBundle(this.managementTokenPayload(adminUser, device), 'management_access', 'management_refresh');
      await this.persistRefreshTokenPayload(tokens.refreshPayload);
      await this.recordAuthAudit({
        accountId: account.id,
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
    } catch (error) {
      return this.rethrow(error, 'admin_register_failed');
    }
  }

  public async loginManagementUser(input: LoginInput) {
    const { ctx } = this;
    try {
      const adminUser = await this.managementUserByEmail(input.email);
      if (!adminUser || !(await this.verifyPassword(input.password, adminUser.passwordHash))) {
        if (adminUser) {
          await this.recordAuthAudit({
            accountId: adminUser.accountId,
            adminUserId: adminUser.id,
            action: 'admin.login.failed',
            failureReason: 'invalid_credentials',
            ip: input.ip,
            userAgent: input.userAgent,
            payload: { email: input.email }
          });
        }
        return ctx.throw(401, 'invalid_credentials');
      }

      const device = await this.createDevice({
        accountId: adminUser.accountId,
        adminUserId: adminUser.id,
        deviceName: input.deviceName,
        platform: input.platform
      });
      const tokens = this.issueTokenBundle(this.managementTokenPayload(adminUser, device), 'management_access', 'management_refresh');
      await this.persistRefreshTokenPayload(tokens.refreshPayload);
      await this.recordAuthAudit({
        accountId: adminUser.accountId,
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
    } catch (error) {
      return this.rethrow(error, 'admin_login_failed');
    }
  }

  public async refreshFromToken(refreshToken: string) {
    const { ctx } = this;
    try {
      const payload = this.decodeToken(refreshToken);
      if (!payload.tokenClass.endsWith('_refresh')) {
        return ctx.throw(401, 'wrong_token_class');
      }

      const record = await ctx.service.authRepository.loadRefreshTokenByJti(payload.jti);
      if (!record || record.revokedAt) {
        return ctx.throw(401, 'token_revoked');
      }

      if (payload.realm === 'normal' && payload.userId && payload.deviceId) {
        const user = await this.normalUserById(payload.userId);
        const device = await this.deviceById(payload.deviceId);
        if (!user || !device) {
          return ctx.throw(404, 'subject_missing');
        }
        const tokens = this.issueTokenBundle(this.normalTokenPayload(user, device), 'normal_client_access', 'normal_client_refresh');
        await this.persistRefreshTokenPayload(tokens.refreshPayload);
        return tokens;
      }

      if (payload.realm === 'management' && payload.adminUserId && payload.deviceId) {
        const user = await this.managementUserById(payload.adminUserId);
        const device = await this.deviceById(payload.deviceId);
        if (!user || !device) {
          return ctx.throw(404, 'subject_missing');
        }
        const tokens = this.issueTokenBundle(this.managementTokenPayload(user, device), 'management_access', 'management_refresh');
        await this.persistRefreshTokenPayload(tokens.refreshPayload);
        return tokens;
      }

      if (payload.realm === 'gateway' && payload.gatewayId) {
        const gateway = await ctx.service.gatewayRepository.loadGatewayById(payload.gatewayId);
        if (!gateway) {
          return ctx.throw(404, 'subject_missing');
        }
        const tokens = this.issueTokenBundle({
          accountId: gateway.accountId,
          gatewayId: gateway.id,
          userId: gateway.userId,
          deviceId: record.deviceId
        }, 'gateway_access', 'gateway_refresh');
        await this.persistRefreshTokenPayload(tokens.refreshPayload);
        return tokens;
      }

      return ctx.throw(401, 'unsupported_refresh_subject');
    } catch (error) {
      return this.rethrow(error, 'refresh_failed');
    }
  }

  public async logoutToken(rawToken: string) {
    const { ctx } = this;
    try {
      const payload = this.decodeToken(rawToken);
      await ctx.service.authRepository.revokeRefreshTokenByJti(payload.jti, this.now());
      await this.recordAuthAudit({
        accountId: payload.accountId,
        userId: payload.userId,
        adminUserId: payload.adminUserId,
        deviceId: payload.deviceId,
        gatewayId: payload.gatewayId,
        action: 'auth.logout',
        tokenClass: payload.tokenClass,
        payload: {}
      });
      this.emitAuthNotification({
        accountId: payload.accountId,
        userId: payload.userId,
        adminUserId: payload.adminUserId,
        deviceId: payload.deviceId,
        gatewayId: payload.gatewayId,
        eventType: 'auth.logout',
        ts: this.now()
      });
    } catch (error) {
      return this.rethrow(error, 'logout_failed');
    }
  }

  public async currentUserFromToken(rawToken: string) {
    const { ctx } = this;
    try {
      const payload = this.decodeToken(rawToken);
      if (payload.realm !== 'normal' || !payload.userId) {
        return ctx.throw(401, 'wrong_token_class');
      }
      const user = await this.normalUserById(payload.userId);
      if (!user) {
        return ctx.throw(404, 'subject_missing');
      }
      return {
        accountId: user.accountId,
        userId: user.id,
        email: user.email,
        deviceId: payload.deviceId
      };
    } catch (error) {
      return this.rethrow(error, 'me_failed');
    }
  }

  public async validateToken(rawToken: string) {
    try {
      return this.decodeToken(rawToken);
    } catch (error) {
      return this.rethrow(error, 'token_validate_failed');
    }
  }

  public async verifyToken(rawToken: string) {
    try {
      return this.decodeToken(rawToken);
    } catch (error) {
      return this.rethrow(error, 'token_validate_failed');
    }
  }

  public decodeAccessToken(rawToken: string) {
    try {
      return this.decodeToken(rawToken);
    } catch (error) {
      return this.rethrow(error, 'token_validate_failed');
    }
  }

  public issueGatewayTokenBundle(
    payload: Omit<AuthScopePayload, 'tokenClass' | 'expiresAt' | 'jti'>
  ) {
    return this.issueTokenBundle(payload, 'gateway_access', 'gateway_refresh');
  }

  public async persistGatewayRefreshTokenPayload(payload: AuthScopePayload) {
    await this.persistRefreshTokenPayload(payload);
  }
}
