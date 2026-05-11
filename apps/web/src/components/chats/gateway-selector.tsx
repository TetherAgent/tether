import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
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
  onSelect: (gatewayId: string, name: string) => void;
  onGatewayName?: (gatewayId: string, name: string) => void;
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

export function GatewaySelector({ selectedGatewayId, onSelect, onGatewayName, onlineGatewayIds, readonly = false }: GatewaySelectorProps) {
  const { t } = useI18n();
  const [gateways, setGateways] = React.useState<GatewayInfo[]>([]);
  const [open, setOpen] = React.useState(false);
  const [dropdownRect, setDropdownRect] = React.useState<DOMRect | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const onGatewayNameRef = React.useRef(onGatewayName);
  onGatewayNameRef.current = onGatewayName;

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

  const visibleGateways = React.useMemo(
    () => gateways.filter((gateway) => gateway.status !== 'revoked'),
    [gateways]
  );
  const onlineGateways = React.useMemo(
    () => visibleGateways.filter((gateway) => onlineGatewayIds.has(gateway.gatewayId)),
    [onlineGatewayIds, visibleGateways]
  );

  React.useEffect(() => {
    if (
      !readonly &&
      onlineGateways.length > 0 &&
      (!selectedGatewayId || !visibleGateways.some((gateway) => gateway.gatewayId === selectedGatewayId))
    ) {
      const first = onlineGateways[0]!;
      onSelect(first.gatewayId, gatewayLabel(first));
    }
  }, [onSelect, onlineGateways, readonly, selectedGatewayId, visibleGateways]);

  const selectedGateway = visibleGateways.find((gw) => gw.gatewayId === selectedGatewayId) ?? visibleGateways[0];

  React.useEffect(() => {
    if (selectedGateway) {
      onGatewayNameRef.current?.(selectedGateway.gatewayId, gatewayLabel(selectedGateway));
    }
  }, [selectedGateway]);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      setDropdownRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen((current) => !current);
  };

  const isOnline = selectedGateway ? onlineGatewayIds.has(selectedGateway.gatewayId) : false;
  const statusLabel = isOnline ? 'online' : t.gatewaySelectorOffline;

  if (visibleGateways.length === 0) {
    return null;
  }

  if (readonly) {
    return (
      <div
        title={selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}
        className="chat-gateway-selector-trigger flex h-7 items-center gap-2 rounded-md bg-muted px-3 text-xs font-medium text-foreground"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
        <span className="min-w-0 flex-1 truncate">{selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}</span>
        {readonly && !isOnline ? <span className="shrink-0 text-muted-foreground">{statusLabel}</span> : null}
      </div>
    );
  }

  const dropdown = open && dropdownRect ? ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: dropdownRect.bottom + 4,
        right: window.innerWidth - dropdownRect.right,
        width: 288,
        zIndex: 9999,
      }}
      className="overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      {visibleGateways.map((gateway) => {
        const optionOnline = onlineGatewayIds.has(gateway.gatewayId);
        const optionSelected = gateway.gatewayId === selectedGateway?.gatewayId;
        return (
          <button
            key={gateway.gatewayId}
            type="button"
            disabled={!optionOnline}
            aria-checked={optionSelected}
            role="menuitemradio"
            onClick={() => {
              if (!optionOnline) return;
              onSelect(gateway.gatewayId, gatewayLabel(gateway));
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
              optionSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent'
            } ${optionOnline ? '' : 'cursor-not-allowed opacity-55'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${optionOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{gatewayLabel(gateway)}</span>
              {gateway.hostname && gateway.hostname !== gatewayLabel(gateway) ? <span className="block truncate text-[11px] text-muted-foreground">{gateway.hostname}</span> : null}
            </span>
            {optionSelected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
          </button>
        );
      })}
    </div>,
    document.body
  ) : null;

  return (
    <div className="chat-gateway-selector relative" ref={triggerRef}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={handleToggle}
        aria-expanded={open}
        title={selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}
        className="chat-gateway-selector-trigger chat-toolbar-trigger"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${isOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
        <span className="min-w-0 flex-1 truncate text-left">{selectedGateway ? gatewayLabel(selectedGateway) : t.gatewaySelectorSelect}</span>
        {readonly && !isOnline && selectedGateway ? <span className="text-muted-foreground">{t.gatewaySelectorOffline}</span> : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </Button>
      {dropdown}
    </div>
  );
}
