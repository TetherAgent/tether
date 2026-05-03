import * as React from 'react';

import {
  NORMAL_STORAGE_KEY,
  createNotificationSubscription,
  type AuthStorageRecord,
  type NormalIdentity,
  loginNormal,
  readStoredNormalAuth,
  registerNormal,
  validateNormal
} from '../lib/api.js';

type AuthContextValue = {
  normalAuth: AuthStorageRecord<NormalIdentity> | null;
  authReady: boolean;
  loginNormal: (input: { email: string; password: string }) => Promise<void>;
  registerNormal: (input: { email: string; password: string; displayName?: string }) => Promise<void>;
  logoutNormal: () => void;
  validateNormalSession: () => Promise<boolean>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

function readStorage<T>(key: string): AuthStorageRecord<T> | null {
  if (key === NORMAL_STORAGE_KEY) {
    return readStoredNormalAuth() as AuthStorageRecord<T> | null;
  }
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
  const [authReady, setAuthReady] = React.useState(false);

  const normalNotificationCleanup = React.useRef<(() => void) | null>(null);

  const logoutNormal = React.useCallback(() => {
    normalNotificationCleanup.current?.();
    normalNotificationCleanup.current = null;
    writeStorage(NORMAL_STORAGE_KEY, null);
    setNormalAuth(null);
  }, []);

  const persistNormal = React.useCallback((record: AuthStorageRecord<NormalIdentity>) => {
    writeStorage(NORMAL_STORAGE_KEY, record);
    setNormalAuth(record);
    normalNotificationCleanup.current?.();
    normalNotificationCleanup.current = createNotificationSubscription(record.accessToken, () => {
      void validateNormalSession();
    });
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

  React.useEffect(() => {
    const normal = readStorage<NormalIdentity>(NORMAL_STORAGE_KEY);
    setNormalAuth(normal);

    void (normal ? validateNormalSession() : Promise.resolve(false)).finally(() => setAuthReady(true));

    const handleStorage = () => {
      setNormalAuth(readStorage<NormalIdentity>(NORMAL_STORAGE_KEY));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [validateNormalSession]);

  const value = React.useMemo<AuthContextValue>(() => ({
    normalAuth,
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
    logoutNormal,
    validateNormalSession
  }), [
    authReady,
    logoutNormal,
    normalAuth,
    persistNormal,
    validateNormalSession
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
