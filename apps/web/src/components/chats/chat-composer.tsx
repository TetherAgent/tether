import * as React from 'react';
import {
  Textarea
} from '@tether/design';
import type { UsageStats } from './chat-types.js';
import { ChatSessionStatusPopover } from './chat-session-status-popover.js';

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
  usageStats
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
}) {
  return (
    <div className="chat-composer-shell px-4 pb-4 pt-2">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5 2xl:max-w-6xl">
        <div className="flex items-center gap-2 self-start min-w-0">
          <ChatSessionStatusPopover
            activeSessionProjectPath={activeSessionProjectPath}
            displayGatewayName={displayGatewayName}
            displayModel={displayModel}
            displayModelOptions={displayModelOptions}
            onModelChange={setActiveSessionModel}
            onOpenChange={setSessionSettingsOpen}
            open={sessionSettingsOpen}
            t={t}
            usageStats={usageStats}
          />
        </div>

        <div className="relative">
          {slashMenuEl}
          <div className="chat-input-card relative overflow-hidden rounded-2xl border border-border" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
            <div className="flex items-end gap-2 px-3 py-2.5">
              <Textarea
                ref={inputRef}
                value={inputText}
                onChange={(event) => onInputChange(event.target.value)}
                placeholder={buildInputPlaceholder(displayProvider, displayModel ?? '')}
                disabled={isInputDisabled}
                className="flex-1 max-h-44 min-h-[36px] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed shadow-none focus-visible:bg-transparent focus-visible:ring-0 dark:bg-transparent dark:focus-visible:bg-transparent"
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
