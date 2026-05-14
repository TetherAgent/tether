import * as React from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';

import { TerminalLaunchPage } from '../components/terminal/terminal-launch-page.js';
import { TerminalPane } from '../components/terminal/terminal-pane.js';
import type { WorkbenchOutletContext } from '../components/workbench/workbench-layout.js';
import { WorkbenchConnectionStatus } from '../components/workbench/workbench-status-pill.js';
import { WorkbenchTopbar } from '../components/workbench/workbench-topbar.js';
import { useI18n } from '../hooks/use-i18n.js';

export function TerminalPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { onExpandSidebar, onOpenDrawer, onSessionCreateStarted, relayUrl } = useOutletContext<WorkbenchOutletContext>();
  const { t } = useI18n();
  const connectionSettings = React.useMemo(() => ({ relayUrl, relaySecret: '' }), [relayUrl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <WorkbenchTopbar
        help={{ label: t.helpNavLabel }}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
      >
        <WorkbenchConnectionStatus />
      </WorkbenchTopbar>
      <div className="min-h-0 flex-1 overflow-hidden">
        {sessionId ? (
          <TerminalPane
            sessionId={sessionId}
            replayOnly={false}
            initialStatus={t.statusConnecting}
            connectionSettings={connectionSettings}
            embedded
          />
        ) : (
          <TerminalLaunchPage
            onCreated={(id) => navigate(`/terminal/${encodeURIComponent(id)}`)}
            onCreateStarted={onSessionCreateStarted}
          />
        )}
      </div>
    </div>
  );
}
