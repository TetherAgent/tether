import * as React from 'react';
import { TerminalSquare } from 'lucide-react';
import { TerminalCommandShortcuts, type TerminalProviderId } from './terminal-command-shortcuts.js';
import { TerminalLaunchComposer } from './terminal-launch-composer.js';

export function TerminalLaunchPage({
  onCreateStarted,
  onCreated
}: {
  onCreateStarted?: () => void;
  onCreated: (sessionId: string) => void;
}) {
  const [provider, setProvider] = React.useState<TerminalProviderId>('shell');

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <section className="flex w-full max-w-2xl flex-col items-center text-center">
          <div
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-black shadow-sm"
            style={{ background: 'var(--gradient-brand)' }}
          >
            <TerminalSquare className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">你好，我是 Tether</h1>
          <div className="mt-8 w-full">
            <TerminalLaunchComposer
              provider={provider}
              onCreateStarted={onCreateStarted}
              onProviderChange={setProvider}
              onCreated={onCreated}
            />
            <p className="mt-5 text-left text-xs font-semibold text-muted-foreground">快捷命令</p>
            <TerminalCommandShortcuts onSelectProvider={setProvider} />
          </div>
        </section>
      </div>
    </div>
  );
}
