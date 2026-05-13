import * as React from 'react';

import { useAuth } from './use-auth.js';

const GATEWAY_VERSION_EVENT = 'tether:gateway-version';
let gatewayVersionsById: Record<string, string> = {};

type GatewayVersionEventDetail = {
  gatewayId: string;
  version: string;
};

export type OutdatedGatewayVersion = {
  gatewayId: string;
  name: string;
  currentVersion: string;
};

type UpdateStatus = {
  latestVersion: string | null;
  hasUpdate: boolean;
  outdatedGateways: OutdatedGatewayVersion[];
};

export function rememberGatewayVersion(gatewayId: string, version: string): void {
  gatewayVersionsById = { ...gatewayVersionsById, [gatewayId]: version };
  window.dispatchEvent(new CustomEvent<GatewayVersionEventDetail>(GATEWAY_VERSION_EVENT, {
    detail: { gatewayId, version }
  }));
}

export function useUpdateCheck(gatewayNamesById: Record<string, string> = {}): UpdateStatus & { dismiss: () => void } {
  const { normalAuth } = useAuth();
  const [versionsById, setVersionsById] = React.useState<Record<string, string>>(() => gatewayVersionsById);
  const [dismissedVersion, setDismissedVersion] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<UpdateStatus>({
    latestVersion: null,
    hasUpdate: false,
    outdatedGateways: []
  });

  React.useEffect(() => {
    const latest = normalAuth?.identity?.cliLatestVersion ?? null;
    const outdatedGateways = latest
      ? Object.entries(versionsById)
        .filter(([, version]) => isOutdatedVersion(version, latest))
        .map(([gatewayId, version]) => ({
          gatewayId,
          name: gatewayNamesById[gatewayId] ?? gatewayId.slice(0, 8),
          currentVersion: version
        }))
      : [];
    const hasUpdate = Boolean(latest && outdatedGateways.length > 0 && dismissedVersion !== latest);
    setStatus({ latestVersion: latest, hasUpdate, outdatedGateways });
  }, [dismissedVersion, gatewayNamesById, normalAuth?.identity?.cliLatestVersion, versionsById]);

  React.useEffect(() => {
    const onGatewayVersion = (event: Event) => {
      const detail = (event as CustomEvent<GatewayVersionEventDetail>).detail;
      if (!detail || typeof detail.gatewayId !== 'string' || typeof detail.version !== 'string') {
        setVersionsById(gatewayVersionsById);
        return;
      }
      setVersionsById((current) => ({ ...current, [detail.gatewayId]: detail.version }));
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

function isOutdatedVersion(current: string, latest: string): boolean {
  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);
  if (!currentParts || !latestParts) {
    return current !== latest;
  }
  for (let index = 0; index < latestParts.length; index += 1) {
    const delta = currentParts[index] - latestParts[index];
    if (delta < 0) return true;
    if (delta > 0) return false;
  }
  return false;
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
