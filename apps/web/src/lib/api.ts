import { ApiRequestError, createHttpClient } from '@tether/http';
import type { ApprovalDecision, ApprovalRequest } from '@tether/protocol';

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
  userId: string;
  email: string;
  deviceId?: string;
  cliLatestVersion?: string | null;
};

export type AuthStorageRecord<TIdentity> = {
  accessToken: string;
  refreshToken: string;
  identity?: TIdentity;
  email?: string;
  displayName?: string;
};

export const NORMAL_STORAGE_KEY = 'tether:web:normalAuth';

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
    return 'web-h5';
  }
  return 'web-pc';
}

const http = createHttpClient({
  defaultHeaders: { 'x-client-platform': detectPlatform() }
});

function normalizeRequestError(error: unknown): Error {
  if (error instanceof ApiRequestError) {
    return error;
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

export async function readGatewayData<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { code?: number; data?: T };
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    const payload = body as { code?: number; data?: T };
    return payload.data as T;
  }
  return body as T;
}

export async function registerNormal(input: { email: string; password: string; displayName?: string }) {
  try {
    return await http.post<NormalAuthPayload>('/api/server/auth/register', input, {
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function loginNormal(input: { email: string; password: string }) {
  try {
    return await http.post<NormalAuthPayload>('/api/server/auth/login', input, {
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function refreshNormal(refreshToken: string) {
  try {
    return await http.post<NormalAuthPayload>('/api/server/auth/refresh', { refreshToken }, {
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function validateNormal(accessToken: string) {
  try {
    return await http.get<NormalIdentity>('/api/server/auth/me', undefined, {
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
      '/api/server/ws-ticket',
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

export async function renameSessionTitle(sessionId: string, title: string, token?: string) {
  try {
    return await http.patch<{ ok: boolean }>(`/api/server/sessions/${sessionId}/title`, { title }, {
      token: token ?? getStoredNormalAccessToken(),
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function archiveSession(sessionId: string, token?: string) {
  try {
    return await http.post<{ ok: boolean }>(`/api/server/sessions/${sessionId}/archive`, null, {
      token: token ?? getStoredNormalAccessToken(),
      suppressGlobalError: true
    });
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function listApprovals(input: { status?: 'pending' | 'all'; token?: string } = {}) {
  try {
    const params = new URLSearchParams();
    params.set('status', input.status ?? 'pending');
    const response = await http.get<{ approvals: ApprovalRequest[] }>(
      `/api/server/approvals?${params.toString()}`,
      undefined,
      {
        token: input.token ?? getStoredNormalAccessToken(),
        suppressGlobalError: true
      }
    );
    return response.approvals ?? [];
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function decideApproval(input: {
  approvalId: string;
  decision: ApprovalDecision;
  token?: string;
}) {
  try {
    const response = await http.post<{ approval: ApprovalRequest }>(
      `/api/server/approvals/${encodeURIComponent(input.approvalId)}/decision`,
      { decision: input.decision },
      {
        token: input.token ?? getStoredNormalAccessToken(),
        suppressGlobalError: true
      }
    );
    return response.approval;
  } catch (error) {
    throw normalizeRequestError(error);
  }
}

export async function decideApprovalByRequest(input: {
  sessionId: string;
  requestId: string;
  decision: ApprovalDecision;
  token?: string;
}) {
  try {
    const response = await http.post<{ approval?: ApprovalRequest }>(
      '/api/server/approvals/by-request/decision',
      {
        sessionId: input.sessionId,
        requestId: input.requestId,
        decision: input.decision
      },
      {
        token: input.token ?? getStoredNormalAccessToken(),
        suppressGlobalError: true
      }
    );
    return response.approval;
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
