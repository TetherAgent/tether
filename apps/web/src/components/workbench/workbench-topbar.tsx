import * as React from 'react';
import { HelpCircle, Menu, PanelLeftOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { NotificationBell } from '../chats/notification-bell.js';
import { useRelayClient } from '../relay/use-relay-client.js';

type WorkbenchTopbarProps = {
  children?: React.ReactNode;
  className?: string;
  gatewayNamesById?: Record<string, string>;
  help?: {
    active?: boolean;
    hint?: string;
    label: string;
    onClick?: () => void;
  };
  onExpandSidebar?: () => void;
  onOpenDrawer?: () => void;
  position?: 'static' | 'absolute';
};

export function WorkbenchTopbar({
  children,
  className = '',
  gatewayNamesById,
  help,
  onExpandSidebar,
  onOpenDrawer,
  position = 'static'
}: WorkbenchTopbarProps) {
  const relay = useRelayClient();
  const resolvedGatewayNamesById = gatewayNamesById ?? relay.gatewayNamesById;
  const positionClass = position === 'absolute'
    ? 'absolute inset-x-0 top-0 z-10'
    : 'shrink-0';

  return (
    <div className={`${positionClass} flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur-sm ${className}`}>
      {onOpenDrawer && (
        <button
          onClick={onOpenDrawer}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}
      {onExpandSidebar && (
        <button
          onClick={onExpandSidebar}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
        >
          <PanelLeftOpen className="h-[15px] w-[15px]" />
        </button>
      )}
      <div className="min-w-0 flex-1" />
      {children}
      {help ? (
        <div className="relative">
          {help.active && help.hint ? (
            <div className="chat-help-hint absolute right-0 top-9 hidden whitespace-nowrap rounded-full border border-brand/25 bg-card px-3 py-1.5 text-[12px] font-medium text-foreground shadow-card md:block">
              {help.hint}
            </div>
          ) : null}
          <Link
            to="/help"
            onClick={help.onClick}
            title={help.label}
            aria-label={help.label}
            className={`chat-help-button flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground ${
              help.active ? 'chat-help-button--pulse' : ''
            }`}
          >
            <HelpCircle className="h-[15px] w-[15px]" />
          </Link>
        </div>
      ) : null}
      <NotificationBell gatewayNamesById={resolvedGatewayNamesById} />
    </div>
  );
}
