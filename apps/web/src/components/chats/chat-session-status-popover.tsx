import * as React from 'react';
import { Settings } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@tether/design';
import type { UsageStats } from './chat-types.js';
import { compactPathLabel } from './chat-utils.js';

type ChatSessionStatusPopoverProps = {
  activeSessionProjectPath?: string;
  displayGatewayName?: string;
  displayModel?: string;
  displayModelOptions: string[];
  onModelChange: (model: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  t: {
    chatsCwdShort: string;
    chatsLabelModel: string;
    chatsSessionSettings: string;
  };
  usageStats?: UsageStats;
};

function formatResetCountdown(resetsAt: number): string {
  const diffMs = resetsAt * 1000 - Date.now();
  if (diffMs <= 0) return '刷新中';
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ProviderUsageRows({ usageStats }: { usageStats?: UsageStats }) {
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  const { contextPct, rateLimitResetsAt, rateLimitType, primary, secondary } = usageStats ?? {};

  React.useEffect(() => {
    const hasTimer = rateLimitResetsAt || primary?.resetsAt || secondary?.resetsAt;
    if (!hasTimer) return;
    const id = window.setInterval(() => forceUpdate(), 60000);
    return () => window.clearInterval(id);
  }, [rateLimitResetsAt, primary?.resetsAt, secondary?.resetsAt]);

  let usagePct: number | undefined;
  let usageResetsAt: number | undefined;
  let weeklyPct: number | undefined;
  let weeklyResetsAt: number | undefined;

  if (primary) {
    usagePct = primary.usedPercent;
    usageResetsAt = primary.resetsAt;
    if (secondary) {
      weeklyPct = secondary.usedPercent;
      weeklyResetsAt = secondary.resetsAt;
    }
  } else if (rateLimitResetsAt) {
    const windowMs = rateLimitType === 'five_hour' ? 5 * 60 * 60 * 1000 : undefined;
    if (windowMs) {
      const remainingMs = Math.max(0, rateLimitResetsAt * 1000 - Date.now());
      usagePct = Math.min(100, Math.round(((windowMs - remainingMs) / windowMs) * 100));
    }
    usageResetsAt = rateLimitResetsAt;
  }

  if (contextPct === undefined && usageResetsAt === undefined) return null;

  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {contextPct !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Context</span>
            <span className="font-mono text-[11px] tabular-nums">{contextPct}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${Math.min(100, contextPct)}%` }} />
          </div>
        </div>
      )}
      {usageResetsAt !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Usage</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">resets {formatResetCountdown(usageResetsAt)}</span>
          </div>
          {usagePct !== undefined && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>
      )}
      {weeklyResetsAt !== undefined && weeklyPct !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Weekly</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">resets {formatResetCountdown(weeklyResetsAt)}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${weeklyPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatSessionStatusPopover({
  activeSessionProjectPath,
  displayGatewayName,
  displayModel,
  displayModelOptions,
  onModelChange,
  onOpenChange,
  open,
  t,
  usageStats
}: ChatSessionStatusPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t.chatsSessionSettings}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground/55 transition-colors hover:text-muted-foreground"
        >
          {displayGatewayName && (
            <>
              <span className="max-w-[80px] truncate font-medium text-brand">{displayGatewayName}</span>
              <span className="opacity-40">·</span>
            </>
          )}
          {displayModel && <span className="font-medium">{displayModel}</span>}
          {activeSessionProjectPath && (
            <>
              <span className="hidden opacity-40 md:inline">·</span>
              <span className="hidden max-w-[200px] truncate font-mono md:inline">{compactPathLabel(activeSessionProjectPath)}</span>
            </>
          )}
          {usageStats?.contextPct !== undefined && (
            <>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">ctx {usageStats.contextPct}%</span>
            </>
          )}
          <Settings className="ml-1 h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-3">
        <div className="flex flex-col gap-2.5">
          {displayModelOptions.length > 0 && displayModel && (
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[12px] text-muted-foreground">{t.chatsLabelModel}</span>
              <Select value={displayModel} onValueChange={onModelChange}>
                <SelectTrigger className="h-7 flex-1 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {displayModelOptions.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {activeSessionProjectPath && (
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[12px] text-muted-foreground">{t.chatsCwdShort}</span>
              <span
                title={activeSessionProjectPath}
                className="flex h-7 min-w-0 flex-1 items-center rounded-lg bg-muted px-3 font-mono text-[12px] font-medium text-muted-foreground"
              >
                <span className="truncate">{compactPathLabel(activeSessionProjectPath)}</span>
              </span>
            </div>
          )}
          <ProviderUsageRows usageStats={usageStats} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
