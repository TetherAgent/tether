import { recordAuditEvent } from './audit';
import { emitNotification } from './notification';
import { issueTokenBundle, loginNormalUser, persistRefreshTokenPayload, refreshFromToken, revokeToken, verifyToken, type AuthConfig } from './auth';
import { defaultWorkspaceForAccount, newId, now, runtimeStore, type GatewayRecord } from './runtime';
import { loadDefaultWorkspace, loadGatewayById, loadGatewayByUserId, loadPrimaryAccount, mysqlModeEnabled, saveGateway } from './storage';

export async function bindGateway(input: {
  email: string;
  password: string;
  gatewayName?: string;
  ip?: string;
  userAgent?: string;
}, config: AuthConfig) {
  const login = await loginNormalUser({
    email: input.email,
    password: input.password,
    deviceName: input.gatewayName ?? 'local-gateway',
    platform: 'gateway-cli',
    ip: input.ip,
    userAgent: input.userAgent
  }, config);

  const existing = mysqlModeEnabled()
    ? await loadGatewayByUserId(login.user.id)
    : [...runtimeStore().gateways.values()].find((gateway) => gateway.userId === login.user.id);
  const createdAt = now();
  const gateway: GatewayRecord = existing ?? {
    id: newId('gateway'),
    accountId: login.user.accountId,
    workspaceId: login.user.workspaceId,
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
  if (mysqlModeEnabled()) {
    gateway.id = await saveGateway(gateway);
  } else {
    runtimeStore().gateways.set(gateway.id, gateway);
  }

  const gatewayTokens = issueTokenBundle({
    accountId: login.user.accountId,
    workspaceId: login.user.workspaceId,
    gatewayId: gateway.id,
    userId: login.user.id,
    deviceId: login.device.id
  }, config, 'gateway_access', 'gateway_refresh');
  await persistRefreshTokenPayload(gatewayTokens.refreshPayload);

  await recordAuditEvent({
    accountId: gateway.accountId,
    workspaceId: gateway.workspaceId,
    userId: login.user.id,
    gatewayId: gateway.id,
    action: 'gateway.bound',
    tokenClass: 'gateway_access',
    ip: input.ip,
    userAgent: input.userAgent,
    payload: { gatewayName: input.gatewayName ?? 'local-gateway' }
  });
  emitNotification({
    accountId: gateway.accountId,
    workspaceId: gateway.workspaceId,
    userId: login.user.id,
    gatewayId: gateway.id,
    eventType: 'gateway.online',
    ts: now()
  });

  return {
    gateway,
    accountId: gateway.accountId,
    workspaceId: gateway.workspaceId,
    gatewayAccessToken: gatewayTokens.accessToken,
    gatewayRefreshToken: gatewayTokens.refreshToken
  };
}

export async function refreshGatewayToken(refreshToken: string, config: AuthConfig) {
  const payload = verifyToken(refreshToken, config);
  if (payload.tokenClass !== 'gateway_refresh') {
    throw new Error('wrong_token_class');
  }

  const gateway = payload.gatewayId
    ? mysqlModeEnabled()
      ? await loadGatewayById(payload.gatewayId)
      : runtimeStore().gateways.get(payload.gatewayId)
    : undefined;
  if (!gateway) {
    throw new Error('gateway_missing');
  }
  if (gateway.status !== 'online') {
    throw new Error('gateway_unlinked');
  }
  return await refreshFromToken(refreshToken, config);
}

export async function revokeGatewayToken(token: string, config: AuthConfig) {
  await revokeToken(token, config, 'gateway_revoke');
}

export async function currentGatewayWorkspace() {
  const account = mysqlModeEnabled() ? await loadPrimaryAccount() : [...runtimeStore().accounts.values()][0];
  return account
    ? mysqlModeEnabled()
      ? await loadDefaultWorkspace(account.id)
      : defaultWorkspaceForAccount(account.id)
    : undefined;
}
