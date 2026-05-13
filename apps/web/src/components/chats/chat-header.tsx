import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { WorkbenchStatusPill } from '../workbench/workbench-status-pill.js';
import { WorkbenchTopbar } from '../workbench/workbench-topbar.js';

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
    <WorkbenchTopbar
      gatewayNamesById={gatewayNamesById}
      onExpandSidebar={onExpandSidebar}
      onOpenDrawer={onOpenDrawer}
    >
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
    </WorkbenchTopbar>
  );
}
