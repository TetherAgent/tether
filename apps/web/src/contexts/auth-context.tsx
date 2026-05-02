import * as React from 'react';

import {
  createNotificationSubscription,
  type AuthStorageRecord,
  type ManagementIdentity,
  type NormalIdentity,
  loginManagement,
  loginNormal,
  registerManagement,
  registerNormal,
  validateManagement,
  validateNormal
} from '../lib/api.js';

const NORMAL_STORAGE_KEY = 'tether:web:normalAuth';
const MANAGEMENT_STORAGE_KEY = 'tether:web:managementAuth';

type AuthContextValue = {
  normalAuth: AuthStorageRecord<NormalIdentity> | null;
  managementAuth: AuthStorageRecord<ManagementIdentity> | null;
  authReady: boolean;
  loginNormal: (input: { email: string; password: string }) => Promise<void>;
  registerNormal: (input: { email: string; password: string; displayName?: string }) => Promise<void>;
  loginManagement: (input: { email: string; password: string }) => Promise<void>;
  registerManagement: (input: { email: string; password: string; displayName?: string }) => Promise<void>;
  logoutNormal: () => void;
  logoutManagement: () => void;
  validateNormalSession: () => Promise<boolean>;
  validateManagementSession: () => Promise<boolean>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

function readStorage<T>(key: string): AuthStorageRecord<T> | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AuthStorageRecord<T>;
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function writeStorage<T>(key: string, value: AuthStorageRecord<T> | null) {
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [normalAuth, setNormalAuth] = React.useState<AuthStorageRecord<NormalIdentity> | null>(null);
  const [managementAuth, setManagementAuth] = React.useState<AuthStorageRecord<ManagementIdentity> | null>(null);
  const [authReady, setAuthReady] = React.useState(false);

  const normalNotificationCleanup = React.useRef<(() => void) | null>(null);

  const logoutNormal = React.useCallback(() => {
    normalNotificationCleanup.current?.();
    normalNotificationCleanup.current = null;
    writeStorage(NORMAL_STORAGE_KEY, null);
    setNormalAuth(null);
  }, []);

  const logoutManagement = React.useCallback(() => {
    writeStorage(MANAGEMENT_STORAGE_KEY, null);
    setManagementAuth(null);
  }, []);

  const persistNormal = React.useCallback((record: AuthStorageRecord<NormalIdentity>) => {
    writeStorage(NORMAL_STORAGE_KEY, record);
    setNormalAuth(record);
    normalNotificationCleanup.current?.();
    normalNotificationCleanup.current = createNotificationSubscription(record.accessToken, () => {
      void validateNormalSession();
    });
  }, []);

  const persistManagement = React.useCallback((record: AuthStorageRecord<ManagementIdentity>) => {
    writeStorage(MANAGEMENT_STORAGE_KEY, record);
    setManagementAuth(record);
  }, []);

  const validateNormalSession = React.useCallback(async () => {
    const stored = readStorage<NormalIdentity>(NORMAL_STORAGE_KEY);
    if (!stored?.accessToken) {
      logoutNormal();
      return false;
    }
    try {
      const identity = await validateNormal(stored.accessToken);
      persistNormal({ ...stored, identity });
      return true;
    } catch {
      logoutNormal();
      return false;
    }
  }, [logoutNormal, persistNormal]);

  const validateManagementSession = React.useCallback(async () => {
    const stored = readStorage<ManagementIdentity>(MANAGEMENT_STORAGE_KEY);
    if (!stored?.accessToken) {
      logoutManagement();
      return false;
    }
    try {
      const identity = await validateManagement(stored.accessToken);
      if (identity.tokenClass !== 'management_access') {
        throw new Error('wrong_token_class');
      }
      persistManagement({ ...stored, identity });
      return true;
    } catch {
      logoutManagement();
      return false;
    }
  }, [logoutManagement, persistManagement]);

  React.useEffect(() => {
    const normal = readStorage<NormalIdentity>(NORMAL_STORAGE_KEY);
    const management = readStorage<ManagementIdentity>(MANAGEMENT_STORAGE_KEY);
    setNormalAuth(normal);
    setManagementAuth(management);

    void Promise.all([
      normal ? validateNormalSession() : Promise.resolve(false),
      management ? validateManagementSession() : Promise.resolve(false)
    ]).finally(() => setAuthReady(true));

    const handleStorage = () => {
      setNormalAuth(readStorage<NormalIdentity>(NORMAL_STORAGE_KEY));
      setManagementAuth(readStorage<ManagementIdentity>(MANAGEMENT_STORAGE_KEY));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [validateManagementSession, validateNormalSession]);

  const value = React.useMemo<AuthContextValue>(() => ({
    normalAuth,
    managementAuth,
    authReady,
    loginNormal: async (input) => {
      const result = await loginNormal(input);
      const identity = await validateNormal(result.accessToken);
      persistNormal({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        identity
      });
    },
    registerNormal: async (input) => {
      const result = await registerNormal(input);
      const identity = await validateNormal(result.accessToken);
      persistNormal({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        identity
      });
    },
    loginManagement: async (input) => {
      const result = await loginManagement(input);
      const identity = await validateManagement(result.accessToken);
      if (identity.tokenClass !== 'management_access') {
        throw new Error('wrong_token_class');
      }
      persistManagement({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        identity
      });
    },
    registerManagement: async (input) => {
      const result = await registerManagement(input);
      const identity = await validateManagement(result.accessToken);
      if (identity.tokenClass !== 'management_access') {
        throw new Error('wrong_token_class');
      }
      persistManagement({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        identity
      });
    },
    logoutNormal,
    logoutManagement,
    validateNormalSession,
    validateManagementSession
  }), [
    authReady,
    logoutManagement,
    logoutNormal,
    managementAuth,
    normalAuth,
    persistManagement,
    persistNormal,
    validateManagementSession,
    validateNormalSession
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
