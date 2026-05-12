import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResponseCode } from '@tether/core';

export type GatewayAuthState = {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  gatewayId?: string;
  accountId?: string;
  userId?: string;
};

export type GatewayAuthLoadResult =
  | { ok: true; value: GatewayAuthState }
  | { ok: false; status: 500 | 401; error: string };

export function gatewayAuthPath(): string {
  return process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json');
}

export async function loadGatewayAuthState(): Promise<GatewayAuthLoadResult> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    return { ok: false, status: 401, error: 'gateway_auth_missing' };
  }
  const parsed = parseGatewayAuthState(raw);
  if (!parsed) {
    return { ok: false, status: 500, error: 'gateway_auth_invalid' };
  }
  if (parsed.expiresAt <= Date.now() + 5 * 60 * 1000) {
    const refreshed = await refreshGatewayAuthState(parsed).catch(() => undefined);
    if (refreshed) {
      return { ok: true, value: refreshed };
    }
  }
  if (parsed.expiresAt <= Date.now()) {
    return { ok: false, status: 401, error: 'gateway_auth_expired' };
  }
  return { ok: true, value: parsed };
}

export function parseGatewayAuthState(raw: string): GatewayAuthState | undefined {
  try {
    const value = JSON.parse(raw) as Partial<GatewayAuthState>;
    if (
      typeof value.serverUrl === 'string' &&
      typeof value.accessToken === 'string' &&
      typeof value.refreshToken === 'string' &&
      typeof value.expiresAt === 'number'
    ) {
      return value as GatewayAuthState;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
  const body = await response.json().catch(() => undefined);
  const data = unwrapServerApiData<{ accessToken?: unknown; refreshToken?: unknown }>(body);
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return undefined;
  }
  const payload = decodeGatewayToken(data.accessToken);
  if (typeof payload?.expiresAt !== 'number') {
    return undefined;
  }
  const next: GatewayAuthState = {
    serverUrl: state.serverUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: payload.expiresAt
  };
  await mkdir(path.dirname(gatewayAuthPath()), { recursive: true });
  await writeFile(gatewayAuthPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export function decodeGatewayToken(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function unwrapServerApiData<T>(body: unknown): T | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if ('code' in body) {
    const payload = body as { code?: number; data?: T | null };
    return payload.code === ResponseCode.SUCCESS && payload.data ? payload.data : undefined;
  }
  return body as T;
}
