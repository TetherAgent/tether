import { TerminalSquare } from 'lucide-react';

const TERMINAL_COMMANDS = [
  {
    label: '默认 Shell',
    description: '在当前目录启动一个可接回的 shell session。',
    command: 'tether run shell'
  },
  {
    label: '命名 Shell',
    description: '给左侧列表里的 terminal session 一个清楚的名字。',
    command: 'tether run shell --title "Terminal"'
  },
  {
    label: 'Claude 会话',
    description: '启动 Claude provider session，并在 Web 里接回输出。',
    command: 'tether run claude'
  },
  {
    label: 'Codex 会话',
    description: '启动 Codex provider session，并在 Web 里接回输出。',
    command: 'tether run codex'
  }
];
const PRIMARY_COMMAND = TERMINAL_COMMANDS[0]!;
const SECONDARY_COMMANDS = TERMINAL_COMMANDS.slice(1);

export function TerminalSessionPicker({
  onSelect: _onSelect
}: {
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <section className="flex w-full max-w-2xl flex-col items-center text-center">
          <div
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-black shadow-sm"
            style={{ background: 'var(--gradient-brand)' }}
          >
            <TerminalSquare className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Terminal</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            从左侧选择一个 terminal session，接回本机 Gateway 托管的 PTY。
          </p>
          <div className="mt-8 w-full rounded-3xl bg-card/45 p-5 text-left shadow-sm">
            <div className="rounded-2xl bg-muted/55 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recommended</p>
              <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-lg font-semibold tracking-tight text-foreground">{PRIMARY_COMMAND.label}</p>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{PRIMARY_COMMAND.description}</p>
                </div>
                <code className="block min-w-0 overflow-x-auto rounded-xl bg-background px-4 py-3 font-mono text-sm font-semibold text-foreground shadow-sm">
                  {PRIMARY_COMMAND.command}
                </code>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {SECONDARY_COMMANDS.map((item) => (
                <div key={item.command} className="rounded-2xl bg-background/65 p-4">
                  <p className="text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 min-h-[40px] text-xs leading-5 text-muted-foreground">{item.description}</p>
                  <code className="mt-3 block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-[11px] text-foreground">
                    {item.command}
                  </code>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
