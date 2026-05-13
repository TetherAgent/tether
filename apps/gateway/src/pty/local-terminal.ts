import { execFile } from 'node:child_process';

export type LocalTerminalProvider = 'shell' | 'claude' | 'codex';

export function openLocalTerminalForProvider({
  cwd,
  provider
}: {
  cwd: string;
  provider: LocalTerminalProvider;
}): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('local_terminal_unsupported'));
  }

  const shellCommand = `cd ${shellQuote(cwd)} && tether run ${provider}`;
  const script = [
    'on run argv',
    '  set shellText to item 1 of argv',
    '  tell application "Terminal"',
    '    activate',
    '    do script shellText',
    '  end tell',
    'end run'
  ].join('\n');

  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, shellCommand], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
