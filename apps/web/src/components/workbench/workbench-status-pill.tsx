import * as React from 'react';

import { useI18n } from '../../hooks/use-i18n.js';
import { useRelayClient } from '../relay/use-relay-client.js';

export type WorkbenchStatusPillState = 'connected' | 'connecting' | 'error' | 'neutral';
export type WorkbenchCompactConnectionState = 'connected' | 'connecting' | 'error' | 'unknown';

export function WorkbenchStatusPill({
  children,
  state
}: {
  children: React.ReactNode;
  state: WorkbenchStatusPillState;
}) {
  return (
    <div className={`workbench-status-pill workbench-status-pill--${state}`} role="status" aria-live="polite">
      {state === 'connected' || state === 'error' ? <span className="workbench-status-pill-dot" /> : null}
      <strong>{children}</strong>
    </div>
  );
}

export function WorkbenchCompactConnectionStatus({
  gateway,
  relay
}: {
  gateway: { state: WorkbenchCompactConnectionState; label: string };
  relay: { state: WorkbenchCompactConnectionState; label: string };
}) {
  const aggregateState: Exclude<WorkbenchCompactConnectionState, 'unknown'> = gateway.state === 'error' || relay.state === 'error'
    ? 'error'
    : gateway.state === 'connected' && relay.state === 'connected'
      ? 'connected'
      : 'connecting';
  const tooltip = `${gateway.label} · ${relay.label}`;

  return (
    <div
      className={`chat-compact-status chat-compact-status--${aggregateState}`}
      role="status"
      aria-label={tooltip}
    >
      <span className="chat-compact-status-item">
        <span className={`chat-compact-status-dot chat-compact-status-dot--${gateway.state}`} />
        <span>G</span>
      </span>
      <span className="chat-compact-status-item">
        <span className={`chat-compact-status-dot chat-compact-status-dot--${relay.state}`} />
        <span>R</span>
      </span>
      <span className="chat-compact-status-tooltip">{tooltip}</span>
    </div>
  );
}

export function WorkbenchConnectionStatus() {
  const { t } = useI18n();
  const { gatewayConnected, wsReady } = useRelayClient();

  return (
    <WorkbenchCompactConnectionStatus
      gateway={wsReady
        ? {
            state: gatewayConnected ? 'connected' : 'connecting',
            label: gatewayConnected ? t.chatsGatewayConnected : t.chatsGatewayWaiting
          }
        : { state: 'unknown', label: t.chatsGatewayUnknown }}
      relay={wsReady
        ? { state: 'connected', label: t.chatsRelayConnected }
        : { state: 'connecting', label: t.chatsRelayConnecting }}
    />
  );
}
