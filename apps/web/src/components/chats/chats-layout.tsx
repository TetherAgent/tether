import * as React from 'react';
import { ChatPanel } from './chat-panel.js';
import { AppSidebar } from './app-sidebar.js';

export function ChatsLayout({ activeSessionId }: { activeSessionId?: string }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [sessionRefreshKey, setSessionRefreshKey] = React.useState(0);
  const refreshSessions = React.useCallback(() => {
    setSessionRefreshKey((key) => key + 1);
  }, []);

  const sidebarContent = (
    <AppSidebar
      activeSessionId={activeSessionId}
      refreshKey={sessionRefreshKey}
      onSelect={() => setDrawerOpen(false)}
      onToggleSidebar={() => setSidebarOpen(false)}
    />
  );

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      {sidebarOpen && (
        <div className="hidden h-full w-[260px] shrink-0 border-r border-sidebar-border md:flex md:flex-col">
          {sidebarContent}
        </div>
      )}

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="absolute inset-y-0 left-0 w-[260px] bg-sidebar"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      <div className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        <ChatPanel
          activeSessionId={activeSessionId}
          onExpandSidebar={!sidebarOpen ? () => setSidebarOpen(true) : undefined}
          onOpenDrawer={() => setDrawerOpen(true)}
          onReconnectCatchup={refreshSessions}
        />
      </div>
    </div>
  );
}
