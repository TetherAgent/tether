import * as React from 'react';
import { Menu } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { ChatPanel } from './chat-panel.js';
import { ChatSessionList } from './chat-session-list.js';

export function ChatsLayout({ activeSessionId }: { activeSessionId?: string }) {
  const { t } = useI18n();
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
        {/* Mobile top bar */}
        <div className="flex items-center border-b border-border px-3 py-2 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="ml-3 text-sm font-semibold">{t.chatsNavLabel}</div>
        </div>
        <ChatPanel
          activeSessionId={activeSessionId}
          onExpandSidebar={!sidebarOpen ? () => setSidebarOpen(true) : undefined}
        />
      </div>
    </div>
  );
}
