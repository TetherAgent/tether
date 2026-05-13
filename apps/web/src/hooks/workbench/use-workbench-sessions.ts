import * as React from 'react';
import { gatewayAuthHeaders, getStoredNormalAccessToken, readGatewayData } from '../../lib/api.js';
import { fetchChatSessions } from '../../components/chats/chat-data.js';
import type { WorkbenchSessionRecord, WorkbenchSidebarTab } from '../../components/workbench/types.js';

export function useWorkbenchSessions({
  activeSessionId,
  refreshKey,
  tab
}: {
  activeSessionId?: string;
  refreshKey: number;
  tab: WorkbenchSidebarTab;
}) {
  const [sessions, setSessions] = React.useState<WorkbenchSessionRecord[]>([]);

  const loadSessions = React.useCallback(() => {
    const token = getStoredNormalAccessToken();
    if (tab === 'terminal') {
      void fetch('/api/server/sessions?limit=30', { headers: gatewayAuthHeaders(token) })
        .then((response) => response.ok ? readGatewayData<{ sessions: WorkbenchSessionRecord[] }>(response) : { sessions: [] })
        .then((data) => setSessions((data.sessions ?? [])
          .filter((session) => session.transport !== 'chat' && session.status === 'running')
          .map((session) => ({ ...session, kind: 'terminal' }))))
        .catch(() => undefined);
      return;
    }
    void fetchChatSessions(token, false)
      .then((nextSessions) => setSessions(nextSessions.map((session) => ({ ...session, kind: 'chats' }))))
      .catch(() => undefined);
  }, [tab]);

  React.useEffect(() => { loadSessions(); }, [activeSessionId, loadSessions, refreshKey]);

  React.useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadSessions();
      }
    };
    const intervalId = window.setInterval(refreshIfVisible, 30_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSessions]);

  return {
    loadSessions,
    sessions,
    setSessions
  };
}
