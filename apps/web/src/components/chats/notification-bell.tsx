import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@tether/design';
import { useI18n } from '../../hooks/use-i18n.js';
import { useUpdateCheck } from '../../hooks/use-update-check.js';

type NotificationBellProps = {
  gatewayNamesById?: Record<string, string>;
};

const EMPTY_GATEWAY_NAMES: Record<string, string> = {};

export function NotificationBell({ gatewayNamesById = EMPTY_GATEWAY_NAMES }: NotificationBellProps) {
  const { t } = useI18n();
  const { hasUpdate, outdatedGateways, latestVersion, dismiss } = useUpdateCheck(gatewayNamesById);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
          <Bell className="h-[15px] w-[15px]" />
          {hasUpdate && (
            <span className="absolute right-1 top-1 flex h-2 w-2 animate-bounce items-center justify-center rounded-full bg-red-500" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" side="bottom" align="end">
        <div className="border-b border-border px-4 py-3">
          <p className="text-[13px] font-semibold text-foreground">{t.notificationsTitle}</p>
        </div>
        {hasUpdate ? (
          <div className="px-4 py-3">
            <p className="mb-1 text-[13px] font-medium text-foreground">{t.updateAvailableTitle}</p>
            <div className="mb-2 space-y-1 text-xs text-muted-foreground">
              {outdatedGateways.map((gateway) => (
                <p key={gateway.gatewayId}>
                  {t.updateAvailableGatewayBody
                    .replace('{gateway}', gateway.name)
                    .replace('{current}', gateway.currentVersion)
                    .replace('{latest}', latestVersion ?? '')}
                </p>
              ))}
            </div>
            <code className="mb-3 block rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
              npm i -g @tether-labs/cli@latest
            </code>
            <button
              onClick={dismiss}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t.updateDismiss}
            </button>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t.notificationsEmpty}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
