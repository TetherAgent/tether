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

export type ManagementAuthPayload = {
  accessToken: string;
  refreshToken: string;
  adminUser: {
    id: string;
    email: string;
    role: string;
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

export type ManagementIdentity = {
  accountId: string;
  workspaceId: string;
  adminUserId: string;
  deviceId?: string;
  tokenClass: 'management_access';
  expiresAt: number;
  jti: string;
};

export type AuthStorageRecord<TIdentity> = {
  accessToken: string;
  refreshToken: string;
  identity?: TIdentity;
};

type RequestOptions = RequestInit & {
  token?: string;
};

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type') && options.body) {
    headers.set('content-type', 'application/json');
  }
  if (options.token) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => undefined) as { error?: string } | T | undefined;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `request_failed_${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export function gatewayAuthHeaders(token: string | undefined): HeadersInit | undefined {
  if (!token) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${token}`
  };
}

export async function registerNormal(input: { email: string; password: string; displayName?: string }) {
  return requestJson<NormalAuthPayload>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function loginNormal(input: { email: string; password: string }) {
  return requestJson<NormalAuthPayload>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function registerManagement(input: { email: string; password: string; displayName?: string }) {
  return requestJson<ManagementAuthPayload>('/api/admin/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function loginManagement(input: { email: string; password: string }) {
  return requestJson<ManagementAuthPayload>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function validateNormal(accessToken: string) {
  return requestJson<NormalIdentity>('/api/auth/me', {
    method: 'GET',
    token: accessToken
  });
}

export async function validateManagement(accessToken: string) {
  return requestJson<ManagementIdentity>('/api/token/validate', {
    method: 'POST',
    token: accessToken,
    body: JSON.stringify({ token: accessToken })
  });
}

export async function requestGatewayWsTicket(input: {
  sessionId: string;
  mode: 'control' | 'observe';
  accessToken: string;
}) {
  return requestJson<{ ticket: string; expiresInMs: number }>('/api/ws-ticket', {
    method: 'POST',
    token: input.accessToken,
    body: JSON.stringify({
      sessionId: input.sessionId,
      mode: input.mode
    })
  });
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
