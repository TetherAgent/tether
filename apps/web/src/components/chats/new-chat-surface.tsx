import * as React from 'react';
import { Menu, PanelLeftOpen } from 'lucide-react';
import { NotificationBell } from './notification-bell.js';

export function NewChatSurface({
  composer,
  connectionStatusChips,
  gatewayNamesById,
  onExpandSidebar,
  onOpenDrawer,
  t
}: {
  composer: React.ReactNode;
  connectionStatusChips: React.ReactNode;
  gatewayNamesById: Record<string, string>;
  onExpandSidebar?: () => void;
  onOpenDrawer?: () => void;
  t: {
    chatsCwdNote: string;
    chatsWelcomeGreeting: string;
  };
}) {
  return (
    <div className="chat-surface chat-new-session-surface relative flex h-full flex-col items-center justify-center bg-background px-6">
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}
      {onExpandSidebar && (
        <button
          onClick={onExpandSidebar}
          className="absolute left-3 top-3 hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
        >
          <PanelLeftOpen className="h-[15px] w-[15px]" />
        </button>
      )}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <div className="chat-header-connection-status">
          {connectionStatusChips}
        </div>
        <NotificationBell gatewayNamesById={gatewayNamesById} />
      </div>
      <div className="chat-new-session-hero mb-10 flex flex-col items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-black shadow-md"
          style={{ background: 'var(--gradient-brand)' }}
        >
          T
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          {t.chatsWelcomeGreeting}
        </h1>
      </div>

      <div className="chat-new-session-composer w-full max-w-[680px]">
        {composer}
        <div className="mt-3 flex items-center justify-center gap-1">
          <span className="text-[11px] text-muted-foreground/70">{t.chatsCwdNote}</span>
        </div>
      </div>
    </div>
  );
}
