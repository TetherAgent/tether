import * as React from 'react';
import { Menu } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetTrigger } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';
import { ChatPanel } from './chat-panel.js';
import { ChatSessionList } from './chat-session-list.js';

export function ChatsLayout({ activeSessionId }: { activeSessionId?: string }) {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const sidebar = (
    <div className="h-full w-[260px] border-r border-sidebar-border">
      <ChatSessionList activeSessionId={activeSessionId} onSelect={() => setDrawerOpen(false)} />
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      <div className="hidden md:flex">{sidebar}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center border-b border-border px-3 py-2 md:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger render={<Button size="icon-sm" variant="ghost" />}>
              <Menu className="h-4 w-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] max-w-none p-0" showCloseButton={false}>
              <div className="flex h-full">{sidebar}</div>
            </SheetContent>
          </Sheet>
          <div className="ml-3 text-sm font-semibold">{t.chatsNavLabel}</div>
        </div>
        <ChatPanel activeSessionId={activeSessionId} />
      </div>
    </div>
  );
}
