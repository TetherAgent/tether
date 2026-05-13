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
  const { gatewayIdsOnline, relaySessions } = useRelayClient();
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab: WorkbenchSidebarTab = location.pathname.startsWith('/terminal') ? 'terminal' : 'chats';
  const { loadSessions, sessions, setSessions } = useWorkbenchSessions({
    activeSessionId,
    refreshKey,
    tab: activeTab
  });
  const [renameDialog, setRenameDialog] = React.useState<RenameDialogState>(null);
  const [archiveSessionState, setArchiveSessionState] = React.useState<WorkbenchSessionRecord | null>(null);

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
    setSessions((prev) => prev.filter((item) => item.id !== session.id));
    if (activeSessionId === session.id) {
      navigate(session.kind === 'terminal' ? '/terminal' : '/chats', { replace: true });
    }
    try {
      await archiveSession(session.id);
    } catch {
      loadSessions();
    }
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

        <div className="flex-1 overflow-y-auto pt-1">
          <WorkbenchSessionList
            activeSessionId={activeSessionId}
            gatewayIdsOnline={gatewayIdsOnline}
            onArchive={setArchiveSessionState}
            onRename={startRename}
            onSelect={onSelect}
            onTerminalSelect={onTerminalSelect}
            relaySessions={relaySessions}
            sessions={sessions}
            tab={activeTab}
            t={t}
          />
        </div>

        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 rounded-xl border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => switchTab('chats')}
              className={`h-8 rounded-lg text-[12px] font-medium transition-colors ${
                activeTab === 'chats' ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.chatsNavLabel}
            </button>
            <button
              type="button"
              onClick={() => switchTab('terminal')}
              className={`h-8 rounded-lg text-[12px] font-medium transition-colors ${
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
