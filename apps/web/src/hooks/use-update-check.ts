import * as React from 'react';

import { useAuth } from './use-auth.js';

const GATEWAY_VERSION_EVENT = 'tether:gateway-version';
let currentGatewayVersion: string | null = null;

type UpdateStatus = {
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
};

export function rememberGatewayVersion(version: string): void {
  currentGatewayVersion = version;
  window.dispatchEvent(new CustomEvent(GATEWAY_VERSION_EVENT, { detail: version }));
}

export function useUpdateCheck(): UpdateStatus & { dismiss: () => void } {
  const { normalAuth } = useAuth();
  const [currentVersion, setCurrentVersion] = React.useState<string | null>(() => currentGatewayVersion);
  const [dismissedVersion, setDismissedVersion] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<UpdateStatus>({
    currentVersion: null,
    latestVersion: null,
    hasUpdate: false
  });

  React.useEffect(() => {
    const latest = normalAuth?.identity?.cliLatestVersion ?? null;
    const hasUpdate = Boolean(currentVersion && latest && currentVersion !== latest && dismissedVersion !== latest);
    setStatus({ currentVersion, latestVersion: latest, hasUpdate });
  }, [currentVersion, dismissedVersion, normalAuth?.identity?.cliLatestVersion]);

  React.useEffect(() => {
    const onGatewayVersion = (event: Event) => {
      const version = (event as CustomEvent<string>).detail;
      setCurrentVersion(typeof version === 'string' ? version : currentGatewayVersion);
    };
    window.addEventListener(GATEWAY_VERSION_EVENT, onGatewayVersion);
    return () => {
      window.removeEventListener(GATEWAY_VERSION_EVENT, onGatewayVersion);
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setStatus((prev) => {
      setDismissedVersion(prev.latestVersion);
      return { ...prev, hasUpdate: false };
    });
  }, []);

  return { ...status, dismiss };
}
