import path from 'node:path';
import { Command } from 'commander';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import {
  configPath,
  readTetherConfig,
  resolveGatewayConfig,
  resolveRelayConfig,
  writeTetherConfig,
  type TetherConfig
} from '@tether/config';
import {
  assertTmuxAvailable,
  attachSession,
  createAgentSession,
  formatTmuxError,
  listGateways,
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
import { isProviderName, PROVIDERS, type ProviderDefinition } from '@tether/core';
import { buildCreateSessionPayload } from './forwarding.js';
import {
  installLaunchAgent,
  launchAgentPath,
  launchAgentStatus,
  restartLaunchAgent,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent,
  type LaunchAgentStatus
} from './launchd.js';
import { runningSessionIds } from './session-stop.js';

const program = new Command();

program
  .name('tether')
  .description('Agent console for sharing one CLI agent session across devices')
  .version('0.1.0');

type StartOptions = {
  host: string;
  port: number;
  project: string;
  attach: boolean;
  transport: 'tmux' | 'pty';
  inline?: boolean;
  relayUrl?: string;
  relaySecret?: string;
};

type GatewayStatus = {
  ok?: unknown;
  pid?: unknown;
  url?: unknown;
  host?: unknown;
  port?: unknown;
  allowApiSessionCreate?: unknown;
  relay?: {
    configured?: unknown;
    state?: unknown;
  };
};

type CreatedGatewaySession = {
  id: string;
};

class NonTetherGatewayError extends Error {
  constructor(url: string) {
    super(`端口已被非 Tether 服务占用，无法作为常驻 Gateway 使用：${url}`);
  }
}

function addProviderCommand(provider: ProviderDefinition): void {
  program
    .command(provider.name)
    .description(`start a tether-managed ${provider.name} session`)
    .option('--host <host>', 'daemon host to bind', '127.0.0.1')
    .option('--port <port>', 'daemon port', parsePort, 4789)
    .option('--project <path>', 'project directory', process.cwd())
    .option('--transport <transport>', 'session transport: pty or tmux', parseTransport, 'pty')
    .option('--inline', '强制使用 inline Gateway，不转发到常驻 Gateway')
    .option('--relay-url <url>', 'relay server URL; falls back to TETHER_RELAY_URL')
    .option('--relay-secret <secret>', 'relay shared secret; falls back to TETHER_RELAY_SECRET')
    .option('--no-attach', 'start session without attaching this terminal')
    .action((options: StartOptions) => startProviderSession(provider, options));
}

for (const provider of Object.values(PROVIDERS)) {
  addProviderCommand(provider);
}

const gatewayCommand = program
  .command('gateway')
  .description('start a persistent Tether Gateway without creating a session')
  .option('--host <host>', 'daemon host to bind')
  .option('--port <port>', 'daemon port', parsePort)
  .option('--relay-url <url>', 'relay server URL; falls back to TETHER_RELAY_URL')
  .option('--relay-secret <secret>', 'relay shared secret; falls back to TETHER_RELAY_SECRET')
  .action(async (options: { host?: string; port?: number; relayUrl?: string; relaySecret?: string }, command: Command) => {
    const file = readTetherConfig();
    const gateway = resolveGatewayConfig({ cli: gatewayCliConfig(options, command), file });
    const store = new Store();
    const ptySessions = new PtySessionManager(store);
    const daemon = await startDaemon({
      host: gateway.host,
      port: gateway.port,
      store,
      ptySessions,
      allowApiSessionCreate: gateway.allowApiSessionCreate,
      relay: relayConfig(options, file)
    });
    console.log(`Tether Gateway: ${daemon.url}`);
    console.log('Gateway is running. Press Ctrl-C to stop.');
    await waitForShutdown();
    await daemon.close();
  });

gatewayCommand
  .command('config')
  .description('write local Tether Gateway configuration')
  .option('--host <host>', 'Gateway host')
  .option('--port <port>', 'Gateway port', parsePort)
  .option('--relay-url <url>', 'Relay URL')
  .option('--relay-secret <secret>', 'Relay shared secret')
  .option('--allow-api-session-create', '允许 Gateway API 创建白名单 provider session')
  .action(async (options: {
    host?: string;
    port?: number;
    relayUrl?: string;
    relaySecret?: string;
    allowApiSessionCreate?: boolean;
  }, command: Command) => {
    const gatewayOptions = command.parent?.opts<{
      host?: string;
      port?: number;
      relayUrl?: string;
      relaySecret?: string;
    }>() ?? {};
    const host = options.host ?? gatewayOptions.host;
    const port = options.port ?? gatewayOptions.port;
    const relayUrl = options.relayUrl ?? gatewayOptions.relayUrl;
    const relaySecret = options.relaySecret ?? gatewayOptions.relaySecret;
    const existing = readTetherConfig();
    const next: TetherConfig = {
      ...existing,
      gateway: { ...existing.gateway },
      relay: { ...existing.relay }
    };
    if (host !== undefined) {
      next.gateway = { ...next.gateway, host };
    }
    if (port !== undefined) {
      next.gateway = { ...next.gateway, port };
    }
    if (command.getOptionValueSource('allowApiSessionCreate') === 'cli') {
      next.gateway = { ...next.gateway, allowApiSessionCreate: options.allowApiSessionCreate === true };
    }
    if (relayUrl !== undefined) {
      next.relay = { ...next.relay, url: relayUrl };
    }
    if (relaySecret !== undefined) {
      next.relay = { ...next.relay, secret: relaySecret };
    }
    if (next.gateway && Object.keys(next.gateway).length === 0) {
      delete next.gateway;
    }
    if (next.relay && Object.keys(next.relay).length === 0) {
      delete next.relay;
    }
    await writeTetherConfig(next);
    console.log(`Gateway 配置已写入：${configPath()}`);
  });

gatewayCommand
  .command('install')
  .description('install the macOS LaunchAgent without starting Gateway')
  .action(async () => {
    const plistPath = await installLaunchAgent();
    console.log(`LaunchAgent 已安装：${plistPath}`);
    console.log('Gateway 尚未启动。运行 tether gateway start 可通过 launchd 启动。');
  });

gatewayCommand
  .command('start')
  .description('start Gateway through launchd')
  .action(async () => {
    const status = await startLaunchAgent();
    console.log(`Gateway 已通过 launchd 启动：${status.path}`);
  });

gatewayCommand
  .command('stop')
  .description('stop Gateway through launchd')
  .action(async () => {
    await stopLaunchAgent();
    console.log('Gateway 已停止。');
  });

gatewayCommand
  .command('restart')
  .description('restart Gateway through launchd')
  .action(async () => {
    await restartLaunchAgent();
    console.log('Gateway 已重启。');
  });

gatewayCommand
  .command('uninstall')
  .description('stop Gateway and remove the macOS LaunchAgent')
  .action(async () => {
    const plistPath = await uninstallLaunchAgent();
    console.log(`LaunchAgent 已卸载：${plistPath}`);
  });

gatewayCommand
  .command('status')
  .description('print Gateway status in Chinese')
  .action(async () => {
    await printGatewayStatus();
  });

program
  .command('run')
  .argument('<provider>')
  .description('start a PTY event-stream session for a provider')
  .option('--host <host>', 'daemon host to bind', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .option('--project <path>', 'project directory', process.cwd())
  .option('--transport <transport>', 'session transport: tmux or pty', parseTransport, 'pty')
  .option('--inline', '强制使用 inline Gateway，不转发到常驻 Gateway')
  .option('--relay-url <url>', 'relay server URL; falls back to TETHER_RELAY_URL')
  .option('--relay-secret <secret>', 'relay shared secret; falls back to TETHER_RELAY_SECRET')
  .option('--no-attach', 'start session without attaching this terminal')
  .action((providerName: string, options: StartOptions) => {
    if (!isProviderName(providerName)) {
      throw new Error(`unknown provider: ${providerName}`);
    }
    const provider = PROVIDERS[providerName];
    return startProviderSession(provider, options);
  });

async function startProviderSession(provider: ProviderDefinition, options: StartOptions): Promise<void> {
  if (options.inline !== true) {
    const gatewayUrl = await findPersistentGateway(options);
    if (gatewayUrl) {
      const session = await createSessionViaGateway(provider, options, gatewayUrl);
      if (session) {
        const remoteUrl = `${gatewayUrl}/remote/session/${session.id}`;
        console.log(`Tether session: ${session.id}`);
        console.log(`Remote URL: ${remoteUrl}`);
        if (options.attach) {
          const gateway = new URL(gatewayUrl);
          const result = await attachPtySession(session.id, {
            host: gateway.hostname,
            port: Number(gateway.port),
            mode: 'control'
          });
          if (result !== 'exited') {
            console.error(`已断开本地 attach。常驻 Gateway 仍在托管 ${remoteUrl}`);
          }
        }
        return;
      }
    } else {
      console.warn('未检测到常驻 Gateway，正在为本次会话启动 inline Gateway。运行 tether gateway install 可让会话由后台 Gateway 常驻托管。');
    }
  }

  if (options.inline === true) {
    console.log('已启用 inline 模式：本次会话不会转发到常驻 Gateway。');
  }

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

  const daemon = await startDaemon({ host: options.host, port: options.port, store, relay: relayConfig(options) });
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

async function startPtyProviderSession(provider: ProviderDefinition, options: StartOptions): Promise<void> {
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

  const daemon = await startDaemon({
    host: options.host,
    port: options.port,
    store,
    ptySessions,
    relay: relayConfig(options)
  });
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

async function findPersistentGateway(options: Pick<StartOptions, 'host' | 'port'>): Promise<string | undefined> {
  const urls = await gatewayCandidateUrls(options);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const url of urls) {
      const status = await fetchGatewayStatus(url);
      if (status === 'non-tether') {
        throw new NonTetherGatewayError(url);
      }
      if (status) {
        return status;
      }
    }

    if (attempt < 3) {
      console.warn(`常驻 Gateway 可能正在重启，${attempt}/3 次探测失败，500ms 后重试。`);
      await sleep(500);
    }
  }
  return undefined;
}

async function gatewayCandidateUrls(options: Pick<StartOptions, 'host' | 'port'>): Promise<string[]> {
  const config = resolveGatewayConfig({ cli: { host: options.host, port: options.port } });
  const candidates = new Set<string>();
  for (const record of await listGateways()) {
    candidates.add(record.url);
  }
  candidates.add(`http://${config.host}:${config.port}`);
  return [...candidates];
}

async function createSessionViaGateway(
  provider: ProviderDefinition,
  options: Pick<StartOptions, 'project'>,
  gatewayUrl: string
): Promise<CreatedGatewaySession | undefined> {
  const response = await fetch(`${gatewayUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildCreateSessionPayload(provider, options))
  });

  if (response.status === 403) {
    console.warn('常驻 Gateway 当前未启用 API session creation。请在 ~/.tether/config.json 中开启 gateway.allowApiSessionCreate 后重启 Gateway；本次将回退到 inline Gateway。');
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`创建常驻 Gateway session 失败：HTTP ${response.status}`);
  }

  const body = (await response.json()) as { session?: { id?: unknown } };
  if (typeof body.session?.id !== 'string') {
    throw new Error('创建常驻 Gateway session 失败：响应缺少 session id');
  }
  return { id: body.session.id };
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
  .description('send text to an existing session')
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
  .argument('[id]')
  .option('--all', 'stop all running sessions')
  .option('--host <host>', 'daemon host', '127.0.0.1')
  .option('--port <port>', 'daemon port', parsePort, 4789)
  .description('stop a running session')
  .action(async (id: string | undefined, options: { all?: boolean; host: string; port: number }) => {
    const store = new Store();
    if (options.all) {
      const ids = runningSessionIds(store.listSessions());
      for (const sessionId of ids) {
        await stopSession(store, sessionId, options);
        console.log(`已关闭 ${sessionId}`);
      }
      console.log(`已关闭 ${ids.length} 个 session。`);
      return;
    }
    if (!id) {
      throw new Error('missing session id; use `tether stop <id>` or `tether stop --all`');
    }
    await stopSession(store, id, options);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(formatTmuxError(error));
  process.exitCode = 1;
});

async function stopSession(store: Store, id: string, options: { host: string; port: number }): Promise<void> {
  const session = store.getSession(id);
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
}

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

function gatewayCliConfig(
  options: { host?: string; port?: number; allowApiSessionCreate?: boolean },
  command: Command
): { host?: string; port?: number; allowApiSessionCreate?: boolean } {
  return {
    host: command.getOptionValueSource('host') === 'cli' ? options.host : undefined,
    port: command.getOptionValueSource('port') === 'cli' ? options.port : undefined,
    allowApiSessionCreate:
      command.getOptionValueSource('allowApiSessionCreate') === 'cli'
        ? options.allowApiSessionCreate
        : undefined
  };
}

function relayConfig(options: { relayUrl?: string; relaySecret?: string }, file?: TetherConfig):
  | { url: string; secret: string }
  | undefined {
  const config = file ?? readTetherConfig();
  const url = options.relayUrl ?? process.env.TETHER_RELAY_URL ?? config.relay?.url;
  const secret = options.relaySecret ?? process.env.TETHER_RELAY_SECRET ?? config.relay?.secret;
  if (!url && !secret) {
    return undefined;
  }
  if (!url || !secret) {
    throw new Error('relay requires both --relay-url and --relay-secret, or TETHER_RELAY_URL and TETHER_RELAY_SECRET');
  }
  return { url, secret };
}

async function printGatewayStatus(): Promise<void> {
  const file = readTetherConfig();
  const gatewayConfig = resolveGatewayConfig({ file });
  const relay = resolveRelayConfig({ file });
  const launchd = await getLaunchAgentStatus();
  const registryRecords = await listGateways();
  const api = await fetchFirstGatewayStatus([
    ...registryRecords.map((record) => record.url),
    `http://${gatewayConfig.host}:${gatewayConfig.port}`
  ]);
  const registry = registryRecords[0];
  const url = stringValue(api?.url) ?? registry?.url ?? `http://${gatewayConfig.host}:${gatewayConfig.port}`;
  const host = stringValue(api?.host) ?? registry?.host ?? gatewayConfig.host;
  const port = numberValue(api?.port) ?? registry?.port ?? gatewayConfig.port;
  const pid = numberValue(api?.pid) ?? launchd.pid ?? registry?.pid;
  const relayConfigured = booleanValue(api?.relay?.configured) ?? Boolean(relay);
  const relayState = stringValue(api?.relay?.state);

  console.log('Gateway 状态');
  console.log(`运行状态: ${api ? '运行中' : '已停止或不可连接'}`);
  console.log(`PID: ${pid ?? '-'}`);
  console.log(`URL: ${url}`);
  console.log(`配置文件: ${configPath()}`);
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`Relay 配置: ${relayConfigured ? '已配置' : '未配置'}`);
  console.log(`Relay 连接: ${relayState ?? '未确认'}`);
  console.log(`LaunchAgent: ${formatLaunchAgentStatus(launchd)}`);
}

async function getLaunchAgentStatus(): Promise<LaunchAgentStatus> {
  try {
    return await launchAgentStatus();
  } catch (error: unknown) {
    return {
      label: 'sh.tether.gateway',
      path: launchAgentPath(),
      installed: false,
      loaded: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fetchFirstGatewayStatus(urls: string[]): Promise<GatewayStatus | undefined> {
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    const status = await fetchGatewayStatusBody(url);
    if (status) {
      return status;
    }
  }
  return undefined;
}

async function fetchGatewayStatusBody(url: string): Promise<GatewayStatus | undefined> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/status`);
  } catch {
    return undefined;
  }
  if (!response.ok) {
    return undefined;
  }
  const status = (await response.json().catch(() => undefined)) as GatewayStatus | undefined;
  if (!status || status.ok !== true) {
    return undefined;
  }
  return status;
}

function formatLaunchAgentStatus(status: LaunchAgentStatus): string {
  if (status.loaded) {
    return status.installed ? '已安装，已加载' : '未安装，已加载';
  }
  if (status.installed) {
    return '已安装，未加载';
  }
  return '未安装';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

async function fetchGatewayStatus(url: string): Promise<string | 'non-tether' | undefined> {
  let response: Response;
  try {
    response = await fetch(`${url}/api/status`);
  } catch {
    return undefined;
  }

  if (!response.ok) {
    return response.status === 404 ? 'non-tether' : undefined;
  }

  const status = (await response.json().catch(() => undefined)) as GatewayStatus | undefined;
  if (!status || status.ok !== true || typeof status.url !== 'string') {
    return 'non-tether';
  }
  return status.url;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
