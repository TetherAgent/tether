import * as React from 'react';
import { gatewayAuthHeaders, getStoredNormalAccessToken, readGatewayData } from '../../lib/api.js';
import { fetchChatSessions } from '../../components/chats/chat-data.js';
import type { WorkbenchSessionRecord, WorkbenchSidebarTab } from '../../components/workbench/types.js';

export function useWorkbenchSessions({
  activeSessionId,
  refreshKey,
  relayRefreshKey,
  tab
}: {
  activeSessionId?: string;
  refreshKey: number;
  relayRefreshKey?: number;
  tab: WorkbenchSidebarTab;
}) {
  const [sessions, setSessions] = React.useState<WorkbenchSessionRecord[]>([]);
  const didHandleRelayRefreshRef = React.useRef(false);

  const loadSessions = React.useCallback(() => {
    const token = getStoredNormalAccessToken();
    if (tab === 'terminal') {
      void fetch('/api/server/sessions?transport=pty-event-stream&limit=30', { headers: gatewayAuthHeaders(token) })
        .then((response) => response.ok ? readGatewayData<{ sessions: WorkbenchSessionRecord[] }>(response) : { sessions: [] })
        .then((data) => setSessions((data.sessions ?? [])
          .filter((session) => session.transport === 'pty-event-stream')
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSessions]);

  React.useEffect(() => {
    if (tab !== 'terminal' || relayRefreshKey === undefined) {
      didHandleRelayRefreshRef.current = false;
      return undefined;
    }
    if (!didHandleRelayRefreshRef.current) {
      didHandleRelayRefreshRef.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadSessions();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loadSessions, relayRefreshKey, tab]);

  return {
    loadSessions,
    sessions,
    setSessions
  };
}
