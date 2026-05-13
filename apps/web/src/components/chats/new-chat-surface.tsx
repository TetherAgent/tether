import * as React from 'react';
import { WorkbenchTopbar } from '../workbench/workbench-topbar.js';

const HELP_HINT_STORAGE_KEY = 'tether:helpHintSeen';

export function NewChatSurface({
  composer,
  connectionStatusChips,
  connectionReady,
  gatewayNamesById,
  onExpandSidebar,
  onOpenDrawer,
  t
}: {
  composer: React.ReactNode;
  connectionStatusChips: React.ReactNode;
  connectionReady: boolean;
  gatewayNamesById: Record<string, string>;
  onExpandSidebar?: () => void;
  onOpenDrawer?: () => void;
  t: {
    chatsCwdNote: string;
    chatsWelcomeGreeting: string;
    helpHintText: string;
    helpNavLabel: string;
  };
}) {
  const [showHelpHint, setShowHelpHint] = React.useState(false);

  React.useEffect(() => {
    if (!connectionReady) {
      setShowHelpHint(false);
      return undefined;
    }
    if (window.localStorage.getItem(HELP_HINT_STORAGE_KEY) === '1') {
      return undefined;
    }
    setShowHelpHint(true);
    const timer = window.setTimeout(() => {
      setShowHelpHint(false);
      window.localStorage.setItem(HELP_HINT_STORAGE_KEY, '1');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [connectionReady]);

  const dismissHelpHint = () => {
    window.localStorage.setItem(HELP_HINT_STORAGE_KEY, '1');
    setShowHelpHint(false);
  };

  return (
    <div className="chat-surface chat-new-session-surface relative flex h-full flex-col items-center justify-center bg-background px-6">
      <WorkbenchTopbar
        gatewayNamesById={gatewayNamesById}
        help={{
          active: showHelpHint,
          hint: t.helpHintText,
          label: t.helpNavLabel,
          onClick: dismissHelpHint
        }}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
        position="absolute"
      >
        <div className="chat-header-connection-status">
          {connectionStatusChips}
        </div>
      </WorkbenchTopbar>
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
