import * as React from 'react';

import { useI18n } from '../../hooks/use-i18n.js';
import { useRelayClient } from '../relay/use-relay-client.js';

export type WorkbenchStatusPillState = 'connected' | 'connecting' | 'error' | 'neutral';

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

export function WorkbenchConnectionStatus() {
  const { t } = useI18n();
  const { gatewayConnected, wsReady } = useRelayClient();

  return (
    <div className="workbench-status-group">
      <WorkbenchStatusPill state={gatewayConnected ? 'connected' : 'connecting'}>
        {gatewayConnected ? 'Gateway' : t.chatsGatewayConnecting}
      </WorkbenchStatusPill>
      <WorkbenchStatusPill state={wsReady ? 'connected' : 'connecting'}>
        {wsReady ? 'Relay' : t.chatsRelayConnecting}
      </WorkbenchStatusPill>
    </div>
  );
}
