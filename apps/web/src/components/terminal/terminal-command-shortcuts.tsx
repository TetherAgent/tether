import { Button } from '@tether/design';

export type TerminalProviderId = 'shell' | 'claude' | 'codex';

const SHORTCUTS: Array<{
  command: string;
  label: string;
  provider: TerminalProviderId;
}> = [
  {
    command: 'tether run shell --title "Terminal"',
    label: '命名 Shell',
    provider: 'shell'
  },
  {
    command: 'tether run claude',
    label: 'Claude 会话',
    provider: 'claude'
  },
  {
    command: 'tether run codex',
    label: 'Codex 会话',
    provider: 'codex'
  }
];

export function TerminalCommandShortcuts({
  onSelectProvider
}: {
  onSelectProvider: (provider: TerminalProviderId) => void;
}) {
  return (
    <div className="mt-4 flex w-full flex-wrap gap-2">
      {SHORTCUTS.map((item) => (
        <Button
          key={item.provider}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onSelectProvider(item.provider)}
          className="terminal-command-preset h-auto min-w-0 justify-start rounded-full px-3 py-2"
          title={item.command}
        >
          <span className="shrink-0 text-xs font-semibold">{item.label}</span>
          <code className="ml-2 min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {item.command}
          </code>
        </Button>
      ))}
    </div>
  );
}
