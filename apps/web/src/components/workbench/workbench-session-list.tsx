import * as React from 'react';
import { Link } from 'react-router-dom';
import type { RelaySessionSummary } from '../relay/use-relay-client.js';
import { compactProjectPath, groupWorkbenchSessions, sessionDisplayTitle } from './session-utils.js';
import { WorkbenchSessionActions } from './workbench-session-actions.js';
import type { WorkbenchSessionRecord, WorkbenchSidebarTab } from './types.js';

export function WorkbenchSessionList({
  activeSessionId,
  gatewayIdsOnline,
  onArchive,
  onRename,
  onSelect,
  onTerminalSelect,
  relaySessions,
  loaded,
  loading,
  sessions,
  tab,
  t
}: {
  activeSessionId?: string;
  gatewayIdsOnline: Set<string>;
  onArchive: (session: WorkbenchSessionRecord) => void;
  onRename: (session: WorkbenchSessionRecord) => void;
  onSelect?: () => void;
  onTerminalSelect?: (sessionId: string) => void;
  relaySessions: RelaySessionSummary[];
  loaded: boolean;
  loading: boolean;
  sessions: WorkbenchSessionRecord[];
  tab: WorkbenchSidebarTab;
  t: {
    archiveSession: string;
    chatsEmptyBody: string;
    chatsEmptyTitle: string;
    groupEarlier: string;
    groupLastWeek: string;
    groupToday: string;
    renameSession: string;
    terminalEmptyBody: string;
    terminalEmptyTitle: string;
  };
}) {
  const relaySessionById = React.useMemo(
    () => new Map(relaySessions.map((session) => [session.id, session])),
    [relaySessions]
  );

  if (!loaded && loading) {
    return (
      <div className="space-y-2 px-4 pt-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="flex items-start gap-2.5 rounded-lg px-2 py-2">
            <div className="mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full bg-muted" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-2.5 w-32 rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (loaded && sessions.length === 0) {
    return (
      <div className="px-5 pt-6 text-left">
        <div className="text-[12px] font-medium text-foreground">
          {tab === 'terminal' ? t.terminalEmptyTitle : t.chatsEmptyTitle}
        </div>
        <div className="mt-1 text-[11px] leading-4 text-muted-foreground">
          {tab === 'terminal' ? t.terminalEmptyBody : t.chatsEmptyBody}
        </div>
      </div>
    );
  }

  return (
    <>
      {groupWorkbenchSessions(sessions, t).map(({ label, items }) => (
        <div key={label} className="mb-1">
          <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            {label}
          </div>
          <div className="space-y-px px-2">
            {items.map((session) => {
              const active = session.id === activeSessionId;
              const title = sessionDisplayTitle(session);
              const meta = `${session.provider || 'agent'} · ${compactProjectPath(session.projectPath ?? '')}`;
              const relaySession = relaySessionById.get(session.id);
              const status = relaySession?.status ?? session.status;
              const gatewaySnapshotAvailable = gatewayIdsOnline.size > 0 && Boolean(session.gatewayId);
              const gatewayOnline = session.gatewayId ? gatewayIdsOnline.has(session.gatewayId) : false;
              const isRunning = status === 'running' && (
                tab !== 'terminal' || !gatewaySnapshotAvailable || gatewayOnline
              );
              const to = tab === 'terminal' ? `/terminal/${encodeURIComponent(session.id)}` : `/chats/${session.id}`;
              const handleSelect = () => {
                if (tab === 'terminal') {
                  onTerminalSelect?.(session.id);
                }
                onSelect?.();
              };
              return (
                <div
                  key={session.id}
                  className={`group flex items-start gap-2.5 rounded-lg px-3 py-2 text-[13px] leading-snug transition-colors ${
                    active
                      ? 'bg-sidebar-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'
                  }`}
                >
                  <span
                    className={`mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full transition-colors ${
                      isRunning ? 'bg-brand' : 'bg-transparent'
                    }`}
                  />
                  <Link to={to} onClick={handleSelect} className="min-w-0 flex-1">
                    <span className="block truncate">{title}</span>
                    <span className={`mt-0.5 block truncate text-[11px] font-normal ${
                      active ? 'text-muted-foreground' : 'text-muted-foreground/70'
                    }`}>
                      {meta}
                    </span>
                  </Link>
                  <WorkbenchSessionActions
                    active={active}
                    onArchive={onArchive}
                    onRename={onRename}
                    session={{ ...session, status }}
                    t={t}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
