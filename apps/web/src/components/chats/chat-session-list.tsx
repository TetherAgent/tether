import * as React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@tether/design';
import { createHttpClient } from '@tether/http';
import { useI18n } from '../../hooks/use-i18n.js';
import { ModelAvatar } from './model-avatar.js';

type ChatSessionRecord = {
  id: string;
  provider: string;
  projectPath: string;
  status: string;
  transport: string;
  lastActiveAt?: number;
};

function formatTime(value?: number) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ChatSessionList({
  activeSessionId,
  onSelect
}: {
  activeSessionId?: string;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  const [sessions, setSessions] = React.useState<ChatSessionRecord[]>([]);

  React.useEffect(() => {
      const http = createHttpClient();
      void http
        .get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions')
        .then((data: { sessions: ChatSessionRecord[] }) => setSessions(data.sessions ?? []))
        .catch(() => setSessions([]));
  }, [activeSessionId]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <div className="text-sm font-semibold">{t.chatsNavLabel}</div>
        <Button asChild size="icon-sm" variant="ghost">
          <Link to="/chats" onClick={onSelect} aria-label={t.chatsNewSession}>
            <Plus className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="text-sm font-semibold">{t.chatsEmptyTitle}</div>
            <div className="text-xs text-muted-foreground">{t.chatsEmptyBody}</div>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <Link
                  key={session.id}
                  to={`/chats/${session.id}`}
                  onClick={onSelect}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl px-3 py-3 transition-colors ${active ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/60'}`}
                >
                  <ModelAvatar provider={session.provider} label={session.provider} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{session.provider}</div>
                    <div className="truncate text-xs text-muted-foreground">{session.projectPath}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{formatTime(session.lastActiveAt)}</div>
                    {session.status === 'running' ? <div className="mt-1 h-2 w-2 rounded-full bg-emerald-500" /> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
