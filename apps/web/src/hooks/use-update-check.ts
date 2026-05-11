import * as React from 'react';
import { useAuth } from './use-auth.js';

const NPM_PACKAGE = '@tether-labs/cli';
const DISMISSED_KEY = 'tether:dismissedUpdateVersion';
const NPM_CACHE_KEY = 'tether:npmLatestVersion';
const NPM_CACHE_TS_KEY = 'tether:npmLatestVersionTs';
const NPM_CACHE_TTL = 60 * 60 * 1000; // 1 hour

type UpdateStatus = {
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
};

async function fetchLatestFromNpm(): Promise<string | null> {
  const cached = localStorage.getItem(NPM_CACHE_KEY);
  const cachedTs = Number(localStorage.getItem(NPM_CACHE_TS_KEY) ?? '0');
  if (cached && Date.now() - cachedTs < NPM_CACHE_TTL) return cached;

  const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`)
    .then((r) => r.json() as Promise<{ version?: string }>)
    .catch(() => ({} as { version?: string }));
  const version = res.version ?? null;
  if (version) {
    localStorage.setItem(NPM_CACHE_KEY, version);
    localStorage.setItem(NPM_CACHE_TS_KEY, String(Date.now()));
  }
  return version;
}

export function useUpdateCheck(): UpdateStatus & { dismiss: () => void } {
  const { normalAuth } = useAuth();
  const currentVersion = normalAuth?.identity?.app?.version ?? null;
  const [status, setStatus] = React.useState<UpdateStatus>({
    currentVersion: null,
    latestVersion: null,
    hasUpdate: false
  });

  React.useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const latest = await fetchLatestFromNpm();
        if (cancelled) return;

        const dismissed = localStorage.getItem(DISMISSED_KEY);
        const hasUpdate = Boolean(currentVersion && latest && currentVersion !== latest && dismissed !== latest);
        setStatus({ currentVersion, latestVersion: latest, hasUpdate });
      } catch {
        // ignore — version check is best-effort
      }
    }

    void check();
    return () => { cancelled = true; };
  }, [currentVersion]);

  const dismiss = React.useCallback(() => {
    setStatus((prev) => {
      if (prev.latestVersion) localStorage.setItem(DISMISSED_KEY, prev.latestVersion);
      return { ...prev, hasUpdate: false };
    });
  }, []);

  return { ...status, dismiss };
}
