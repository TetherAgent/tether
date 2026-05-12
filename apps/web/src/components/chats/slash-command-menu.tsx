import * as React from 'react';

import { useI18n } from '../../hooks/use-i18n.js';
import { type SlashCommand } from './slash-commands.js';

type Props = {
  open: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (name: string) => void;
  onActiveIndexChange: (i: number) => void;
};

export function SlashCommandMenu({ open, commands, activeIndex, onSelect, onActiveIndexChange }: Props) {
  const { t } = useI18n();
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
      {commands.length === 0 ? (
        <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
          {t.slashMenuEmpty}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto py-1">
          {commands.map((cmd, i) => (
            <button
              key={cmd.name}
              ref={i === activeIndex ? activeRef : undefined}
              type="button"
              className={`flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors ${
                i === activeIndex ? 'bg-accent' : 'hover:bg-accent'
              }`}
              onClick={() => onSelect(cmd.name)}
              onMouseEnter={() => onActiveIndexChange(i)}
            >
              <span className="shrink-0 font-mono text-[13px] font-medium text-brand">/{cmd.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
