import * as React from 'react';
import { ApiRequestError, createHttpClient } from '@tether/http';

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
  adminEmail: string;
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
const http = createHttpClient();

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
    let payload: {
      accessToken: string;
      refreshToken: string;
    };
    try {
      payload = await http.post('/api/admin/auth/login', input, {
        suppressGlobalError: true
      });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        throw new Error(error.message);
      }
      throw (error instanceof Error ? error : new Error('network_error'));
    }
    if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
      throw new Error('invalid_response');
    }
    const jwtPayload = decodeJwtPayload(payload.accessToken);
    const identity: ManagementIdentity | undefined = jwtPayload && typeof jwtPayload.adminUserId === 'string'
      ? {
          adminUserId: jwtPayload.adminUserId as string,
          adminEmail: typeof jwtPayload.adminEmail === 'string' ? jwtPayload.adminEmail : '',
          accountId: typeof jwtPayload.accountId === 'string' ? jwtPayload.accountId : '',
          workspaceId: typeof jwtPayload.workspaceId === 'string' ? jwtPayload.workspaceId : '',
          tokenClass: 'management_access',
          expiresAt: typeof jwtPayload.expiresAt === 'number' ? jwtPayload.expiresAt : 0,
          jti: typeof jwtPayload.jti === 'string' ? jwtPayload.jti : ''
        }
      : undefined;
    const record: AuthStorageRecord<ManagementIdentity> = {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
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
