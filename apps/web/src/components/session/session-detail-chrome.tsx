import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Wifi, WifiOff } from 'lucide-react';
import { Button, Skeleton } from '@tether/design';

import { useI18n } from '../../hooks/use-i18n.js';

type ConnectionMode = 'direct' | 'relay';

export function SessionDetailHeader({
  sessionId,
  connectionMode,
  status,
  children
}: {
  sessionId: string;
  connectionMode: ConnectionMode;
  status: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const syncMode = connectionMode === 'relay' ? t.relay : t.direct;
  const statusIcon = status === t.statusDisconnected || status === t.statusStreamError || status === t.statusRelayClosed || status === t.statusRelayError
    ? <WifiOff aria-hidden="true" />
    : <Wifi aria-hidden="true" />;

  return (
    <header className="session-detail-header">
      <div className="session-detail-title">
        <Button asChild variant="outline" size="icon" type="button">
          <Link to="/sessions" aria-label={t.backToSessions}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div>
          <span>{sessionId} · {syncMode} {t.syncSuffix}</span>
        </div>
      </div>
      <div className="session-detail-actions">
        {children}
        <div className="status session-sync-status">
          {statusIcon}
          <span>{status}</span>
        </div>
      </div>
    </header>
  );
}

export function TerminalSurfaceSkeleton() {
  return (
    <div className="terminal-skeleton" aria-hidden="true">
      {Array.from({ length: 13 }).map((_, index) => (
        <Skeleton
          className={`terminal-skeleton-line terminal-skeleton-line-${(index % 5) + 1}`}
          key={index}
        />
      ))}
    </div>
  );
}
