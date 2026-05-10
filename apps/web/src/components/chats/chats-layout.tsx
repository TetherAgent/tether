import * as React from 'react';
import { ChatPanel } from './chat-panel.js';
import { ChatSessionList } from './chat-session-list.js';

export function ChatsLayout({ activeSessionId }: { activeSessionId?: string }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);

  const sidebarContent = (
    <ChatSessionList
      activeSessionId={activeSessionId}
      onSelect={() => setDrawerOpen(false)}
      onToggleSidebar={() => setSidebarOpen(false)}
    />
  );

  return (
    <div className="flex h-screen bg-background">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatPanel
          activeSessionId={activeSessionId}
          onExpandSidebar={!sidebarOpen ? () => setSidebarOpen(true) : undefined}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
      </div>
    </div>
  );
}
