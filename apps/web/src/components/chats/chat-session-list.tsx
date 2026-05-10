import * as React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquarePlus, LogOut } from 'lucide-react';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@tether/design';
import { createHttpClient } from '@tether/http';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { getStoredNormalAccessToken } from '../../lib/api.js';

type ChatSessionRecord = {
  id: string;
  provider: string;
  projectPath: string;
  status: string;
  transport: string;
  lastActiveAt?: number;
};

export function ChatSessionList({
  activeSessionId,
  onSelect
}: {
  activeSessionId?: string;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  const { normalAuth, logoutNormal } = useAuth();
  const [sessions, setSessions] = React.useState<ChatSessionRecord[]>([]);

  React.useEffect(() => {
    const token = getStoredNormalAccessToken();
    const http = createHttpClient();
    void http
      .get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, { token })
      .then((data: { sessions: ChatSessionRecord[] }) => setSessions(data.sessions ?? []))
      .catch(() => setSessions([]));
  }, [activeSessionId]);

  const accountInitial = (normalAuth?.identity?.accountId ?? 'T').slice(0, 1).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Brand */}
      <div className="px-5 pb-3 pt-5">
        <div className="text-xl font-bold tracking-tight">Tether</div>
      </div>

      {/* New chat button */}
      <div className="px-3 pb-3">
        <Button asChild variant="outline" className="w-full justify-start gap-2 rounded-xl font-medium">
          <Link to="/chats" onClick={onSelect}>
            <MessageSquarePlus className="h-4 w-4 shrink-0" />
            {t.chatsNewSession}
          </Link>
        </Button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {sessions.length > 0 && (
          <div className="px-5 pb-1 pt-2">
            <div className="text-xs font-medium text-muted-foreground">{t.chatsRecentLabel}</div>
          </div>
        )}
        <div className="px-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <div className="text-sm font-semibold">{t.chatsEmptyTitle}</div>
              <div className="text-xs text-muted-foreground">{t.chatsEmptyBody}</div>
            </div>
          ) : (
            sessions.map((session) => {
              const active = session.id === activeSessionId;
              const title = session.projectPath
                ? (session.projectPath.split('/').pop() ?? session.provider)
                : session.provider;
              return (
                <Link
                  key={session.id}
                  to={`/chats/${session.id}`}
                  onClick={onSelect}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-sidebar-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                  }`}
                >
                  {session.status === 'running' && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  )}
                  <span className="truncate">{title}</span>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* User menu */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent/60">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500 text-xs font-semibold text-white">
                {accountInitial}
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium">
                  {normalAuth?.identity?.accountId ?? t.chatsUserAccount}
                </div>
              </div>
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
  );
}
