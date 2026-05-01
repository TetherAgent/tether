import path from 'node:path';
import { Command } from 'commander';
import {
  assertTmuxAvailable,
  attachSession,
  createAgentSession,
  formatTmuxError,
  localLanAddress,
  sendKeys,
  sessionExists,
  sessionName,
  startDaemon,
  Store,
  showStatusMessage,
} from '@tether/gateway';
import { createSessionId } from '@tether/gateway';
import type { ProviderName } from '@tether/core';

const program = new Command();

program
  .name('tether')
  .description('Agent console for sharing one CLI agent session across devices')
  .version('0.1.0');

type Provider = {
  name: ProviderName;
  command: string;
};

const providers = {
  codex: { name: 'codex', command: 'codex' },
  claude: { name: 'claude', command: 'claude' }
} satisfies Record<ProviderName, Provider>;

type StartOptions = {
  host: string;
  port: number;
  project: string;
  attach: boolean;
};

function addProviderCommand(provider: Provider): void {
  program
    .command(provider.name)
    .description(`start a tether-managed ${provider.name} session`)
    .option('--host <host>', 'daemon host to bind', '127.0.0.1')
    .option('--port <port>', 'daemon port', parsePort, 4789)
    .option('--project <path>', 'project directory', process.cwd())
    .option('--no-attach', 'start session without attaching this terminal')
    .action((options: StartOptions) => startProviderSession(provider, options));
}

for (const provider of Object.values(providers)) {
  addProviderCommand(provider);
}

async function startProviderSession(provider: Provider, options: StartOptions): Promise<void> {
  await assertTmuxAvailable();

  const projectPath = path.resolve(options.project);
  const store = new Store();
  const id = createSessionId();
  const name = sessionName(id);
  const now = Date.now();

  await createAgentSession(name, projectPath, provider.command);
  store.insertSession({
    id,
    provider: provider.name,
    title: path.basename(projectPath),
    projectPath,
    status: 'running',
    tmuxSessionName: name,
    command: provider.command,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  });

  const daemon = await startDaemon({ host: options.host, port: options.port, store });
  const remoteUrl = `${daemon.url}/remote/session/${id}`;
  console.log(`Tether session: ${id}`);
  console.log(`Remote URL: ${remoteUrl}`);
  if (options.host === '127.0.0.1') {
    console.log('Phone access requires an explicit LAN bind, for example: --host 0.0.0.0');
  } else {
    console.log('Demo mode: this LAN bind has no auth. Use only on a trusted network.');
  }

  if (options.attach) {
    await showStatusMessage(name, `Tether: ${remoteUrl}`).catch((error: unknown) => {
      console.warn(`Could not show URL in tmux status: ${formatTmuxError(error)}`);
    });
    await attachSession(name);
    await daemon.close();
  }
}

program
  .command('attach')
  .argument('<id>')
  .description('attach this terminal to an existing tmux-backed session')
  .action(async (id: string) => {
    const session = new Store().getSession(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    await attachSession(session.tmuxSessionName);
  });

program
  .command('ls')
  .description('list known sessions')
  .action(async () => {
    const store = new Store();
    const sessions = store.listSessions();
    for (const session of sessions) {
      const alive = await sessionExists(session.tmuxSessionName);
      if (!alive && session.status === 'running') {
        store.updateSessionStatus(session.id, 'stopped');
      }
      const status = alive ? session.status : 'stopped';
      console.log(`${session.id}\t${status}\t${session.projectPath}`);
    }
  });

program
  .command('url')
  .argument('<id>')
  .option('--host <host>', 'host shown in the URL; defaults to LAN address')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .description('print the remote URL for a known session')
  .action((id: string, options: { host?: string; port: number }) => {
    const session = new Store().getSession(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    const host = options.host ?? localLanAddress() ?? '127.0.0.1';
    console.log(`http://${host}:${options.port}/remote/session/${id}`);
  });

program
  .command('send')
  .argument('<id>')
  .argument('<text>')
  .description('send text to an existing tmux-backed session')
  .action(async (id: string, text: string) => {
    const store = new Store();
    const session = store.getSession(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    await sendKeys(session.tmuxSessionName, text);
    store.touchSession(id);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(formatTmuxError(error));
  process.exitCode = 1;
});

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}
