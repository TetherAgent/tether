import * as React from 'react';
import { createHttpClient } from '@tether/http';
import { getStoredNormalAccessToken } from '../../lib/api.js';
import { fetchChatSessions } from '../../components/chats/data/chat-data.js';
import type { WorkbenchSessionRecord, WorkbenchSidebarTab } from '../../components/workbench/types.js';

async function fetchTerminalSessions(token?: string): Promise<WorkbenchSessionRecord[]> {
  const http = createHttpClient();
  const data = await http.get<{ sessions: WorkbenchSessionRecord[] }>(
    '/api/server/sessions?transport=pty-event-stream&limit=30',
    undefined,
    {
      token,
      suppressGlobalError: true
    }
  );
  return (data.sessions ?? []).filter((session) => session.transport === 'pty-event-stream');
}

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
  const [sessionsByTab, setSessionsByTab] = React.useState<Record<WorkbenchSidebarTab, WorkbenchSessionRecord[]>>({
    chats: [],
    terminal: []
  });
  const [loadedByTab, setLoadedByTab] = React.useState<Record<WorkbenchSidebarTab, boolean>>({
    chats: false,
    terminal: false
  });
  const [loadingByTab, setLoadingByTab] = React.useState<Record<WorkbenchSidebarTab, boolean>>({
    chats: false,
    terminal: false
  });
  const didHandleRelayRefreshRef = React.useRef(false);

  const setCurrentSessions = React.useCallback((
    next: WorkbenchSessionRecord[] | ((prev: WorkbenchSessionRecord[]) => WorkbenchSessionRecord[])
  ) => {
    setSessionsByTab((current) => {
      const currentSessions = current[tab];
      const nextSessions = typeof next === 'function' ? next(currentSessions) : next;
      return { ...current, [tab]: nextSessions };
    });
  }, [tab]);

  const loadSessions = React.useCallback(() => {
    const token = getStoredNormalAccessToken();
    setLoadingByTab((current) => ({ ...current, [tab]: true }));
    if (tab === 'terminal') {
      void fetchTerminalSessions(token)
        .then((nextSessions) => {
          setSessionsByTab((current) => ({
            ...current,
            terminal: nextSessions.map((session) => ({ ...session, kind: 'terminal' }))
          }));
          setLoadedByTab((current) => ({ ...current, terminal: true }));
        })
        .catch(() => undefined)
        .finally(() => setLoadingByTab((current) => ({ ...current, terminal: false })));
      return;
    }
    void fetchChatSessions(token, false)
      .then((nextSessions) => {
        setSessionsByTab((current) => ({
          ...current,
          chats: nextSessions.map((session) => ({ ...session, kind: 'chats' }))
        }));
        setLoadedByTab((current) => ({ ...current, chats: true }));
      })
      .catch(() => undefined)
      .finally(() => setLoadingByTab((current) => ({ ...current, chats: false })));
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
    loaded: loadedByTab[tab],
    loading: loadingByTab[tab],
    sessions: sessionsByTab[tab],
    setSessions: setCurrentSessions
  };
}
