import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unwrapServerApiData } from '../utils/server-api.js';
import { decodeTokenPayload } from './token.js';

const GATEWAY_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export type GatewayAuthState = {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export function gatewayAuthPath(): string {
  return process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json');
}

export async function gatewayAuthHeaders(): Promise<Record<string, string>> {
  const auth = await readFreshGatewayAuthState();
  return { authorization: `Bearer ${auth.accessToken}` };
}

export async function readFreshGatewayAuthState(): Promise<GatewayAuthState> {
  const auth = await readGatewayAuthState();
  if (auth.expiresAt > Date.now() + GATEWAY_TOKEN_REFRESH_SKEW_MS) {
    return auth;
  }
  const refreshed = await refreshGatewayAuthState(auth).catch(() => undefined);
  if (refreshed) {
    return refreshed;
  }
  if (auth.expiresAt <= Date.now()) {
    throw new Error('本地 auth.json 已过期，且 refresh 失败。请重新执行 tether login。');
  }
  return auth;
}

export async function readGatewayAuthState(): Promise<GatewayAuthState> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    throw new Error('缺少 ~/.tether/auth.json，请先执行 tether login。');
  }
  const parsed = JSON.parse(raw) as Partial<GatewayAuthState>;
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    throw new Error('auth.json 格式无效，请重新执行 tether login。');
  }
  return parsed as GatewayAuthState;
}

export async function writeGatewayAuthState(state: GatewayAuthState): Promise<void> {
  await mkdir(path.dirname(gatewayAuthPath()), { recursive: true });
  await writeFile(gatewayAuthPath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function refreshGatewayAuthState(state: GatewayAuthState): Promise<GatewayAuthState | undefined> {
  const response = await fetch(`${state.serverUrl}/api/relay/gateway/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  if (!response.ok) {
    return undefined;
  }
  const data = unwrapServerApiData(await response.json().catch(() => undefined)) as { accessToken?: unknown; refreshToken?: unknown } | undefined;
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return undefined;
  }
  const payload = decodeTokenPayload(data.accessToken);
  if (!payload || typeof payload.expiresAt !== 'number') {
    return undefined;
  }
  const next: GatewayAuthState = {
    serverUrl: state.serverUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: payload.expiresAt
  };
  await writeGatewayAuthState(next);
  return next;
}

export async function gatewayAuthSummary(): Promise<{
  state: string;
  gatewayId?: string;
  accountId?: string;
  expiresAt?: number;
}> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    return { state: '未登录' };
  }
  let parsed: Partial<GatewayAuthState>;
  try {
    parsed = JSON.parse(raw) as Partial<GatewayAuthState>;
  } catch {
    return { state: 'auth.json 无效' };
  }
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return { state: 'auth.json 无效' };
  }
  const refreshed = await readFreshGatewayAuthState().catch(() => undefined);
  const auth = refreshed ?? (parsed as GatewayAuthState);
  const payload = decodeTokenPayload(auth.accessToken);
  return {
    state: refreshed ? '已登录' : auth.expiresAt > Date.now() ? '已登录（refresh 未确认）' : '已过期',
    gatewayId: typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined,
    accountId: typeof payload?.accountId === 'string' ? payload.accountId : undefined,
    expiresAt: auth.expiresAt
  };
}
