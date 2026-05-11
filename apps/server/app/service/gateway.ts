import { Service } from 'egg';

import { createId } from '../utils/id';
import type { GatewayRecord } from './runtime';

type BindGatewayInput = {
  email: string;
  password: string;
  gatewayName?: string;
  ip?: string;
  userAgent?: string;
};

type BindGatewayForUserInput = {
  accountId: string;
  userId: string;
  deviceKey: string;
  gatewayName?: string;
  hostname?: string;
  localPort?: number;
  ip?: string;
  userAgent?: string;
};

export default class GatewayService extends Service {
  public async bindGateway(input: BindGatewayInput) {
    const { ctx } = this;
    const login = await ctx.service.auth.loginNormalUser({
      email: input.email,
      password: input.password,
      deviceName: input.gatewayName ?? 'local-gateway',
      platform: 'gateway-cli',
      ip: input.ip,
      userAgent: input.userAgent
    });
    if (!login.user || !login.device) {
      return ctx.throw(401, 'invalid_credentials');
    }

    const existing = await ctx.service.gatewayRepository.loadGatewayByUserId(login.user.id);
    const createdAt = Date.now();
    const gateway: GatewayRecord = existing ?? {
      id: createId('gateway'),
      accountId: login.user.accountId,
      userId: login.user.id,
      name: input.gatewayName ?? 'local-gateway',
      status: 'online',
      lastSeenAt: createdAt,
      createdAt,
      updatedAt: createdAt
    };

    gateway.name = input.gatewayName ?? gateway.name ?? 'local-gateway';
    gateway.status = 'online';
    gateway.lastSeenAt = createdAt;
    gateway.updatedAt = createdAt;
    gateway.id = await ctx.service.gatewayRepository.saveGateway(gateway);

    const gatewayTokens = ctx.service.auth.issueGatewayTokenBundle({
      accountId: login.user.accountId,
      gatewayId: gateway.id,
      userId: login.user.id,
      deviceId: login.device.id
    });
    await ctx.service.auth.persistGatewayRefreshTokenPayload(gatewayTokens.refreshPayload);

    await ctx.service.audit.recordAuditEvent({
      accountId: gateway.accountId,
      userId: login.user.id,
      gatewayId: gateway.id,
      action: 'gateway.bound',
      tokenClass: 'gateway_access',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: { gatewayName: input.gatewayName ?? 'local-gateway' }
    });
    ctx.service.notification.emitNotification({
      accountId: gateway.accountId,
      userId: login.user.id,
      gatewayId: gateway.id,
      eventType: 'gateway.online',
      ts: Date.now()
    });

    return {
      gateway,
      accountId: gateway.accountId,
      gatewayAccessToken: gatewayTokens.accessToken,
      gatewayRefreshToken: gatewayTokens.refreshToken
    };
  }

  public async bindGatewayForUser(input: BindGatewayForUserInput) {
    const { ctx } = this;
    if (!/^dev_[A-Za-z0-9_-]{1,128}$/.test(input.deviceKey)) {
      ctx.throw(400, 'invalid_device_key');
    }

    const existing = await ctx.service.gatewayRepository.loadGatewayByDeviceKey(input.userId, input.deviceKey);
    const createdAt = Date.now();
    const gateway: GatewayRecord = existing ?? {
      id: createId('gateway'),
      accountId: input.accountId,
      userId: input.userId,
      name: input.gatewayName ?? input.hostname ?? 'local-gateway',
      deviceKey: input.deviceKey,
      status: 'online',
      lastSeenAt: createdAt,
      createdAt,
      updatedAt: createdAt
    };

    gateway.deviceKey = input.deviceKey;
    gateway.hostname = input.hostname;
    gateway.localPort = input.localPort;
    gateway.status = 'online';
    gateway.lastSeenAt = createdAt;
    gateway.updatedAt = createdAt;
    gateway.id = await ctx.service.gatewayRepository.upsertGatewayByDeviceKey(gateway);

    const gatewayTokens = ctx.service.auth.issueGatewayTokenBundle({
      accountId: input.accountId,
      gatewayId: gateway.id,
      userId: input.userId
    });
    await ctx.service.auth.persistGatewayRefreshTokenPayload(gatewayTokens.refreshPayload);

    await ctx.service.audit.recordAuditEvent({
      accountId: gateway.accountId,
      userId: input.userId,
      gatewayId: gateway.id,
      action: 'gateway.bound',
      tokenClass: 'gateway_access',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: {
        deviceKey: input.deviceKey,
        gatewayName: gateway.name,
        hostname: input.hostname,
        localPort: input.localPort
      }
    });
    ctx.service.notification.emitNotification({
      accountId: gateway.accountId,
      userId: input.userId,
      gatewayId: gateway.id,
      eventType: 'gateway.online',
      ts: Date.now()
    });

    return {
      gateway,
      accountId: gateway.accountId,
      gatewayAccessToken: gatewayTokens.accessToken,
      gatewayRefreshToken: gatewayTokens.refreshToken
    };
  }

  public async refreshGatewayToken(refreshToken: string) {
    const { ctx } = this;
    const payload = await ctx.service.auth.verifyToken(refreshToken);
    if (payload.tokenClass !== 'gateway_refresh') {
      ctx.throw(401, 'wrong_token_class');
    }

    const gateway = payload.gatewayId
      ? await ctx.service.gatewayRepository.loadGatewayById(payload.gatewayId)
      : undefined;
    if (!gateway) {
      return ctx.throw(404, 'gateway_missing');
    }
    if (gateway.status !== 'online') {
      ctx.throw(401, 'gateway_unlinked');
    }
    return await ctx.service.auth.refreshFromToken(refreshToken);
  }


}
