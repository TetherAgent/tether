import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';
import { gatewayAuthHeaders, readGatewayData } from '../../lib/api.js';

type GatewayInfo = {
  gatewayId: string;
  name: string;
  hostname?: string;
  status: 'online' | 'offline' | 'revoked';
};

type GatewaySelectorProps = {
  selectedGatewayId: string | undefined;
  onSelect: (gatewayId: string) => void;
  onlineGatewayIds: Set<string>;
  readonly?: boolean;
};

function gatewayLabel(gateway: GatewayInfo): string {
  const name = gateway.name?.trim();
  if (name) return name;
  const hostname = gateway.hostname?.trim();
  if (hostname) return hostname;
  return gateway.gatewayId.slice(0, 8);
}

export function GatewaySelector({ selectedGatewayId, onSelect, onlineGatewayIds, readonly = false }: GatewaySelectorProps) {
  const { t } = useI18n();
  const [gateways, setGateways] = React.useState<GatewayInfo[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/server/gateways', { headers: gatewayAuthHeaders() })
      .then((response) => response.ok ? readGatewayData<GatewayInfo[]>(response) : [])
      .then((items) => {
        if (cancelled) return;
        setGateways(Array.isArray(items) ? items.filter((gateway) => gateway.status !== 'revoked') : []);
      })
      .catch(() => {
        if (!cancelled) {
          setGateways([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleGateways = readonly
    ? gateways.filter((gateway) => gateway.status !== 'revoked')
    : gateways.filter((gateway) => gateway.status !== 'revoked' && onlineGatewayIds.has(gateway.gatewayId));
  const selectedGateway = visibleGateways.find((gateway) => gateway.gatewayId === selectedGatewayId) ?? visibleGateways[0];

  React.useEffect(() => {
    if (!readonly && !selectedGatewayId && visibleGateways.length > 0) {
      onSelect(visibleGateways[0]!.gatewayId);
    }
  }, [onSelect, readonly, selectedGatewayId, visibleGateways]);

  if (visibleGateways.length === 0) {
    return (
      <div className="flex min-h-7 items-center rounded-md bg-muted px-3 text-xs font-medium text-muted-foreground">
        {t.gatewaySelectorEmpty}
      </div>
    );
  }

  const isOnline = selectedGateway ? onlineGatewayIds.has(selectedGateway.gatewayId) : false;
  const statusLabel = isOnline ? 'online' : t.gatewaySelectorOffline;

  if (visibleGateways.length === 1 || readonly) {
    return (
      <div className="flex h-7 max-w-[260px] items-center gap-2 rounded-md bg-muted px-3 text-xs font-medium text-foreground">
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
        <span className="truncate">{selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}</span>
        {readonly && !isOnline ? <span className="shrink-0 text-muted-foreground">{statusLabel}</span> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="max-w-[280px] gap-2 rounded-md bg-muted text-foreground"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
        <span className="truncate">{selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}</span>
        {readonly && !isOnline && selectedGateway ? <span className="text-muted-foreground">{t.gatewaySelectorOffline}</span> : null}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-9 z-50 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {visibleGateways.map((gateway) => {
            return (
              <button
                key={gateway.gatewayId}
                type="button"
                onClick={() => {
                  onSelect(gateway.gatewayId);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{gatewayLabel(gateway)}</span>
                  {gateway.hostname ? <span className="block truncate text-[11px] text-muted-foreground">{gateway.hostname}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
