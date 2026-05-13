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
  SelectValue,
  Textarea
} from '@tether/design';
import type { UsageStats } from './chat-types.js';
import { compactPathLabel } from './chat-utils.js';

export function ChatComposer({
  activeSessionProjectPath,
  buildInputPlaceholder,
  displayGatewayName,
  displayModel,
  displayModelOptions,
  displayProvider,
  inputRef,
  inputText,
  isInputDisabled,
  onCompositionEnd,
  onCompositionStart,
  onInputChange,
  onKeyDown,
  sendButton,
  sessionSettingsOpen,
  setActiveSessionModel,
  setSessionSettingsOpen,
  slashMenuEl,
  t,
  usageStats,
  usageStatsRows
}: {
  activeSessionProjectPath?: string;
  buildInputPlaceholder: (provider: string, model: string, gatewayName?: string) => string;
  displayGatewayName?: string;
  displayModel?: string;
  displayModelOptions: string[];
  displayProvider: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  inputText: string;
  isInputDisabled: boolean;
  onCompositionEnd: () => void;
  onCompositionStart: () => void;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  sendButton: React.ReactNode;
  sessionSettingsOpen: boolean;
  setActiveSessionModel: (model: string) => void;
  setSessionSettingsOpen: (open: boolean) => void;
  slashMenuEl: React.ReactNode;
  t: {
    chatsCwdShort: string;
    chatsLabelModel: string;
    chatsSessionSettings: string;
  };
  usageStats?: UsageStats;
  usageStatsRows: React.ReactNode;
}) {
  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto max-w-3xl flex flex-col gap-1.5">
        <div className="flex items-center gap-2 self-start min-w-0">
          <Popover open={sessionSettingsOpen} onOpenChange={setSessionSettingsOpen}>
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
                    <Select value={displayModel} onValueChange={setActiveSessionModel}>
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
                {usageStatsRows}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="relative">
          {slashMenuEl}
          <div className="chat-input-card relative overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
            <div className="flex items-end gap-2 px-3 py-2.5">
              <Textarea
                ref={inputRef}
                value={inputText}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={buildInputPlaceholder(displayProvider, displayModel ?? '')}
                disabled={isInputDisabled}
                className="flex-1 max-h-44 min-h-[36px] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
                onKeyDown={onKeyDown}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
              />
              {sendButton}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
