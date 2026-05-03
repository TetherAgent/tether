import { ApiRequestError, createHttpClient } from '@tether/http';

export type NormalAuthPayload = {
  accessToken: string;
  refreshToken: string;
  account: {
    id: string;
    email: string;
    displayName: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
  };
  device: {
    id: string;
    name: string;
    platform: string;
  };
};

export type NormalIdentity = {
  accountId: string;
  workspaceId: string;
  userId: string;
  deviceId?: string;
  tokenClass: 'normal_client_access';
  expiresAt: number;
  jti: string;
};

export type AuthStorageRecord<TIdentity> = {
  accessToken: string;
  refreshToken: string;
  identity?: TIdentity;
};

export const NORMAL_STORAGE_KEY = 'tether:web:normalAuth';

const http = createHttpClient();

function normalizeRequestError(error: unknown): Error {
  if (error instanceof ApiRequestError) {
    const detail = error.stackDetail ? `${error.message}\n\n${error.stackDetail}` : error.message;
    return new Error(detail);
  }
  return error instanceof Error ? error : new Error('network_error');
}

export function readStoredNormalAuth(): AuthStorageRecord<NormalIdentity> | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(NORMAL_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AuthStorageRecord<NormalIdentity>;
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function getStoredNormalAccessToken(): string | undefined {
  return readStoredNormalAuth()?.accessToken;
}

export function gatewayAuthHeaders(token?: string): HeadersInit | undefined {
  const accessToken = token || getStoredNormalAccessToken();
  if (!accessToken) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

export async function registerNormal(input: { email: string; password: string; displayName?: string }) {
  try {
    return await http.post<NormalAuthPayload>('/api/auth/register', input, {
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function loginNormal(input: { email: string; password: string }) {
  try {
    return await http.post<NormalAuthPayload>('/api/auth/login', input, {
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function validateNormal(accessToken: string) {
  try {
    return await http.get<NormalIdentity>('/api/auth/me', undefined, {
      token: accessToken,
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function requestGatewayWsTicket(input: {
  sessionId: string;
  mode: 'control' | 'observe';
  accessToken?: string;
}) {
  try {
    const accessToken = input.accessToken || getStoredNormalAccessToken();
    return await http.post<{ ticket: string; expiresInMs: number }>(
      '/api/ws-ticket',
      {
        sessionId: input.sessionId,
        mode: input.mode
      },
      {
        token: accessToken
      }
    );
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export function createNotificationSubscription(
  _accessToken: string,
  _onAuthStateChanged: () => void
): () => void {
  // Phase 5 keeps notification refresh wiring minimal on web:
  // successful auth can bootstrap this hook now, while the concrete
  // server-side notification channel is filled in by later runtime work.
  return () => undefined;
}
