// Node 版本兜底检查。launcher (M3) 会在更早阶段检查；此处兜底用于直接通过 tsx 跑源码的场景。
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Tether 需要 Node.js 22.13 或更高版本，当前 ${process.versions.node}`);
    console.error('建议：nvm install 22 && nvm use 22');
    process.exit(1);
  }
}

import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import {
  configPath,
  DEFAULT_SERVER_URL,
  defaultTetherConfig,
  isGatewayProfileName,
  readTetherConfig,
  resolveGatewayConfig,
  resolveGatewayProfileConfig,
  resolveRelayConfig,
  resolveServerUrl,
  writeTetherConfig,
  type GatewayProfileName,
  type TetherConfig
} from '@tether/config';
import {
  attachSession,
  formatTmuxError,
  listGateways,
  localLanAddress,
  sendKeys,
  sessionExists,
  PtySessionManager,
  startDaemon,
  Store,
  SessionRunnerClient,
} from '@tether/gateway';
import { defaultDbPath } from '@tether/gateway/store';
import { isProviderName, PROVIDERS, type ProviderDefinition } from '@tether/core';
import { buildCreateSessionPayload } from './forwarding.js';
import {
  gatewayRuntimeJsonPath,
  installLaunchAgent,
  launchAgentPath,
  launchAgentStatus,
  readGatewayRuntimeInfo,
  restartLaunchAgent,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent,
  type LaunchAgentStatus
} from './launchd.js';
import { runningSessionIds } from './session-stop.js';

const program = new Command();
const TERMINAL_RESET_SEQUENCE = '\x1b[?2004l\x1b[?1004l\x1b[<u\x1b[0m\x1b[?25h';
const TETHER_VERSION = resolvePackageVersion(import.meta.url, '@tether-labs/cli') ?? '0.0.0-dev';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

program
  .name('tether')
  .description('跨设备接管同一个 CLI Agent 会话的控制台')
  .version(TETHER_VERSION, '-V, --version', '输出版本号')
  .helpOption('-h, --help', '显示帮助')
  .addHelpCommand('help [command]', '显示指定命令的帮助');

type StartOptions = {
  project: string;
  title?: string;
  attach: boolean;
  reconnect?: boolean;
  providerArgs?: string[];
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

type CliSession = {
  id: string;
  status: string;
  transport?: string;
  projectPath?: string;
  tmuxSessionName?: string;
};

type GatewayLoginEnv = 'local' | 'prod';

const LOCAL_SERVER_URL = 'http://127.0.0.1:4800';
const LOCAL_DETACH_KEY = '\x01';

type CreatedGatewaySession = {
  id: string;
};

type AttachMode = 'control' | 'observe';

type AttachPtySessionOptions = {
  host: string;
  port: number;
  mode?: AttachMode;
  reconnect?: boolean;
};

type AttachAttemptResult = {
  status: 'detached' | 'exited' | 'stopped' | 'reconnect' | 'lost';
  latestEventId: number;
  message?: string;
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
    .description(`启动由 Tether 托管的 ${provider.name} 会话`)
    .option('--project <path>', '项目目录', process.cwd())
    .option('--title <title>', '前端展示的 session 标题')
    .option('--no-attach', '只启动 session，不接入当前终端')
    .option('--no-reconnect', '本地 attach 断开后不自动重连')
    .argument('[providerArgs...]')
    .allowUnknownOption(true)
    .action((providerArgs: string[], options: StartOptions) => {
      return startProviderSession(provider, { ...options, providerArgs });
    });
}

for (const provider of Object.values(PROVIDERS)) {
  addProviderCommand(provider);
}

const gatewayCommand = program
  .command('gateway')
  .description('管理 Tether Gateway')
  .helpOption('-h, --help', '显示帮助')
  .addHelpCommand('help [command]', '显示指定 Gateway 命令的帮助')
  .action(async () => {
    const launchdProfile = gatewayProfileFromEnv();
    if (launchdProfile) {
      await startGatewayForeground(launchdProfile);
      return;
    }
    const answer = await promptLine('运行模式：1. 前台  2. 后台（launchd）[默认 1]: ');
    if (answer === '2' || answer === 'background' || answer === '后台') {
      await startGatewayBackground();
    } else {
      await startGatewayForeground('relay');
    }
  });

gatewayCommand
  .command('login')
  .description('在浏览器中授权，将本机 Gateway 绑定到远程 Server，并写入 auth.json')
  .option('--server-url <url>', 'Server 基础地址；默认读取 TETHER_SERVER_URL')
  .option('--env <env>', '登录环境：local 或 prod；默认 prod')
  .action(async (options: { serverUrl?: string; env?: string }) => {
    await performGatewayLogin({ ...options, env: parseGatewayLoginEnvOption(options.env) });
  });

gatewayCommand
  .command('start')
  .description('通过 launchd 在后台启动 Gateway（无配置时自动初始化）')
  .action(async () => {
    await startGatewayBackground();
  });

gatewayCommand
  .command('stop')
  .description('通过 launchd 停止 Gateway')
  .action(async () => {
    await stopLaunchAgent();
    console.log('Gateway 已停止。');
  });

gatewayCommand
  .command('restart')
  .description('通过 launchd 重启 Gateway')
  .action(async () => {
    await restartLaunchAgent();
    console.log('Gateway 已重启。');
  });

gatewayCommand
  .command('status')
  .description('打印 Gateway 状态')
  .action(async () => {
    await printGatewayStatus();
  });

gatewayCommand
  .command('logs')
  .description('查看 Gateway launchd 日志')
  .option('-f, --follow', '持续跟随日志输出')
  .option('--stderr', '只显示 stderr 日志')
  .option('--stdout', '只显示 stdout 日志')
  .action(async (options: { follow?: boolean; stderr?: boolean; stdout?: boolean }) => {
    await showGatewayLogs(options);
  });

program
  .command('doctor')
  .description('全面诊断 Tether 运行环境（Node、sqlite、node-pty、launchd、Gateway、provider）')
  .action(async () => {
    await runGatewayDoctor();
  });

program
  .command('run')
  .argument('<provider>')
  .argument('[providerArgs...]')
  .description('为指定 provider 启动一个 PTY event-stream session')
  .option('--project <path>', '项目目录', process.cwd())
  .option('--title <title>', '前端展示的 session 标题')
  .option('--no-attach', '只启动 session，不接入当前终端')
  .option('--no-reconnect', '本地 attach 断开后不自动重连')
  .allowUnknownOption(true)
  .action((providerName: string, providerArgs: string[], options: StartOptions) => {
    const provider = isProviderName(providerName) ? PROVIDERS[providerName] : { name: providerName, command: providerName };
    return startProviderSession(provider, { ...options, providerArgs });
  });

async function startProviderSession(provider: ProviderDefinition, options: StartOptions): Promise<void> {
  const gatewayUrl = await findPersistentGateway();
  if (!gatewayUrl) {
    throw new Error('未检测到常驻 Gateway。\n请先运行：tether gateway start');
  }
  const session = await createSessionViaGateway(provider, options, gatewayUrl);
  const remoteUrl = `${gatewayUrl}/remote/session/${session.id}`;
  console.log(`Tether session: ${session.id}`);
  console.log(`Remote URL: ${remoteUrl}`);
  if (options.attach) {
    const gateway = new URL(gatewayUrl);
    const result = await attachPtySession(session.id, {
      host: gateway.hostname,
      port: Number(gateway.port),
      mode: 'control',
      reconnect: options.reconnect
    });
    if (result === 'detached') {
      console.error(`已断开本地 attach。常驻 Gateway 仍在托管 ${remoteUrl}`);
    }
  }
}

async function findPersistentGateway(): Promise<string | undefined> {
  const urls = await gatewayCandidateUrls();
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

async function gatewayCandidateUrls(): Promise<string[]> {
  const config = resolveGatewayConfig();
  const candidates = new Set<string>();
  for (const record of await listGateways()) {
    candidates.add(record.url);
  }
  candidates.add(`http://${config.host}:${config.port}`);
  return [...candidates];
}

async function createSessionViaGateway(
  provider: ProviderDefinition,
  options: Pick<StartOptions, 'project' | 'title' | 'providerArgs'>,
  gatewayUrl: string
): Promise<CreatedGatewaySession> {
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
    throw new Error('常驻 Gateway 当前未启用 API session creation。请在 ~/.tether/config.json 中开启 gateway.allowApiSessionCreate 后重启 Gateway。');
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
  .option('--host <host>', 'Gateway 地址', '127.0.0.1')
  .option('--port <port>', 'Gateway 端口', parsePort, 4789)
  .option('--control', '作为控制端接入')
  .option('--observe', '作为观察端接入')
  .option('--no-reconnect', 'Gateway 重启或连接断开后不自动重连')
  .description('把当前终端接入已有 session')
  .action(async (id: string, options: { host: string; port: number; control?: boolean; observe?: boolean; reconnect?: boolean }) => {
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
  .description('列出已知 session')
  .action(async () => {
    const gatewaySessions = await fetchGatewaySessions().catch(() => undefined);
    const store = new Store();
    const sessions = gatewaySessions ?? store.listSessions();
    if (!gatewaySessions) {
      console.warn('未能连接常驻 Gateway，以下为本地历史状态，可能未对账。');
    }
    for (const session of sessions) {
      const alive = session.transport === 'tmux' && session.tmuxSessionName
        ? await sessionExists(session.tmuxSessionName)
        : session.status === 'running';
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
  .option('--host <host>', 'Gateway 地址', '127.0.0.1')
  .option('--port <port>', 'Gateway 端口', parsePort, 4789)
  .description('列出接入某个 PTY event-stream session 的客户端')
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
  .option('--host <host>', 'URL 中展示的 host；默认使用局域网地址')
  .option('--port <port>', 'Gateway 端口', parsePort, 4789)
  .description('打印某个 session 的远程访问 URL')
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
  .description('向已有 session 发送文本')
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
  .option('--all', '停止所有运行中的 session')
  .option('--host <host>', 'Gateway 地址', '127.0.0.1')
  .option('--port <port>', 'Gateway 端口', parsePort, 4789)
  .description('停止运行中的 session')
  .action(async (id: string | undefined, options: { all?: boolean; host: string; port: number }) => {
    const store = new Store();
    if (options.all) {
      const gatewayUrl = await stopGatewayUrl(options);
      const sessions = gatewayUrl ? await fetchGatewaySessions(gatewayUrl).catch(() => store.listSessions()) : store.listSessions();
      const ids = runningSessionIds(sessions);
      for (const sessionId of ids) {
        await stopSession(store, sessionId, options, gatewayUrl);
        console.log(`已关闭 ${sessionId}`);
      }
      console.log(`已关闭 ${ids.length} 个 session。`);
      return;
    }
    if (!id) {
      throw new Error('missing session id; use `tether stop <id>` or `tether stop --all`');
    }
    const result = await stopSession(store, id, options, await stopGatewayUrl(options));
    console.log(result === 'already-stopped' ? `${id} 已经不是 running 状态。` : `已关闭 ${id}`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(formatTmuxError(error));
  process.exitCode = 1;
});

async function stopGatewayUrl(options: { host: string; port: number }): Promise<string | undefined> {
  return await findPersistentGateway().catch(() => undefined) ?? `http://${options.host}:${options.port}`;
}

async function stopSession(
  store: Store,
  id: string,
  options: { host: string; port: number },
  gatewayUrl = `http://${options.host}:${options.port}`
): Promise<'stopped' | 'already-stopped'> {
  const session = store.getSession(id);
  if (!session) {
    throw new Error(`unknown session: ${id}`);
  }
  if (session.status !== 'running') {
    return 'already-stopped';
  }
  if (session.transport === 'pty-event-stream') {
    const gatewayStopped = await stopPtySessionViaGateway(id, gatewayUrl);
    if (gatewayStopped) {
      return 'stopped';
    }
    if (session.runnerSocketPath) {
      await stopPtySessionViaRunner(session.runnerSocketPath);
      return 'stopped';
    }
    throw new Error('未检测到可用 Gateway，也没有本机 runner socket，无法停止这个 session。请先运行 `tether gateway` 后重试。');
  }
  await sendKeys(session.tmuxSessionName, 'C-c');
  return 'stopped';
}

async function stopPtySessionViaGateway(id: string, gatewayUrl: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      headers: await gatewayAuthHeaders()
    });
  } catch {
    return false;
  }
  if (response.ok) {
    return true;
  }
  if ([404, 410, 503].includes(response.status)) {
    return false;
  }
  throw new Error(`stop failed: HTTP ${response.status}`);
}

async function stopPtySessionViaRunner(socketPath: string): Promise<void> {
  const client = new SessionRunnerClient({ socketPath });
  try {
    await client.stop('cli-stop');
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function fetchGatewaySessions(gatewayUrl?: string): Promise<CliSession[]> {
  const url = gatewayUrl ?? await findPersistentGateway();
  if (!url) {
    throw new Error('missing gateway');
  }
  const response = await fetch(`${url}/api/sessions?all=1`, {
    headers: await gatewayAuthHeaders()
  });
  if (!response.ok) {
    throw new Error(`gateway sessions failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { sessions?: CliSession[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}

async function startGatewayBackground(): Promise<void> {
  let profile = gatewayProfileFromEnv();
  if (!fs.existsSync(configPath())) {
    const chosen = await promptGatewayProfile('首次启动，请选择运行模式');
    const existing = readTetherConfig();
    const next: TetherConfig = { ...defaultTetherConfig(chosen), providers: existing.providers };
    await writeTetherConfig(next);
    console.log(`配置已写入：${configPath()}`);
    profile ??= chosen;
  }
  profile ??= 'relay';
  await ensureGatewayAuthForProfile(profile);
  const before = await launchAgentStatus();
  const status = await startLaunchAgent({ env: { ...process.env, TETHER_GATEWAY_PROFILE: profile } });
  if (!before.installed) {
    console.log(`LaunchAgent 已安装：${status.path}`);
  }
  console.log(`启动模式: ${profile}`);
  console.log(`Gateway 已在后台启动：${status.path}`);
}

async function startGatewayForeground(profile?: GatewayProfileName): Promise<void> {
  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({
    file,
    profile
  });
  await assertGatewayPortAvailable(resolved.gateway.host, resolved.gateway.port);
  await ensureGatewayAuthForProfile(resolved.profile);
  const store = new Store();
  const ptySessions = new PtySessionManager(store);
  const daemon = await startDaemon({
    host: resolved.gateway.host,
    port: resolved.gateway.port,
    store,
    ptySessions,
    allowApiSessionCreate: resolved.gateway.allowApiSessionCreate,
    relay: relayConfig(file, resolved.profile),
    config: file
  });
  console.log(`Gateway 模式: ${resolved.profile}`);
  console.log(`Tether Gateway: ${daemon.url}`);
  if (resolved.profile === 'direct') {
    console.log(`Web 直连地址: http://${localLanAddress() ?? '你的Mac局域网IP'}:${resolved.gateway.port}`);
  }
  if (resolved.relay) {
    console.log(`Relay: ${resolved.relay.url}`);
  } else {
    console.log('Relay: 未启用');
  }
  console.log('Gateway 正在运行。按 Ctrl-C 停止。');
  await waitForShutdown();
  await daemon.close();
}

async function ensureGatewayAuthForProfile(profile: GatewayProfileName): Promise<void> {
  if (profile === 'local') {
    return;
  }
  const existing = await readGatewayAuthState().catch(() => undefined);
  if (existing && existing.expiresAt > Date.now()) {
    return;
  }
  console.log(profile === 'relay'
    ? 'Relay 模式需要先绑定 Gateway 账号。'
    : 'Direct 模式需要先绑定 Gateway 账号。');
  await performGatewayLogin({});
}

async function assertGatewayPortAvailable(host: string, port: number): Promise<void> {
  const probeHost = host === '0.0.0.0' ? undefined : host;
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(
          `Gateway 启动失败：${host}:${port} 已被占用。\n` +
          '通常是已有 Gateway 正在运行。先执行：pnpm tether gateway status\n' +
          '如果确认要重启，执行：pnpm tether gateway stop，然后再启动。'
        ));
        return;
      }
      reject(error);
    });
    server.once('listening', () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server.listen(port, probeHost);
  });
}

function relayConfig(file?: TetherConfig, profile?: GatewayProfileName):
  | { url: string; secret: string }
  | undefined {
  const config = file ?? readTetherConfig();
  const relay = resolveRelayConfig({
    file: config,
    profile
  });
  if (!relay) {
    return undefined;
  }
  return relay;
}

async function printGatewayStatus(): Promise<void> {
  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({ file });
  const gatewayConfig = resolved.gateway;
  const relay = resolved.relay;
  const launchd = await getLaunchAgentStatus();
  const registryRecords = await listGateways();
  const gatewayProbeUrl = gatewayApiUrl(gatewayConfig.host, gatewayConfig.port);
  const api = await fetchFirstGatewayStatus([
    ...registryRecords.map((record) => record.url),
    gatewayProbeUrl
  ]);
  const registry = registryRecords[0];
  const url = stringValue(api?.url) ?? registry?.url ?? `http://${gatewayConfig.host}:${gatewayConfig.port}`;
  const host = stringValue(api?.host) ?? registry?.host ?? gatewayConfig.host;
  const port = numberValue(api?.port) ?? registry?.port ?? gatewayConfig.port;
  const pid = numberValue(api?.pid) ?? launchd.pid ?? registry?.pid;
  const relayConfigured = booleanValue(api?.relay?.configured) ?? Boolean(relay);
  const relayState = stringValue(api?.relay?.state);

  console.log('Gateway 状态');
  console.log(`默认模式: ${resolved.profile}`);
  console.log(`运行状态: ${api ? '运行中' : '已停止或不可连接'}`);
  console.log(`PID: ${pid ?? '-'}`);
  console.log(`URL: ${url}`);
  console.log(`配置文件: ${configPath()}`);
  console.log(`Server: ${resolved.serverUrl}`);
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`Relay 配置: ${relayConfigured ? '已配置' : '未配置'}`);
  console.log(`Relay 连接: ${relayState ?? '未确认'}`);
  console.log(`后台 PATH: ${formatGatewayPathStatus(api)}`);
  console.log(`Provider 命令: ${formatProviderCommands(file)}`);
  console.log(`LaunchAgent: ${formatLaunchAgentStatus(launchd)}`);
}

async function deleteGatewayDatabase(options: { yes?: boolean }): Promise<void> {
  if (options.yes !== true) {
    throw new Error('删除数据库会清空 session 历史和回放数据。确认删除请加：--yes');
  }

  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({ file });
  const gatewayConfig = resolved.gateway;
  const launchd = await getLaunchAgentStatus();
  const registryRecords = await listGateways();
  const running = await fetchFirstGatewayStatus([
    ...registryRecords.map((record) => record.url),
    gatewayApiUrl(gatewayConfig.host, gatewayConfig.port)
  ]);

  if (running || launchd.loaded || launchd.pid) {
    throw new Error(
      'Gateway 仍在运行，不能删除正在使用的 SQLite 数据库。\n' +
      '先执行：pnpm tether gateway stop\n' +
      '确认 status 显示已停止后，再执行：pnpm tether gateway delete-db --yes'
    );
  }

  const dbPath = defaultDbPath();
  const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const deleted: string[] = [];
  for (const filePath of paths) {
    if (fs.existsSync(filePath)) {
      await rm(filePath, { force: true });
      deleted.push(filePath);
    }
  }

  if (deleted.length === 0) {
    console.log(`未找到 Gateway 数据库：${dbPath}`);
    return;
  }

  console.log('已删除 Gateway 数据库文件：');
  for (const filePath of deleted) {
    console.log(`- ${filePath}`);
  }
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
  const gatewayUrl = gatewayApiUrl(gateway.host, gateway.port);
  const api = await fetchFirstGatewayStatus([gatewayUrl]);
  const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];
  const pushCheck = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, status: ok ? 'ok' : 'fail', detail });
  };
  // runtime 基础检查（先做，与 Gateway 状态无关）
  const nodeVersion = process.versions.node;
  const [maj, min] = nodeVersion.split('.').map(Number);
  const nodeOk = maj > 22 || (maj === 22 && min >= 13);
  pushCheck('Node 版本', nodeOk, `${nodeVersion}（要求 >= 22.13）`);
  pushCheck('runtime 模式', true, detectRuntimeMode());
  const sqliteCheck = await checkNodeSqlite();
  checks.push({ name: 'node:sqlite', status: sqliteCheck.ok ? 'ok' : 'fail', detail: sqliteCheck.detail });
  const ptyCheck = checkNodePty();
  checks.push({ name: 'node-pty', status: ptyCheck.ok ? 'ok' : 'fail', detail: ptyCheck.detail });
  for (const runtime of checkGatewayRuntimeInfo()) {
    checks.push(runtime);
  }
  checks.push({ name: 'Gateway DB', status: 'ok', detail: gatewayDbSummary() });
  // 配置 & launchd
  pushCheck('配置文件', fs.existsSync(configPath()), configPath());
  pushCheck('LaunchAgent 已安装', launchd.installed, launchd.path);
  pushCheck('LaunchAgent 已加载', launchd.loaded, launchd.error ?? `PID ${launchd.pid ?? '-'}`);
  pushCheck('Gateway API 可连接', Boolean(api), gatewayUrl);
  pushCheck('API session creation', gateway.allowApiSessionCreate, gateway.allowApiSessionCreate ? '已开启' : '未开启');
  pushCheck('Relay 配置', Boolean(relay), relay ? relay.url : '未配置');
  pushCheck('Relay 连接', stringValue(api?.relay?.state) === 'connected', stringValue(api?.relay?.state) ?? '未确认');
  for (const provider of Object.values(PROVIDERS)) {
    const configuredCommand = (file.providers as Record<string, { command?: string } | undefined> | undefined)?.[provider.name]?.command;
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

function detectRuntimeMode(): string {
  return import.meta.url.includes('/dist/') ? 'prod (dist bundle)' : 'dev (源码 + tsx)';
}

async function checkNodeSqlite(): Promise<{ ok: boolean; detail: string }> {
  try {
    const mod = await import('node:sqlite');
    const db = new mod.DatabaseSync(':memory:');
    db.exec('SELECT 1');
    db.close();
    return { ok: true, detail: 'in-memory db open/close OK' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function checkNodePty(): { ok: boolean; detail: string } {
  // PtySessionManager 是 gateway 对 node-pty 的封装。能 import 到说明 gateway 已加载 node-pty。
  // 不直接 import('node-pty')，因为 cli 本身没有 node-pty 直接依赖，dynamic import 会失败。
  if (typeof PtySessionManager === 'function') {
    return { ok: true, detail: 'PtySessionManager 可用（gateway 已加载 node-pty）' };
  }
  return {
    ok: false,
    detail: 'PtySessionManager 未导出，可能 node-pty 加载失败。运行 npm rebuild node-pty 或确认已装 Xcode CLT'
  };
}

function checkGatewayRuntimeInfo(): Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> {
  const info = readGatewayRuntimeInfo();
  if (!info) {
    return [{
      name: 'gateway-runtime.json',
      status: 'warn',
      detail: `未找到 ${gatewayRuntimeJsonPath()}（运行 tether gateway install 后会写入）`
    }];
  }
  return [
    {
      name: 'plist nodePath',
      status: fs.existsSync(info.nodePath) ? 'ok' : 'fail',
      detail: `${info.nodePath}（plist 安装时记录 ${info.nodeVersion}）`
    },
    {
      name: 'plist launcher',
      status: fs.existsSync(info.launcherPath) ? 'ok' : 'fail',
      detail: info.launcherPath
    }
  ];
}

function gatewayDbSummary(): string {
  const dbPath = defaultDbPath();
  try {
    const stat = fs.statSync(dbPath);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);
    return `${dbPath} (${sizeMb} MB)`;
  } catch {
    return `${dbPath}（不存在）`;
  }
}

async function verifyGatewaySession(providerName: string): Promise<void> {
  if (!isProviderName(providerName)) {
    throw new Error(`unknown provider: ${providerName}`);
  }
  const gateway = resolveGatewayConfig();
  const gatewayUrl = gatewayApiUrl(gateway.host, gateway.port);
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

function gatewayApiUrl(host: string, port: number): string {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${connectHost}:${port}`;
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
  options: AttachPtySessionOptions
): Promise<'detached' | 'exited' | 'stopped'> {
  const mode = options.mode ?? 'control';
  const reconnect = options.reconnect !== false;
  let latestEventId = 0;
  let reconnectAttempt = 0;

  while (true) {
    let attempt: AttachAttemptResult;
    try {
      attempt = await attachPtySessionOnce(id, { ...options, mode }, latestEventId);
    } catch (error) {
      if (!reconnect || isAttachAuthError(error)) {
        throw error;
      }
      attempt = {
        status: 'reconnect',
        latestEventId,
        message: error instanceof Error ? error.message : 'Gateway 连接失败'
      };
    }

    latestEventId = Math.max(latestEventId, attempt.latestEventId);
    if (attempt.status === 'exited') {
      return 'exited';
    }
    if (attempt.status === 'stopped') {
      return 'stopped';
    }
    if (attempt.status === 'detached') {
      return 'detached';
    }
    if (attempt.status === 'lost') {
      throw new Error(attempt.message ?? 'session 已失联，无法自动重连');
    }
    if (!reconnect) {
      return 'detached';
    }

    reconnectAttempt += 1;
    const delayMs = Math.min(500 * reconnectAttempt, 5000);
    const reason = attempt.message ? `：${attempt.message}` : '';
    console.error(`\nGateway 连接断开${reason}。${delayMs}ms 后自动重连；当前输入不会发送。按 Ctrl-C 停止 session，按 Ctrl-A 只退出本地 attach。`);
    await sleep(delayMs);
  }
}

async function attachPtySessionOnce(
  id: string,
  options: Required<Pick<AttachPtySessionOptions, 'host' | 'port' | 'mode'>>,
  after: number
): Promise<AttachAttemptResult> {
  const ticket = await requestWsTicket(options, id, options.mode);
  const params = new URLSearchParams({
    surface: 'cli',
    mode: options.mode
  });
  if (after > 0) {
    params.set('after', String(after));
  }
  const url = `ws://${options.host}:${options.port}/api/sessions/${encodeURIComponent(id)}/stream?${params.toString()}`;
  const ws = new WebSocket(url, [`tether-ticket.${ticket}`]);
  let result: AttachAttemptResult = { status: 'reconnect', latestEventId: after };
  let localDetach = false;
  let localStop = false;
  let stopPromise: Promise<void> | undefined;

  const previousRawMode = process.stdin.isRaw;
  const wasStdinPaused = process.stdin.isPaused();
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  console.error('Attached to Tether PTY session. Press Ctrl-C to stop, Ctrl-A to detach.');
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  let terminalCleanedUp = false;
  const cleanupTerminal = () => {
    if (terminalCleanedUp) {
      return;
    }
    terminalCleanedUp = true;
    process.stdin.off('data', onData);
    process.stdout.off('resize', resize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(previousRawMode);
    }
    if (wasStdinPaused) {
      process.stdin.pause();
    }
    if (process.stdout.isTTY) {
      process.stdout.write(TERMINAL_RESET_SEQUENCE);
    }
  };
  const stopAttachedSession = () => {
    if (localStop) {
      return;
    }
    localStop = true;
    result = { status: 'stopped', latestEventId: result.latestEventId, message: `Session 已停止：${id}` };
    cleanupTerminal();
    console.error('\n正在停止 Tether session...');
    stopPromise = stopPtySessionViaGateway(id, `http://${options.host}:${options.port}`)
      .then((stopped) => {
        if (!stopped) {
          throw new Error('Gateway stop endpoint unavailable');
        }
      })
      .catch((error: unknown) => {
        result = {
          status: 'lost',
          latestEventId: result.latestEventId,
          message: `停止 session 失败：${error instanceof Error ? error.message : '未知错误'}`
        };
      })
      .finally(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'local stop');
        }
      });
  };
  const signalHandler = (signal: NodeJS.Signals) => {
    if (signal === 'SIGINT') {
      stopAttachedSession();
      return;
    }
    cleanupTerminal();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, `local ${signal}`);
    }
    process.exit(143);
  };

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
    if (chunk.includes(0x03)) {
      stopAttachedSession();
      return;
    }
    if (chunk.includes(LOCAL_DETACH_KEY.charCodeAt(0))) {
      localDetach = true;
      result = { status: 'detached', latestEventId: result.latestEventId, message: `已退出本地 attach，session 继续运行：${id}` };
      ws.close(1000, 'local detach');
      return;
    }
    if (options.mode !== 'observe' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: chunk.toString('utf8') }));
    }
  };
  process.stdin.on('data', onData);
  process.stdout.on('resize', resize);
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  process.once('SIGHUP', signalHandler);
  resize();

  await new Promise<void>((resolve, reject) => {
    ws.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as {
        type?: string;
        latestEventId?: unknown;
        event?: { id?: unknown; type?: string; payload?: { data?: unknown } };
      };
      if (typeof frame.latestEventId === 'number') {
        result.latestEventId = Math.max(result.latestEventId, frame.latestEventId);
      }
      if (typeof frame.event?.id === 'number') {
        result.latestEventId = Math.max(result.latestEventId, frame.event.id);
      }
      if (frame.type === 'event' && frame.event?.type === 'terminal.output') {
        const data = frame.event.payload?.data;
        if (typeof data === 'string') {
          process.stdout.write(data);
        }
        return;
      }
      if (frame.type === 'event' && frame.event?.type === 'session.exited') {
        result = { status: 'exited', latestEventId: result.latestEventId, message: `Session 已停止：${id}` };
        ws.close();
      }
    });
    ws.once('close', (code, reasonBuffer) => {
      if (result.status === 'exited' || result.status === 'stopped' || localDetach || localStop) {
        resolve();
        return;
      }
      const reason = reasonBuffer.toString();
      if (reason.includes('session_lost')) {
        result = {
          status: 'lost',
          latestEventId: result.latestEventId,
          message: `Session 已失联：${id}。Gateway 已恢复，但这个 session runner 不可连接`
        };
      } else {
        result = {
          status: 'reconnect',
          latestEventId: result.latestEventId,
          message: closeReasonMessage(code, reason)
        };
      }
      resolve();
    });
    ws.once('error', reject);
  }).finally(() => {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    process.off('SIGHUP', signalHandler);
    cleanupTerminal();
  });
  await stopPromise;
  if ((result.status === 'detached' || result.status === 'exited' || result.status === 'stopped' || result.status === 'lost') && result.message) {
    console.error(`\n${result.message}`);
  }
  return result;
}

function closeReasonMessage(code: number, reason: string): string {
  if (reason) {
    return `WebSocket ${code} ${reason}`;
  }
  return `WebSocket ${code}`;
}

function isAttachAuthError(error: unknown): boolean {
  return error instanceof Error && /ticket failed: HTTP (401|403)/.test(error.message);
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

async function performGatewayLogin(options: {
  serverUrl?: string;
  env?: GatewayLoginEnv;
}): Promise<void> {
  const serverUrl = resolveGatewayLoginServerUrl(options);
  if (!serverUrl) {
    throw new Error('缺少 Server URL。请先执行 tether gateway init，或传 --server-url');
  }
  const port = await findAvailablePort();
  const hostname = os.hostname();
  const browserUrl = `${serverUrl}/gateway-auth?port=${port}&hostname=${encodeURIComponent(hostname)}`;
  console.log('正在打开浏览器进行授权...');
  console.log(`如果浏览器未自动打开，请访问：${browserUrl}`);
  openBrowser(browserUrl);
  const result = await waitForGatewayAuthCallback(port, 120_000);
  const payload = decodeTokenPayload(result.gatewayAccessToken);
  if (!payload || typeof payload.expiresAt !== 'number') {
    throw new Error('Gateway 登录失败：access token 缺少 expiresAt');
  }
  await writeGatewayAuthState({
    serverUrl,
    gatewayId: result.gatewayId,
    accountId: result.accountId,
    workspaceId: result.workspaceId,
    accessToken: result.gatewayAccessToken,
    refreshToken: result.gatewayRefreshToken,
    expiresAt: payload.expiresAt
  });
  console.log(`Gateway 登录成功，凭据已写入：${gatewayAuthPath()}`);
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

type GatewayAuthCallbackResult = {
  gatewayId: string;
  accountId: string;
  workspaceId: string;
  gatewayAccessToken: string;
  gatewayRefreshToken: string;
};

async function waitForGatewayAuthCallback(port: number, timeoutMs: number): Promise<GatewayAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Gateway 授权超时（2 分钟），请重试'));
    }, timeoutMs);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const get = (k: string) => url.searchParams.get(k);
      const gatewayId = get('gatewayId');
      const accountId = get('accountId');
      const workspaceId = get('workspaceId');
      const gatewayAccessToken = get('gatewayAccessToken');
      const gatewayRefreshToken = get('gatewayRefreshToken');

      if (!gatewayId || !accountId || !workspaceId || !gatewayAccessToken || !gatewayRefreshToken) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
          .end('<html><body>授权失败：参数缺失。</body></html>');
        clearTimeout(timer);
        server.close();
        reject(new Error('Gateway 授权失败：回调缺少必要参数'));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        '<html><body style="font-family:sans-serif;padding:2em"><h2>授权成功</h2><p>可以关闭此窗口，返回终端。</p></body></html>'
      );
      clearTimeout(timer);
      server.close();
      resolve({ gatewayId, accountId, workspaceId, gatewayAccessToken, gatewayRefreshToken });
    });

    server.listen(port, '127.0.0.1');
  });
}

function resolveGatewayLoginServerUrl(options: {
  serverUrl?: string;
  env?: GatewayLoginEnv;
}): string {
  const normalized = normalizeServerUrl(
    options.serverUrl ??
    process.env.TETHER_SERVER_URL ??
    (options.env === 'local' ? LOCAL_SERVER_URL : DEFAULT_SERVER_URL)
  );
  if (!normalized) {
    throw new Error('Gateway 登录失败：缺少 Server URL');
  }
  return normalized;
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

function resolvePackageVersion(startUrl: string, packageName: string): string | undefined {
  let current = path.dirname(fileURLToPath(startUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(current, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown; version?: unknown };
        if (parsed.name === packageName && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        return undefined;
      }
    }
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return undefined;
}

async function promptLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function parseGatewayLoginEnvOption(env: string | undefined): GatewayLoginEnv | undefined {
  if (!env) {
    return undefined;
  }
  if (env === 'local' || env === 'prod') {
    return env;
  }
  throw new Error(`未知 Gateway 登录环境：${env}`);
}

async function promptGatewayProfile(title: string): Promise<GatewayProfileName> {
  console.log(title);
  console.log('1. local  - 开发人员本机调试：只监听 127.0.0.1，不给局域网访问');
  console.log('2. direct - 局域网直连：监听 0.0.0.0，浏览器直接连本机 Gateway，不走 Relay');
  console.log('3. relay  - 公网远程：本机 Gateway 主动连接 Relay，适合不在同一局域网时使用');
  const answer = await promptLine('输入 1/2/3 或 local/direct/relay（默认 relay）: ');
  if (!answer) {
    return 'relay';
  }
  if (answer === '1' || answer === 'local') {
    return 'local';
  }
  if (answer === '2' || answer === 'direct') {
    return 'direct';
  }
  if (answer === '3' || answer === 'relay') {
    return 'relay';
  }
  if (isGatewayProfileName(answer)) {
    return answer;
  }
  throw new Error(`未知 Gateway 启动模式：${answer}`);
}

function gatewayProfileFromEnv(): GatewayProfileName | undefined {
  const profile = process.env.TETHER_GATEWAY_PROFILE;
  if (!profile) {
    return undefined;
  }
  if (isGatewayProfileName(profile)) {
    return profile;
  }
  throw new Error(`未知 Gateway 启动模式：${profile}`);
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
}
