import * as React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../hooks/use-auth.js';
import { RelayClientProvider } from '../relay/relay-client-provider.js';
import { WorkbenchSidebar } from './workbench-sidebar.js';

const RELAY_URL_KEY = 'tether:relayUrl';
const DEFAULT_RELAY_URL = import.meta.env.VITE_TETHER_RELAY_URL ?? 'wss://tether.earntools.me';

function activeSessionIdFromPath(pathname: string): string | undefined {
  const match = /^\/(?:chats|terminal)\/([^/]+)$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function WorkbenchLayout() {
  const { normalAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [sessionRefreshKey, setSessionRefreshKey] = React.useState(0);
  const relayUrl = React.useMemo(
    () => window.localStorage.getItem(RELAY_URL_KEY) ?? DEFAULT_RELAY_URL,
    []
  );
  const activeSessionId = activeSessionIdFromPath(location.pathname);
  const refreshSessions = React.useCallback(() => {
    setSessionRefreshKey((key) => key + 1);
  }, []);

  const sidebarContent = (
    <WorkbenchSidebar
      activeSessionId={activeSessionId}
      refreshKey={sessionRefreshKey}
      onSelect={() => setDrawerOpen(false)}
      onToggleSidebar={() => setSidebarOpen(false)}
    />
  );

  const outletContext = React.useMemo(() => ({
    onExpandSidebar: !sidebarOpen ? () => setSidebarOpen(true) : undefined,
    onOpenDrawer: () => setDrawerOpen(true),
    onReconnectCatchup: refreshSessions,
    relayUrl
  }), [refreshSessions, relayUrl, sidebarOpen]);

  React.useEffect(() => {
    if (location.pathname === '/chats' && location.search) {
      const params = new URLSearchParams(location.search);
      if (params.get('tab') === 'terminal') {
        const terminalId = params.get('terminalId');
        navigate(terminalId ? `/terminal/${encodeURIComponent(terminalId)}` : '/terminal', { replace: true });
      }
    }
  }, [location.pathname, location.search, navigate]);

  return (
    <RelayClientProvider accessToken={normalAuth?.accessToken} relayUrl={relayUrl}>
      <div className="flex h-screen w-full max-w-full overflow-hidden bg-background">
        {sidebarOpen && (
          <div className="hidden h-full w-[260px] shrink-0 border-r border-sidebar-border md:flex md:flex-col">
            {sidebarContent}
          </div>
        )}

        {drawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="absolute inset-y-0 left-0 w-[260px] bg-sidebar"
              onClick={(event) => event.stopPropagation()}
            >
              {sidebarContent}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet context={outletContext} />
        </div>
      </div>
    </RelayClientProvider>
  );
}

export type WorkbenchOutletContext = {
  onExpandSidebar?: () => void;
  onOpenDrawer: () => void;
  onReconnectCatchup: () => void;
  relayUrl: string;
};
