import path from 'node:path';
import { Command } from 'commander';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import {
  assertTmuxAvailable,
  attachSession,
  createAgentSession,
  formatTmuxError,
  localLanAddress,
  sendKeys,
  sessionExists,
  sessionName,
  PtySessionManager,
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
  claude: { name: 'claude', command: 'claude' },
  opencode: { name: 'opencode', command: 'opencode' }
} satisfies Record<ProviderName, Provider>;

type StartOptions = {
  host: string;
  port: number;
  project: string;
  attach: boolean;
  transport: 'tmux' | 'pty';
};

function addProviderCommand(provider: Provider): void {
  program
    .command(provider.name)
    .description(`start a tether-managed ${provider.name} session`)
    .option('--host <host>', 'daemon host to bind', '127.0.0.1')
    .option('--port <port>', 'daemon port', parsePort, 4789)
    .option('--project <path>', 'project directory', process.cwd())
    .option('--transport <transport>', 'session transport: pty or tmux', parseTransport, 'pty')
    .option('--no-attach', 'start session without attaching this terminal')
    .action((options: StartOptions) => startProviderSession(provider, options));
}

for (const provider of Object.values(providers)) {
  addProviderCommand(provider);
}

program
  .command('run')
  .argument('<provider>')
  .description('start a PTY event-stream session for a provider')
  .option('--host <host>', 'daemon host to bind', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .option('--project <path>', 'project directory', process.cwd())
  .option('--transport <transport>', 'session transport: tmux or pty', parseTransport, 'pty')
  .option('--no-attach', 'start session without attaching this terminal')
  .action((providerName: string, options: StartOptions) => {
    const provider = providers[providerName as ProviderName];
    if (!provider) {
      throw new Error(`unknown provider: ${providerName}`);
    }
    return startProviderSession(provider, options);
  });

async function startProviderSession(provider: Provider, options: StartOptions): Promise<void> {
  if (options.transport === 'pty') {
    await startPtyProviderSession(provider, options);
    return;
  }

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
    attachState: options.attach ? 'attached' : 'detached',
    tmuxSessionName: name,
    command: provider.command,
    transport: 'tmux',
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

async function startPtyProviderSession(provider: Provider, options: StartOptions): Promise<void> {
  const projectPath = path.resolve(options.project);
  const store = new Store();
  const ptySessions = new PtySessionManager(store);
  const id = createSessionId();
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;
  ptySessions.create({
    id,
    provider: provider.name,
    command: provider.command,
    projectPath,
    cols,
    rows
  });

  const daemon = await startDaemon({ host: options.host, port: options.port, store, ptySessions });
  const remoteUrl = `${daemon.url}/remote/session/${id}`;
  console.log(`Tether session: ${id}`);
  console.log(`Remote URL: ${remoteUrl}`);
  console.log('PTY event stream mode: experimental.');
  if (options.host === '127.0.0.1') {
    console.log('Phone access requires an explicit LAN bind, for example: --host 0.0.0.0');
  } else {
    console.log('Demo mode: this LAN bind has no auth. Use only on a trusted network.');
  }

  if (options.attach) {
    const result = await attachPtySession(id, { host: '127.0.0.1', port: options.port });
    if (result === 'exited') {
      await daemon.close();
    } else {
      console.error(`Detached. Gateway is still serving ${remoteUrl}`);
    }
  }
}

program
  .command('attach')
  .argument('<id>')
  .option('--host <host>', 'daemon host', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .option('--control', 'attach as active controller')
  .option('--observe', 'attach as observer')
  .description('attach this terminal to an existing session')
  .action(async (id: string, options: { host: string; port: number; control?: boolean; observe?: boolean }) => {
    const session = new Store().getSession(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    if (session.transport === 'pty-event-stream') {
      await attachPtySession(id, { ...options, mode: options.observe ? 'observe' : 'control' });
      return;
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
      const alive = session.transport === 'tmux' ? await sessionExists(session.tmuxSessionName) : session.status === 'running';
      if (session.transport === 'tmux' && !alive && session.status === 'running') {
        store.updateSessionStatus(session.id, 'stopped');
      }
      const status = alive ? session.status : 'stopped';
      console.log(`${session.id}\t${status}\t${session.transport}\t${session.projectPath}`);
    }
  });

program
  .command('clients')
  .argument('<id>')
  .option('--host <host>', 'daemon host', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .description('list clients attached to a PTY event-stream session')
  .action(async (id: string, options: { host: string; port: number }) => {
    const response = await fetch(`http://${options.host}:${options.port}/api/sessions/${encodeURIComponent(id)}/clients`);
    if (!response.ok) {
      throw new Error(`clients failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      controllerClientId: string | null;
      clients: Array<{ clientId: string; surface: string; mode: string; deviceName: string; lastSeenAt: number }>;
    };
    console.log(`controller\t${data.controllerClientId ?? '-'}`);
    for (const client of data.clients) {
      console.log(`${client.clientId}\t${client.mode}\t${client.surface}\t${client.deviceName}\t${new Date(client.lastSeenAt).toLocaleTimeString()}`);
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
    if (session.transport === 'pty-event-stream') {
      const response = await fetch(`http://127.0.0.1:4789/api/sessions/${encodeURIComponent(id)}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: `${text}\r` })
      });
      if (!response.ok) {
        throw new Error(`send failed: HTTP ${response.status}`);
      }
      return;
    }
    await sendKeys(session.tmuxSessionName, text);
    store.touchSession(id);
  });

program
  .command('stop')
  .argument('<id>')
  .option('--host <host>', 'daemon host', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .description('stop a running session')
  .action(async (id: string, options: { host: string; port: number }) => {
    const session = new Store().getSession(id);
    if (!session) {
      throw new Error(`unknown session: ${id}`);
    }
    if (session.transport === 'pty-event-stream') {
      const response = await fetch(`http://${options.host}:${options.port}/api/sessions/${encodeURIComponent(id)}/stop`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`stop failed: HTTP ${response.status}`);
      }
      return;
    }
    await sendKeys(session.tmuxSessionName, 'C-c');
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

function parseTransport(value: string): 'tmux' | 'pty' {
  if (value === 'tmux' || value === 'pty') {
    return value;
  }
  throw new Error(`invalid transport: ${value}`);
}

async function attachPtySession(
  id: string,
  options: { host: string; port: number; mode?: 'control' | 'observe' }
): Promise<'detached' | 'exited'> {
  const ticket = await requestWsTicket(options);
  const mode = options.mode ?? 'control';
  const url = `ws://${options.host}:${options.port}/api/sessions/${encodeURIComponent(id)}/stream?ticket=${encodeURIComponent(ticket)}&surface=cli&mode=${mode}`;
  const ws = new WebSocket(url);
  let result: 'detached' | 'exited' = 'detached';

  const previousRawMode = process.stdin.isRaw;
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  console.error('Attached to Tether PTY session. Close this terminal client to detach.');
  process.stdin.setRawMode?.(true);
  process.stdin.resume();

  const resize = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'resize',
        cols: process.stdout.columns || 120,
        rows: process.stdout.rows || 40
      }));
    }
  };
  const onData = (chunk: Buffer) => {
    if (mode !== 'observe' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: chunk.toString('utf8') }));
    }
  };
  process.stdin.on('data', onData);
  process.stdout.on('resize', resize);
  resize();

  await new Promise<void>((resolve, reject) => {
    ws.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as {
        type?: string;
        event?: { type?: string; payload?: { data?: unknown } };
      };
      if (frame.type === 'event' && frame.event?.type === 'terminal.output') {
        const data = frame.event.payload?.data;
        if (typeof data === 'string') {
          process.stdout.write(data);
        }
        return;
      }
      if (frame.type === 'event' && frame.event?.type === 'session.exited') {
        result = 'exited';
        ws.close();
      }
    });
    ws.once('close', () => resolve());
    ws.once('error', reject);
  }).finally(() => {
    process.stdin.off('data', onData);
    process.stdout.off('resize', resize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(previousRawMode);
    }
  });
  return result;
}

async function requestWsTicket(options: { host: string; port: number }): Promise<string> {
  const response = await fetch(`http://${options.host}:${options.port}/api/ws-ticket`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`ticket failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { ticket?: unknown };
  if (typeof body.ticket !== 'string') {
    throw new Error('ticket response missing ticket');
  }
  return body.ticket;
}
