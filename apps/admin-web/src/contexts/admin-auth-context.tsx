import * as React from 'react';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // atob 解码 base64url（将 - 换 +，_ 换 /）
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

type ManagementIdentity = {
  accountId: string;
  workspaceId: string;
  adminUserId: string;
  deviceId?: string;
  tokenClass: 'management_access';
  expiresAt: number;
  jti: string;
};

type AuthStorageRecord<TIdentity> = {
  accessToken: string;
  refreshToken: string;
  identity?: TIdentity;
};

const MANAGEMENT_STORAGE_KEY = 'tether:web:managementAuth';

function readStorage<T>(key: string): AuthStorageRecord<T> | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthStorageRecord<T>;
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed;
    }
  } catch { return null; }
  return null;
}

function writeStorage<T>(key: string, value: AuthStorageRecord<T> | null) {
  if (!value) { window.localStorage.removeItem(key); return; }
  window.localStorage.setItem(key, JSON.stringify(value));
}

type AdminAuthContextValue = {
  managementAuth: AuthStorageRecord<ManagementIdentity> | null;
  authReady: boolean;
  loginManagement: (input: { email: string; password: string }) => Promise<void>;
  logoutManagement: () => void;
};

export const AdminAuthContext = React.createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [managementAuth, setManagementAuth] = React.useState<AuthStorageRecord<ManagementIdentity> | null>(null);
  const [authReady, setAuthReady] = React.useState(false);

  React.useEffect(() => {
    const stored = readStorage<ManagementIdentity>(MANAGEMENT_STORAGE_KEY);
    setManagementAuth(stored);
    setAuthReady(true);
  }, []);

  const loginManagement = React.useCallback(async (input: { email: string; password: string }) => {
    const response = await fetch('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input)
    });
    const body = await response.json().catch(() => undefined) as { accessToken?: string; refreshToken?: string; error?: string } | undefined;
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `request_failed_${response.status}`;
      throw new Error(message);
    }
    if (!body || typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') {
      throw new Error('invalid_response');
    }
    const jwtPayload = decodeJwtPayload(body.accessToken);
    const identity: ManagementIdentity | undefined = jwtPayload && typeof jwtPayload.adminUserId === 'string'
      ? {
          adminUserId: jwtPayload.adminUserId as string,
          accountId: typeof jwtPayload.accountId === 'string' ? jwtPayload.accountId : '',
          workspaceId: typeof jwtPayload.workspaceId === 'string' ? jwtPayload.workspaceId : '',
          tokenClass: 'management_access',
          expiresAt: typeof jwtPayload.exp === 'number' ? jwtPayload.exp : 0,
          jti: typeof jwtPayload.jti === 'string' ? jwtPayload.jti : ''
        }
      : undefined;
    const record: AuthStorageRecord<ManagementIdentity> = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      identity
    };
    writeStorage(MANAGEMENT_STORAGE_KEY, record);
    setManagementAuth(record);
  }, []);

  const logoutManagement = React.useCallback(() => {
    writeStorage(MANAGEMENT_STORAGE_KEY, null);
    setManagementAuth(null);
  }, []);

  const value = React.useMemo<AdminAuthContextValue>(() => ({
    managementAuth,
    authReady,
    loginManagement,
    logoutManagement
  }), [managementAuth, authReady, loginManagement, logoutManagement]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}
