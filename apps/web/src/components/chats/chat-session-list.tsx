import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, MoreHorizontal, PanelLeftClose, Pencil, Trash2 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input } from '@tether/design';
import { createHttpClient } from '@tether/http';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { deleteChatSession, getStoredNormalAccessToken, renameChatSession } from '../../lib/api.js';

type ChatSessionRecord = {
  id: string;
  provider: string;
  projectPath: string;
  title?: string;
  agentSessionId?: string;
  status: string;
  transport: string;
  lastActiveAt?: number;
};

function groupSessions(sessions: ChatSessionRecord[], t: { groupToday: string; groupLastWeek: string; groupEarlier: string }): { label: string; items: ChatSessionRecord[] }[] {
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 6);

  const todayItems: ChatSessionRecord[] = [];
  const weekItems: ChatSessionRecord[] = [];
  const olderItems: ChatSessionRecord[] = [];

  for (const s of sessions) {
    const ts = s.lastActiveAt ?? now;
    if (ts >= startOfToday.getTime()) todayItems.push(s);
    else if (ts >= startOfWeek.getTime()) weekItems.push(s);
    else olderItems.push(s);
  }

  const groups: { label: string; items: ChatSessionRecord[] }[] = [];
  if (todayItems.length) groups.push({ label: t.groupToday, items: todayItems });
  if (weekItems.length) groups.push({ label: t.groupLastWeek, items: weekItems });
  if (olderItems.length) groups.push({ label: t.groupEarlier, items: olderItems });
  return groups;
}

export function ChatSessionList({
  activeSessionId,
  onSelect,
  onToggleSidebar
}: {
  activeSessionId?: string;
  onSelect?: () => void;
  onToggleSidebar?: () => void;
}) {
  const { t } = useI18n();
  const { normalAuth, logoutNormal } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = React.useState<ChatSessionRecord[]>([]);
  const [renameDialog, setRenameDialog] = React.useState<{ id: string; value: string } | null>(null);

  const loadSessions = React.useCallback(() => {
    const token = getStoredNormalAccessToken();
    const http = createHttpClient();
    void http
      .get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, { token })
      .then((data: { sessions: ChatSessionRecord[] }) => setSessions(data.sessions ?? []))
      .catch(() => setSessions([]));
  }, []);

  React.useEffect(() => { loadSessions(); }, [activeSessionId, loadSessions]);

  const startRename = (session: ChatSessionRecord) => {
    const currentTitle = session.title || (session.projectPath ? (session.projectPath.split('/').pop() ?? session.provider) : session.provider);
    setRenameDialog({ id: session.id, value: currentTitle });
  };

  const commitRename = async () => {
    if (!renameDialog) return;
    const { id, value } = renameDialog;
    const title = value.trim();
    setRenameDialog(null);
    if (!title) return;
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title } : s));
    try {
      await renameChatSession(id, title);
    } catch {
      loadSessions();
    }
  };

  const handleDelete = async (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      navigate('/chats', { replace: true });
    }
    try {
      await deleteChatSession(sessionId);
    } catch {
      loadSessions();
    }
  };

  const displayEmail = normalAuth?.identity?.email ?? normalAuth?.email ?? normalAuth?.displayName ?? '';
  const accountInitial = (displayEmail || normalAuth?.displayName || 'T').slice(0, 1).toUpperCase();

  return (
    <>
    <Dialog open={!!renameDialog} onOpenChange={(open) => { if (!open) setRenameDialog(null); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.renameSession}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={renameDialog?.value ?? ''}
          onChange={(e) => setRenameDialog((prev) => prev ? { ...prev, value: e.target.value } : null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') setRenameDialog(null);
          }}
          className="mt-1"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameDialog(null)}>{t.cancel}</Button>
          <Button onClick={() => void commitRename()}>{t.renameSession}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <div className="flex h-full flex-col bg-sidebar">

      {/* Brand + new chat */}
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

      {/* New chat button */}
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

      {/* Session list */}
      <div className="flex-1 overflow-y-auto pt-1">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <div className="text-[13px] font-medium text-foreground">{t.chatsEmptyTitle}</div>
            <div className="text-xs text-muted-foreground">{t.chatsEmptyBody}</div>
          </div>
        ) : (
          <>
            {groupSessions(sessions, t).map(({ label, items }) => (
              <div key={label} className="mb-1">
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {label}
                </div>
                <div className="space-y-px px-2">
                  {items.map((session) => {
                    const active = session.id === activeSessionId;
                    const title = session.title || (session.projectPath
                      ? (session.projectPath.split('/').pop() ?? session.provider)
                      : session.provider);
                    return (
                      <div
                        key={session.id}
                        className={`group flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] leading-snug transition-colors ${
                          active
                            ? 'bg-sidebar-accent font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'
                        }`}
                      >
                        <span
                          className={`mt-px h-[7px] w-[7px] shrink-0 rounded-full transition-colors ${
                            session.status === 'running' ? 'bg-brand' : 'bg-transparent'
                          }`}
                        />
                        <Link
                          to={`/chats/${session.id}`}
                          onClick={onSelect}
                          className="min-w-0 flex-1 truncate"
                        >
                          {title}
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-opacity hover:bg-sidebar-accent ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start" className="w-36">
                            <DropdownMenuItem onSelect={() => setTimeout(() => startRename(session), 0)} className="gap-2">
                              <Pencil className="h-3.5 w-3.5" />
                              {t.renameSession}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => void handleDelete(session.id)}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t.deleteSession}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* User menu */}
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
            <DropdownMenuItem
              onSelect={logoutNormal}
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
