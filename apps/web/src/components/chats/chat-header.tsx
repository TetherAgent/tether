import * as React from 'react';
import { Check, Copy, Menu, PanelLeftOpen } from 'lucide-react';
import { NotificationBell } from './notification-bell.js';
import { WorkbenchStatusPill } from '../workbench/workbench-status-pill.js';

export function ChatHeader({
  agentSessionId,
  connectionStatusChips,
  copiedAgentId,
  displayProvider,
  gatewayNamesById,
  onCopyAgentSession,
  onExpandSidebar,
  onOpenDrawer,
  sessionAccessError,
  t
}: {
  agentSessionId?: string;
  connectionStatusChips: React.ReactNode;
  copiedAgentId: boolean;
  displayProvider: string;
  gatewayNamesById: Record<string, string>;
  onCopyAgentSession: () => void;
  onExpandSidebar?: () => void;
  onOpenDrawer?: () => void;
  sessionAccessError?: string;
  t: {
    chatCodeCopied: string;
    chatsCopyProviderSessionId: string;
  };
}) {
  return (
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
      <div className="chat-header-connection-status">
        {connectionStatusChips}
      </div>
      {sessionAccessError ? (
        <div className="chat-header-session-status">
          <WorkbenchStatusPill state="error">{sessionAccessError}</WorkbenchStatusPill>
        </div>
      ) : null}
      {agentSessionId && (
        <button
          onClick={onCopyAgentSession}
          title={t.chatsCopyProviderSessionId.replace('{provider}', displayProvider)}
          className="workbench-status-pill workbench-status-pill--neutral workbench-status-pill-button"
        >
          {copiedAgentId
            ? <Check className="h-3 w-3 text-brand" />
            : <Copy className="h-3 w-3" />}
          <span>{copiedAgentId ? t.chatCodeCopied : t.chatsCopyProviderSessionId.replace('{provider}', displayProvider)}</span>
        </button>
      )}
      <NotificationBell gatewayNamesById={gatewayNamesById} />
    </div>
  );
}
