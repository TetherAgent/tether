import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Moon, PanelLeftClose, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@tether/design';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { useUiPreferences } from '../../hooks/use-ui-preferences.js';
import { useWorkbenchSessions } from '../../hooks/workbench/use-workbench-sessions.js';
import { archiveSession, renameSessionTitle } from '../../lib/api.js';
import { useRelayClient } from '../relay/use-relay-client.js';
import { ArchiveSessionDialog } from './archive-session-dialog.js';
import { RenameSessionDialog, type RenameDialogState } from './rename-session-dialog.js';
import { sessionDisplayTitle } from './session-utils.js';
import type { WorkbenchSessionRecord, WorkbenchSidebarTab } from './types.js';
import { WorkbenchSessionList } from './workbench-session-list.js';

export function WorkbenchSidebar({
  activeSessionId,
  onSelect,
  onTerminalSelect,
  onToggleSidebar,
  refreshKey = 0
}: {
  activeSessionId?: string;
  onSelect?: () => void;
  onTerminalSelect?: (sessionId: string) => void;
  onToggleSidebar?: () => void;
  refreshKey?: number;
}) {
  const { t } = useI18n();
  const { normalAuth, logoutNormal } = useAuth();
  const { isDark, toggleTheme } = useUiPreferences();
  const { gatewayIdsOnline, relaySessions, relaySessionsVersion, sendFrame } = useRelayClient();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab: WorkbenchSidebarTab = location.pathname.startsWith('/terminal') ? 'terminal' : 'chats';
  const { loaded, loading, loadSessions, sessions, setSessions } = useWorkbenchSessions({
    activeSessionId,
    refreshKey,
    relayRefreshKey: relaySessionsVersion,
    tab: activeTab
  });
  const [renameDialog, setRenameDialog] = React.useState<RenameDialogState>(null);
  const [archiveSessionState, setArchiveSessionState] = React.useState<WorkbenchSessionRecord | null>(null);
  const [archivedSessionIds, setArchivedSessionIds] = React.useState<Set<string>>(() => new Set());
  const [stopSessionState, setStopSessionState] = React.useState<WorkbenchSessionRecord | null>(null);

  const startRename = (session: WorkbenchSessionRecord) => {
    setRenameDialog({ id: session.id, value: sessionDisplayTitle(session) });
  };

  const commitRename = async () => {
    if (!renameDialog) return;
    const { id, value } = renameDialog;
    const title = value.trim();
    setRenameDialog(null);
    if (!title) return;
    setSessions((prev) => prev.map((session) => session.id === id ? { ...session, title } : session));
    try {
      await renameSessionTitle(id, title);
    } catch {
      loadSessions();
    }
  };

  const confirmArchive = async () => {
    const session = archiveSessionState;
    setArchiveSessionState(null);
    if (!session) return;
    setArchivedSessionIds((current) => new Set(current).add(session.id));
    setSessions((prev) => prev.filter((item) => item.id !== session.id));
    if (activeSessionId === session.id) {
      navigate(session.kind === 'terminal' ? '/terminal' : '/chats', { replace: true });
    }
    try {
      await archiveSession(session.id);
    } catch {
      setArchivedSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
      loadSessions();
    }
  };

  const confirmStop = () => {
    const session = stopSessionState;
    setStopSessionState(null);
    if (!session) return;
    const subscribed = sendFrame({ type: 'client.subscribe', sessionId: session.id, mode: 'control' });
    const stopped = subscribed && sendFrame({ type: 'client.stop', sessionId: session.id });
    if (!stopped) {
      loadSessions();
      return;
    }
    setSessions((prev) => prev.map((item) => item.id === session.id ? { ...item, status: 'stopped' } : item));
    window.setTimeout(() => loadSessions(), 300);
  };

  const switchTab = (tab: WorkbenchSidebarTab) => {
    if (tab === activeTab) return;
    if (tab === 'terminal') {
      navigate('/terminal');
      return;
    }
    navigate('/chats');
  };

  const displayEmail = normalAuth?.identity?.email ?? normalAuth?.email ?? normalAuth?.displayName ?? '';
  const accountInitial = (displayEmail || normalAuth?.displayName || 'T').slice(0, 1).toUpperCase();
  const visibleSessions = React.useMemo(
    () => sessions.filter((session) => !archivedSessionIds.has(session.id)),
    [archivedSessionIds, sessions]
  );
  const visibleRelaySessions = React.useMemo(
    () => relaySessions.filter((session) => !archivedSessionIds.has(session.id)),
    [archivedSessionIds, relaySessions]
  );

  return (
    <>
      <ArchiveSessionDialog
        cancelLabel={t.cancel}
        confirmLabel={t.archiveSessionConfirm}
        description={t.archiveSessionConfirmDescription}
        onConfirm={() => void confirmArchive()}
        onOpenChange={(open) => { if (!open) setArchiveSessionState(null); }}
        open={!!archiveSessionState}
        title={t.archiveSessionConfirmTitle}
      />
      <ArchiveSessionDialog
        cancelLabel={t.cancel}
        confirmLabel={t.confirmStop}
        description={t.stopSessionConfirmDescription.replace('{session}', stopSessionState ? sessionDisplayTitle(stopSessionState) : '')}
        onConfirm={confirmStop}
        onOpenChange={(open) => { if (!open) setStopSessionState(null); }}
        open={!!stopSessionState}
        title={t.stopSessionConfirmTitle}
      />
      <RenameSessionDialog
        cancelLabel={t.cancel}
        onChange={(value) => setRenameDialog((prev) => prev ? { ...prev, value } : null)}
        onCommit={() => void commitRename()}
        onOpenChange={(open) => { if (!open) setRenameDialog(null); }}
        open={!!renameDialog}
        title={t.renameSession}
        value={renameDialog?.value ?? ''}
      />
      <div className="flex h-full flex-col bg-sidebar">
        <div className="flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-black"
              style={{ background: 'var(--gradient-brand)' }}
            >
              T
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Tether</span>
          </div>
          <button
            onClick={onToggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="h-[15px] w-[15px]" />
          </button>
        </div>

        {activeTab === 'chats' && (
          <div className="px-3 pb-2">
            <Link
              to="/chats"
              onClick={onSelect}
              className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-sidebar-accent"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-black"
                style={{ background: 'var(--gradient-brand)' }}
              >
                +
              </span>
              {t.chatsNewSession}
            </Link>
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="px-3 pb-2">
            <Link
              to="/terminal"
              onClick={onSelect}
              className="flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-sidebar-accent"
            >
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-black"
                style={{ background: 'var(--gradient-brand)' }}
              >
                +
              </span>
              新建终端
            </Link>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pt-1">
          <WorkbenchSessionList
            activeSessionId={activeSessionId}
            gatewayIdsOnline={gatewayIdsOnline}
            onArchive={setArchiveSessionState}
            onRename={startRename}
            onSelect={onSelect}
            onStop={setStopSessionState}
            onTerminalSelect={onTerminalSelect}
            relaySessions={visibleRelaySessions}
            loaded={loaded}
            loading={loading}
            sessions={visibleSessions}
            tab={activeTab}
            t={t}
          />
        </div>

        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 rounded-xl border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => switchTab('chats')}
              className={`h-8 rounded-lg text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 ${
                activeTab === 'chats' ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.chatsNavLabel}
            </button>
            <button
              type="button"
              onClick={() => switchTab('terminal')}
              className={`h-8 rounded-lg text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 ${
                activeTab === 'terminal' ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.terminalView}
            </button>
          </div>
        </div>

        <div className="border-t border-sidebar-border px-3 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sidebar-accent">
                <div
                  className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-black"
                  style={{ background: 'var(--gradient-brand)' }}
                >
                  {accountInitial}
                </div>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {displayEmail || t.chatsUserAccount}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuItem onClick={toggleTheme} className="gap-2">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {isDark ? t.light : t.dark}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logoutNormal}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                {t.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}
