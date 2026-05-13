import * as React from 'react';
import { Folder, Loader2 } from 'lucide-react';
import { Input, Popover, PopoverContent, PopoverTrigger } from '@tether/design';

function compactPathLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '~') {
    return '~';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/Users/') && parts.length >= 2) {
    const relativeParts = parts.slice(2);
    if (relativeParts.length === 0) {
      return '~';
    }
    if (relativeParts.length <= 2) {
      return `~/${relativeParts.join('/')}`;
    }
    return `~/.../${relativeParts.slice(-2).join('/')}`;
  }
  if (parts.length <= 3) {
    return normalized;
  }
  return `.../${parts.slice(-2).join('/')}`;
}

function fullPathLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '~') {
    return '~';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/Users/') && parts.length >= 2) {
    const relativeParts = parts.slice(2);
    return relativeParts.length > 0 ? `~/${relativeParts.join('/')}` : '~';
  }
  return normalized;
}

export function PathPicker({
  activeIndex,
  emptyLabel,
  inputPlaceholder,
  loading,
  loadingLabel,
  onActiveIndexChange,
  onOpenChange,
  onValueChange,
  open,
  selectLabel,
  suggestions,
  triggerLabel,
  value
}: {
  activeIndex: number;
  emptyLabel: string;
  inputPlaceholder: string;
  loading: boolean;
  loadingLabel: string;
  onActiveIndexChange: (index: number | ((current: number) => number)) => void;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  open: boolean;
  selectLabel: string;
  suggestions: string[];
  triggerLabel: string;
  value: string;
}) {
  const applySuggestion = (suggestion: string, close: boolean) => {
    onValueChange(suggestion);
    if (close) {
      onOpenChange(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value}
          className="chat-cwd-trigger flex h-7 max-w-[260px] min-w-[132px] items-center rounded-full bg-muted px-3 font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Folder className="chat-cwd-icon" />
          <span className="chat-cwd-label">{triggerLabel}</span>
          <span className="chat-cwd-value truncate">{value ? compactPathLabel(value) : selectLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="chat-cwd-popover w-[520px] gap-2 p-2">
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onActiveIndexChange((index) => Math.min(index + 1, Math.max(suggestions.length - 1, 0)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onActiveIndexChange((index) => Math.max(index - 1, 0));
              return;
            }
            if (event.key === 'Enter') {
              const suggestion = suggestions[activeIndex];
              if (suggestion) {
                event.preventDefault();
                applySuggestion(suggestion, true);
              }
              return;
            }
            if (event.key === 'Tab') {
              const suggestion = suggestions[activeIndex];
              if (suggestion) {
                event.preventDefault();
                applySuggestion(suggestion, false);
              }
              return;
            }
            if (event.key === 'Escape') {
              onOpenChange(false);
            }
          }}
          autoFocus
          placeholder={inputPlaceholder}
          className="h-9 rounded-lg bg-muted font-mono text-[12px]"
        />
        <div className="h-64 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 px-3 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {loadingLabel}
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => applySuggestion(suggestion, true)}
                onMouseEnter={() => onActiveIndexChange(index)}
                className={`block w-full truncate rounded-lg px-3 py-2 text-left font-mono text-[12px] text-popover-foreground ${
                  index === activeIndex ? 'bg-accent' : ''
                }`}
                title={suggestion}
              >
                {fullPathLabel(suggestion)}
              </button>
            ))
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[12px] text-muted-foreground">
              {emptyLabel}
            </div>
          )}
        </div>
        <div className="hidden items-center justify-end gap-2 border-t border-border/60 px-3 pt-2 text-[10px] font-medium text-muted-foreground md:flex">
          <span className="text-brand">↑↓</span>
          <span>选择</span>
          <span className="text-brand">Tab</span>
          <span>补全</span>
          <span className="text-brand">Enter</span>
          <span>确认</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
