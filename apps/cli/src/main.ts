import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
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

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

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
  environment?: {
    pathHasHomebrewBin?: unknown;
    pathHasUsrLocalBin?: unknown;
  };
};

type CreatedGatewaySession = {
  id: string;
};

type GatewayAuthState = {
  serverUrl: string;
  gatewayId: string;
  accountId: string;
  workspaceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
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
      relay: relayConfig(options, file),
      config: file
    });
    console.log(`Tether Gateway: ${daemon.url}`);
    console.log('Gateway is running. Press Ctrl-C to stop.');
    await waitForShutdown();
    await daemon.close();
  });

gatewayCommand
  .command('login')
  .description('bind this local Gateway to the remote auth server and persist auth.json')
  .option('--server-url <url>', 'Server base URL; falls back to TETHER_SERVER_URL')
  .option('--email <email>', 'account email')
  .option('--password <password>', 'account password')
  .action(async (options: { serverUrl?: string; email?: string; password?: string }) => {
    const serverUrl = normalizeServerUrl(options.serverUrl ?? process.env.TETHER_SERVER_URL);
    if (!serverUrl) {
      throw new Error('缺少 Server URL。请传 --server-url 或设置 TETHER_SERVER_URL');
    }
    const email = options.email ?? await promptLine('邮箱: ');
    const password = options.password ?? await promptLine('密码: ');
    if (!email || !password) {
      throw new Error('邮箱和密码不能为空');
    }
    const response = await fetch(`${serverUrl}/api/gateway/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, gatewayName: os.hostname() })
    });
    if (!response.ok) {
      throw new Error(`Gateway 登录失败：HTTP ${response.status}。请确认账号密码，必要时重新执行 tether gateway login。`);
    }
    const body = unwrapServerApiData(await response.json()) as {
      gateway?: { id?: unknown };
      accountId?: unknown;
      workspaceId?: unknown;
      gatewayAccessToken?: unknown;
      gatewayRefreshToken?: unknown;
    };
    if (
      typeof body.gateway?.id !== 'string' ||
      typeof body.accountId !== 'string' ||
      typeof body.workspaceId !== 'string' ||
      typeof body.gatewayAccessToken !== 'string' ||
      typeof body.gatewayRefreshToken !== 'string'
    ) {
      throw new Error('Gateway 登录失败：响应缺少必要字段');
    }
    const payload = decodeTokenPayload(body.gatewayAccessToken);
    if (!payload || typeof payload.expiresAt !== 'number') {
      throw new Error('Gateway 登录失败：access token 缺少 expiresAt');
    }
    await writeGatewayAuthState({
      serverUrl,
      gatewayId: body.gateway.id,
      accountId: body.accountId,
      workspaceId: body.workspaceId,
      accessToken: body.gatewayAccessToken,
      refreshToken: body.gatewayRefreshToken,
      expiresAt: payload.expiresAt
    });
    console.log(`Gateway 登录成功，凭据已写入：${gatewayAuthPath()}`);
  });

gatewayCommand
  .command('config')
  .description('write local Tether Gateway configuration')
  .option('--host <host>', 'Gateway host')
  .option('--port <port>', 'Gateway port', parsePort)
  .option('--relay-url <url>', 'Relay URL')
  .option('--relay-secret <secret>', 'Relay shared secret')
  .option('--codex-command <path>', 'Codex provider command path')
  .option('--claude-command <path>', 'Claude provider command path')
  .option('--opencode-command <path>', 'OpenCode provider command path')
  .option('--clear-codex-command', 'clear Codex provider command path')
  .option('--clear-claude-command', 'clear Claude provider command path')
  .option('--clear-opencode-command', 'clear OpenCode provider command path')
  .option('--allow-api-session-create', '允许 Gateway API 创建白名单 provider session')
  .action(async (options: {
    host?: string;
    port?: number;
    relayUrl?: string;
    relaySecret?: string;
    codexCommand?: string;
    claudeCommand?: string;
    opencodeCommand?: string;
    clearCodexCommand?: boolean;
    clearClaudeCommand?: boolean;
    clearOpencodeCommand?: boolean;
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
      relay: { ...existing.relay },
      providers: { ...existing.providers }
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
    for (const [provider, commandPath] of Object.entries({
      codex: options.codexCommand,
      claude: options.claudeCommand,
      opencode: options.opencodeCommand
    }) as Array<[keyof NonNullable<TetherConfig['providers']>, string | undefined]>) {
      if (commandPath !== undefined) {
        next.providers = { ...next.providers, [provider]: { command: path.resolve(commandPath) } };
      }
    }
    for (const [provider, clear] of Object.entries({
      codex: options.clearCodexCommand,
      claude: options.clearClaudeCommand,
      opencode: options.clearOpencodeCommand
    }) as Array<[keyof NonNullable<TetherConfig['providers']>, boolean | undefined]>) {
      if (clear === true && next.providers) {
        delete next.providers[provider];
      }
    }
    if (next.gateway && Object.keys(next.gateway).length === 0) {
      delete next.gateway;
    }
    if (next.relay && Object.keys(next.relay).length === 0) {
      delete next.relay;
    }
    if (next.providers && Object.keys(next.providers).length === 0) {
      delete next.providers;
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

gatewayCommand
  .command('providers')
  .description('list configured provider commands')
  .action(() => {
    const config = readTetherConfig();
    for (const provider of Object.values(PROVIDERS)) {
      const command = config.providers?.[provider.name]?.command ?? provider.command;
      const source = config.providers?.[provider.name]?.command ? '配置' : 'PATH';
      console.log(`${provider.name}\t${source}\t${command}`);
    }
  });

gatewayCommand
  .command('logs')
  .description('show Gateway launchd logs')
  .option('-f, --follow', 'follow logs')
  .option('--stderr', 'show stderr log only')
  .option('--stdout', 'show stdout log only')
  .action(async (options: { follow?: boolean; stderr?: boolean; stdout?: boolean }) => {
    await showGatewayLogs(options);
  });

gatewayCommand
  .command('doctor')
  .description('diagnose Gateway background runtime')
  .action(async () => {
    await runGatewayDoctor();
  });

gatewayCommand
  .command('verify')
  .description('create and stop a short Gateway-managed session')
  .option('--provider <provider>', 'provider to verify', 'codex')
  .action(async (options: { provider: string }) => {
    await verifyGatewaySession(options.provider);
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
  const providerCommand = configuredProviderCommand(provider);
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

  await createAgentSession(name, projectPath, providerCommand);
  store.insertSession({
    id,
    provider: provider.name,
    title: path.basename(projectPath),
    projectPath,
    status: 'running',
    attachState: options.attach ? 'attached' : 'detached',
    tmuxSessionName: name,
    command: providerCommand,
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
  const providerCommand = configuredProviderCommand(provider);
  const projectPath = path.resolve(options.project);
  const store = new Store();
  const ptySessions = new PtySessionManager(store);
  const id = createSessionId();
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;
  ptySessions.create({
    id,
    provider: provider.name,
    command: providerCommand,
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

function configuredProviderCommand(provider: ProviderDefinition): string {
  const command = readTetherConfig().providers?.[provider.name]?.command;
  return command && command.length > 0 ? command : provider.command;
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
  const authHeaders = await gatewayAuthHeaders();
  const response = await fetch(`${gatewayUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders },
    body: JSON.stringify(buildCreateSessionPayload(provider, options))
  });

  if (response.status === 401) {
    throw new Error('常驻 Gateway 鉴权失败。请重新执行 tether gateway login。');
  }
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
        headers: { 'content-type': 'application/json', ...(await gatewayAuthHeaders()) },
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
      method: 'POST',
      headers: await gatewayAuthHeaders()
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
  console.log(`后台 PATH: ${formatGatewayPathStatus(api)}`);
  console.log(`Provider 命令: ${formatProviderCommands(file)}`);
  console.log(`LaunchAgent: ${formatLaunchAgentStatus(launchd)}`);
}

function formatGatewayPathStatus(api: GatewayStatus | undefined): string {
  if (!api) {
    return '未确认';
  }
  const hasHomebrew = booleanValue(api.environment?.pathHasHomebrewBin);
  const hasUsrLocal = booleanValue(api.environment?.pathHasUsrLocalBin);
  if (hasHomebrew || hasUsrLocal) {
    return [
      hasHomebrew ? '包含 /opt/homebrew/bin' : undefined,
      hasUsrLocal ? '包含 /usr/local/bin' : undefined
    ].filter(Boolean).join('，');
  }
  return '未包含常见用户 bin 目录';
}

function formatProviderCommands(config: TetherConfig): string {
  const configured = Object.entries(config.providers ?? {})
    .filter((entry): entry is [string, { command: string }] => typeof entry[1]?.command === 'string' && entry[1].command.length > 0)
    .map(([provider, value]) => `${provider}=${value.command}`);
  return configured.length > 0 ? configured.join('，') : '未配置，使用 PATH 查找';
}

async function showGatewayLogs(options: { follow?: boolean; stderr?: boolean; stdout?: boolean }): Promise<void> {
  const paths = gatewayLogPaths(options);
  if (options.follow) {
    const child = spawn('tail', ['-f', ...paths], { stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
    return;
  }
  for (const filePath of paths) {
    console.log(`==> ${filePath} <==`);
    const text = await readFile(filePath, 'utf8').catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    });
    const lines = text.trimEnd().split('\n').filter(Boolean).slice(-80);
    console.log(lines.length > 0 ? lines.join('\n') : '(暂无日志)');
  }
}

function gatewayLogPaths(options: { stderr?: boolean; stdout?: boolean }): string[] {
  const logsDir = path.join(os.homedir(), '.tether', 'logs');
  if (options.stderr) {
    return [path.join(logsDir, 'gateway.err.log')];
  }
  if (options.stdout) {
    return [path.join(logsDir, 'gateway.out.log')];
  }
  return [path.join(logsDir, 'gateway.out.log'), path.join(logsDir, 'gateway.err.log')];
}

async function runGatewayDoctor(): Promise<void> {
  const file = readTetherConfig();
  const gateway = resolveGatewayConfig({ file });
  const relay = resolveRelayConfig({ file });
  const launchd = await getLaunchAgentStatus();
  const api = await fetchFirstGatewayStatus([`http://${gateway.host}:${gateway.port}`]);
  const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];
  const pushCheck = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, status: ok ? 'ok' : 'fail', detail });
  };
  pushCheck('配置文件', fs.existsSync(configPath()), configPath());
  pushCheck('LaunchAgent 已安装', launchd.installed, launchd.path);
  pushCheck('LaunchAgent 已加载', launchd.loaded, launchd.error ?? `PID ${launchd.pid ?? '-'}`);
  pushCheck('Gateway API 可连接', Boolean(api), `http://${gateway.host}:${gateway.port}`);
  pushCheck('API session creation', gateway.allowApiSessionCreate, gateway.allowApiSessionCreate ? '已开启' : '未开启');
  pushCheck('Relay 配置', Boolean(relay), relay ? relay.url : '未配置');
  pushCheck('Relay 连接', stringValue(api?.relay?.state) === 'connected', stringValue(api?.relay?.state) ?? '未确认');
  for (const provider of Object.values(PROVIDERS)) {
    const configuredCommand = file.providers?.[provider.name]?.command;
    const command = configuredCommand ?? provider.command;
    const available = commandAvailable(command);
    checks.push({
      name: `${provider.name} 命令`,
      status: available ? 'ok' : configuredCommand ? 'fail' : 'warn',
      detail: command
    });
  }
  pushCheck('后台 PATH', formatGatewayPathStatus(api) !== '未包含常见用户 bin 目录', formatGatewayPathStatus(api));

  let failed = 0;
  for (const check of checks) {
    if (check.status === 'fail') failed += 1;
    const label = check.status === 'ok' ? 'OK  ' : check.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${label} ${check.name}: ${check.detail}`);
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function verifyGatewaySession(providerName: string): Promise<void> {
  if (!isProviderName(providerName)) {
    throw new Error(`unknown provider: ${providerName}`);
  }
  const gateway = resolveGatewayConfig();
  const gatewayUrl = `http://${gateway.host}:${gateway.port}`;
  const session = await createSessionViaGateway(PROVIDERS[providerName], { project: process.cwd() }, gatewayUrl);
  if (!session) {
    throw new Error('无法通过 Gateway 创建 session，请先开启 allowApiSessionCreate 并重启 Gateway');
  }
  console.log(`已创建验证 session：${session.id}`);
  const response = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(session.id)}/stop`, {
    method: 'POST',
    headers: await gatewayAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(`验证 session 停止失败：HTTP ${response.status}`);
  }
  console.log(`已停止验证 session：${session.id}`);
}

function commandAvailable(command: string): boolean {
  if (path.isAbsolute(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
  const mode = options.mode ?? 'control';
  const ticket = await requestWsTicket(options, id, mode);
  const url = `ws://${options.host}:${options.port}/api/sessions/${encodeURIComponent(id)}/stream?surface=cli&mode=${mode}`;
  const ws = new WebSocket(url, [`tether-ticket.${ticket}`]);
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

async function requestWsTicket(
  options: { host: string; port: number },
  sessionId: string,
  mode: 'control' | 'observe'
): Promise<string> {
  const response = await fetch(`http://${options.host}:${options.port}/api/ws-ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await gatewayAuthHeaders()) },
    body: JSON.stringify({ sessionId, mode })
  });
  if (!response.ok) {
    throw new Error(`ticket failed: HTTP ${response.status}。如凭据已过期，请重新执行 tether gateway login。`);
  }
  const body = (await response.json()) as { ticket?: unknown };
  if (typeof body.ticket !== 'string') {
    throw new Error('ticket response missing ticket');
  }
  return body.ticket;
}

function gatewayAuthPath(): string {
  return process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json');
}

function unwrapServerApiData(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('code' in body)) {
    return body;
  }
  const payload = body as { code?: unknown; msg?: unknown; data?: unknown; stack?: unknown };
  if (payload.code === 200) {
    return payload.data;
  }
  const message = typeof payload.msg === 'string' ? payload.msg : 'server_error';
  const stack = typeof payload.stack === 'string' ? `\n${payload.stack}` : '';
  throw new Error(`${message}${stack}`);
}

async function gatewayAuthHeaders(): Promise<Record<string, string>> {
  const auth = await readGatewayAuthState();
  if (auth.expiresAt <= Date.now()) {
    throw new Error('本地 auth.json 已过期，请重新执行 tether gateway login。');
  }
  return { authorization: `Bearer ${auth.accessToken}` };
}

async function readGatewayAuthState(): Promise<GatewayAuthState> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    throw new Error('缺少 ~/.tether/auth.json，请先执行 tether gateway login。');
  }
  const parsed = JSON.parse(raw) as Partial<GatewayAuthState>;
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.gatewayId !== 'string' ||
    typeof parsed.accountId !== 'string' ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    throw new Error('auth.json 格式无效，请重新执行 tether gateway login。');
  }
  return parsed as GatewayAuthState;
}

async function writeGatewayAuthState(state: GatewayAuthState): Promise<void> {
  await mkdir(path.dirname(gatewayAuthPath()), { recursive: true });
  await writeFile(gatewayAuthPath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function decodeTokenPayload(token: string): { expiresAt?: unknown } | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { expiresAt?: unknown };
  } catch {
    return undefined;
  }
}

function normalizeServerUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, '');
}

async function promptLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
