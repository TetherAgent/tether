import * as React from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Menu, PanelLeftOpen } from 'lucide-react';

import { NotificationBell } from '../components/chats/notification-bell.js';
import { TerminalPane } from '../components/terminal/terminal-pane.js';
import { TerminalSessionPicker } from '../components/terminal/terminal-session-picker.js';
import type { WorkbenchOutletContext } from '../components/workbench/workbench-layout.js';
import { WorkbenchConnectionStatus } from '../components/workbench/workbench-status-pill.js';
import { useI18n } from '../hooks/use-i18n.js';

export function TerminalPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { onExpandSidebar, onOpenDrawer, relayUrl } = useOutletContext<WorkbenchOutletContext>();
  const { t } = useI18n();
  const connectionSettings = React.useMemo(() => ({ relayUrl, relaySecret: '' }), [relayUrl]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur-sm">
        {onOpenDrawer && (
          <button
            onClick={onOpenDrawer}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {onExpandSidebar && (
          <button
            onClick={onExpandSidebar}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" />
          </button>
        )}
        <div className="flex-1" />
        <WorkbenchConnectionStatus />
        <NotificationBell />
      </div>
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
          <TerminalSessionPicker onSelect={(id) => navigate(`/terminal/${encodeURIComponent(id)}`)} />
        )}
      </div>
    </div>
  );
}
