import * as React from 'react';

import { type SlashCommand, getFilteredCommands, recordUsage } from './slash-commands.js';

type Options = {
  inputText: string;
  onSelect: (name: string) => void;
};

type UseSlashMenuResult = {
  open: boolean;
  query: string;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  filteredCommands: SlashCommand[];
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  handleSelect: (name: string) => void;
};

export function useSlashMenu({ inputText, onSelect }: Options): UseSlashMenuResult {
  const isSlashMode = inputText.startsWith('/') && !inputText.includes(' ');
  const query = isSlashMode ? inputText.slice(1) : '';

  const [dismissed, setDismissed] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Re-enable menu when user leaves slash mode (typed space / cleared text)
  React.useEffect(() => {
    if (!isSlashMode) setDismissed(false);
  }, [isSlashMode]);

  // Reset selection on query change
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const open = isSlashMode && !dismissed;

  const filteredCommands = React.useMemo(
    () => (open ? getFilteredCommands(query) : []),
    [open, query]
  );

  const handleSelect = React.useCallback((name: string) => {
    recordUsage(name);
    onSelect(name);
  }, [onSelect]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filteredCommands.length - 1, 0)));
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return true;
    }
    if (event.key === 'Enter') {
      const cmd = filteredCommands[activeIndex];
      if (cmd) {
        event.preventDefault();
        handleSelect(cmd.name);
        return true;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  }, [open, filteredCommands, activeIndex, handleSelect]);

  return { open, query, activeIndex, setActiveIndex, filteredCommands, handleKeyDown, handleSelect };
}
