import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Wifi, WifiOff } from 'lucide-react';
import { Button, Skeleton } from '@tether/design';

import { useI18n } from '../../hooks/use-i18n.js';
import { providerResumeCommand } from '../../lib/provider-resume-command.js';

export function SessionDetailHeader({
  sessionId,
  status,
  provider,
  agentSessionId,
  children
}: {
  sessionId: string;
  status: string;
  provider?: string;
  agentSessionId?: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const syncMode = t.relay;
  const statusIcon = status === t.statusDisconnected || status === t.statusStreamError || status === t.statusRelayClosed || status === t.statusRelayError
    ? <WifiOff aria-hidden="true" />
    : <Wifi aria-hidden="true" />;

  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(() => {
    if (!provider || !agentSessionId) return;
    void navigator.clipboard.writeText(providerResumeCommand(provider, agentSessionId)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [provider, agentSessionId]);

  const [sessionIdCopied, setSessionIdCopied] = React.useState(false);
  const copySessionId = React.useCallback(() => {
    void navigator.clipboard.writeText(sessionId).then(() => {
      setSessionIdCopied(true);
      setTimeout(() => setSessionIdCopied(false), 1200);
    }).catch(() => {});
  }, [sessionId]);

  return (
    <header className="session-detail-header">
      <div className="session-detail-title">
        <Button asChild variant="outline" size="icon" type="button">
          <Link to="/sessions" aria-label={t.backToSessions}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="session-id-copy"
            onClick={copySessionId}
            title={sessionIdCopied ? t.copiedResumeCommand : t.copySessionId}
            aria-label={sessionIdCopied ? t.copiedResumeCommand : t.copySessionId}
          >
            {sessionId}
            {sessionIdCopied ? (
              <Check aria-hidden="true" className="session-id-copy-icon" />
            ) : (
              <Copy aria-hidden="true" className="session-id-copy-icon" />
            )}
          </button>
          <span className="session-id-suffix">· {syncMode} {t.syncSuffix}</span>
          {agentSessionId && provider ? (
            <Button variant="outline" size="icon" type="button" title={`${agentSessionId.slice(0, 8)} · ${t.copyResumeCommand}`} onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          ) : null}
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
