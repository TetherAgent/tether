import * as React from 'react';
import { Link } from 'react-router-dom';
import { Menu, MessageSquare, Plus, Settings } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetTrigger } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';
import { ChatPanel } from './chat-panel.js';
import { ChatSessionList } from './chat-session-list.js';

export function ChatsLayout({ activeSessionId }: { activeSessionId?: string }) {
  const { t, locale } = useI18n();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const sidebars = (
    <>
      <div className="flex h-full w-14 flex-col items-center justify-between border-r border-sidebar-border bg-sidebar py-3">
        <div className="flex flex-col items-center gap-2">
          <Button asChild size="icon-sm" variant="ghost">
            <Link to="/chats" aria-label={t.chatsNavLabel}>
              <MessageSquare className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="icon-sm" variant="ghost">
            <Link to="/chats" aria-label={t.chatsNewSession}>
              <Plus className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={t.chatsSettingsAppearance}>
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      <div className="h-full w-[280px] border-r border-sidebar-border">
        <ChatSessionList activeSessionId={activeSessionId} onSelect={() => setDrawerOpen(false)} />
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-background">
      <div className="hidden md:flex">{sidebars}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 md:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger render={<Button size="icon-sm" variant="ghost" />}>
              <Menu className="h-4 w-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[336px] max-w-none p-0" showCloseButton={false}>
              <div className="flex h-full">{sidebars}</div>
            </SheetContent>
          </Sheet>
          <div className="text-sm font-semibold">{t.chatsNavLabel}</div>
          <div className="text-xs text-muted-foreground">{locale.toUpperCase()}</div>
        </div>
        <ChatPanel activeSessionId={activeSessionId} />
      </div>
    </div>
  );
}
