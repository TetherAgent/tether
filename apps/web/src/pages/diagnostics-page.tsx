import * as React from 'react';
import { useOutletContext } from 'react-router-dom';

import { useI18n } from '../hooks/use-i18n.js';
import { useRelayClient } from '../components/relay/use-relay-client.js';
import type { WorkbenchOutletContext } from '../components/workbench/workbench-layout.js';
import { WorkbenchConnectionStatus } from '../components/workbench/workbench-status-pill.js';
import { WorkbenchTopbar } from '../components/workbench/workbench-topbar.js';

function formatTime(value?: number): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleTimeString();
}

export function DiagnosticsPage() {
  const { t } = useI18n();
  const { onExpandSidebar, onOpenDrawer, relayUrl } = useOutletContext<WorkbenchOutletContext>();
  const relay = useRelayClient();
  const gateways = React.useMemo(
    () => Object.values(relay.gatewayStatusById).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    [relay.gatewayStatusById]
  );

  const rows = [
    { label: t.diagnosticsRelayUrl, value: relayUrl },
    { label: t.diagnosticsRelaySocket, value: relay.wsReady ? t.chatsRelayConnected : t.chatsRelayConnecting },
    { label: t.diagnosticsGatewayState, value: relay.gatewayConnected ? t.chatsGatewayConnected : t.chatsGatewayWaiting },
    { label: t.diagnosticsDefaultGateway, value: relay.defaultGatewayId ?? '-' },
    { label: t.diagnosticsConnectionEpoch, value: String(relay.connectionEpoch) },
    { label: t.diagnosticsVisibleSessions, value: String(relay.relaySessions.length) }
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <WorkbenchTopbar
        help={{ label: t.helpNavLabel }}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
      >
        <WorkbenchConnectionStatus />
      </WorkbenchTopbar>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t.diagnosticsEyebrow}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
              {t.diagnosticsTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t.diagnosticsDescription}
            </p>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="rounded-2xl border border-border bg-card p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {row.label}
                </div>
                <div className="mt-2 break-all text-sm font-semibold text-foreground">
                  {row.value}
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-base font-semibold text-foreground">{t.diagnosticsGateways}</h2>
            <div className="mt-4 divide-y divide-border">
              {gateways.length > 0 ? gateways.map((gateway) => (
                <div key={gateway.gatewayId} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {relay.gatewayNamesById[gateway.gatewayId] ?? gateway.gatewayId}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{gateway.gatewayId}</div>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {gateway.status}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(gateway.lastSeenAt)}
                  </div>
                </div>
              )) : (
                <div className="py-6 text-sm text-muted-foreground">{t.gatewaySelectorEmpty}</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
