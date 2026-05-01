import { spawn } from 'node:child_process';

export class TmuxError extends Error {
  constructor(message: string, readonly stderr = '') {
    super(message);
  }
}

export function formatTmuxError(error: unknown): string {
  if (!(error instanceof TmuxError)) {
    return error instanceof Error ? error.message : String(error);
  }

  const stderr = error.stderr.trim();
  if (stderr) {
    return stderr;
  }
  return error.message;
}

function targetPane(name: string): string {
  return `${name}:0.0`;
}

function runTmux(args: string[], options: { stdio?: 'pipe' | 'inherit' } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tmux', args, { stdio: options.stdio ?? 'pipe' });
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on('error', (error) => {
      if ('code' in error && error.code === 'ENOENT') {
        reject(new TmuxError('tmux is required for Phase 1 demo but was not found in PATH'));
        return;
      }
      reject(new TmuxError(error.message));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new TmuxError(`tmux exited with code ${code}`, stderr));
    });
  });
}

export function sessionName(id: string): string {
  return `tether_${id}`;
}

export async function createAgentSession(
  name: string,
  projectPath: string,
  command: string
): Promise<void> {
  await runTmux(['new-session', '-d', '-s', name, '-c', projectPath, command]);
}

export async function attachSession(name: string): Promise<void> {
  await runTmux(['attach', '-t', name], { stdio: 'inherit' });
}

export async function capturePane(name: string): Promise<string> {
  return runTmux(['capture-pane', '-t', targetPane(name), '-p', '-S', '-200']);
}

export async function sessionExists(name: string): Promise<boolean> {
  return runTmux(['has-session', '-t', name])
    .then(() => true)
    .catch(() => false);
}

export async function sendKeys(name: string, content: string): Promise<void> {
  await runTmux(['set-buffer', content]);
  await runTmux(['paste-buffer', '-t', targetPane(name), '-p']);
  await runTmux(['send-keys', '-t', targetPane(name), 'C-m']);
}

export async function showStatusMessage(name: string, message: string): Promise<void> {
  await runTmux(['set-option', '-t', name, 'status-right-length', '200']);
  await runTmux(['set-option', '-t', name, 'status-right', message]);
}

export async function assertTmuxAvailable(): Promise<void> {
  await runTmux(['-V']);
}
