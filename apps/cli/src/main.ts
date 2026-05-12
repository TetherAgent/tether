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
  formatTmuxError,
  listGateways,
  localLanAddress,
  PtySessionManager,
  startDaemon,
} from '@tether/gateway';
import { isProviderName, PROVIDERS, type ProviderDefinition } from '@tether/core';
import * as terminal from './terminal.js';
import {
  gatewayRuntimeJsonPath,
  installLaunchAgent,
  launchAgentPath,
  launchAgentStatus,
  readGatewayRuntimeInfo,
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
  serverHeartbeat?: {
    lastOkAt?: unknown;
    lastError?: unknown;
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
const GATEWAY_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

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
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type DeviceState = {
  deviceKey: string;
  deviceName: string;
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
  .command('logout')
  .description('删除本机 Gateway 登录凭据，不解绑服务端 Gateway')
  .action(async () => {
    await logoutGateway();
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
    await stopGatewayBackground();
    terminal.success('Gateway 已停止。');
  });

gatewayCommand
  .command('restart')
  .description('通过 launchd 重启 Gateway')
  .action(async () => {
    await stopGatewayBackground();
    await startGatewayBackground();
    terminal.success('Gateway 已重启。');
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
  .description('全面诊断 Tether 运行环境（Node、node-pty、launchd、Gateway、provider）')
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
  const relay = resolveRelayConfig({ file: readTetherConfig() });
  if (!relay) {
    throw new Error('当前 Gateway 未配置 Relay，无法通过 relay 创建 PTY session。请切到 relay 模式后重试。');
  }
  const auth = await readFreshGatewayAuthState();
  const payload = decodeTokenPayload(auth.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined;
  if (!gatewayId) {
    throw new Error('gateway access token 缺少 gatewayId，请重新执行 tether gateway login。');
  }
  const session = await createSessionViaRelay(provider, options, relay.url, auth.accessToken, gatewayId);
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

async function listSessionsViaRelay(relayUrl: string, accessToken: string): Promise<CliSession[]> {
  const ws = new WebSocket(relayClientUrl(relayUrl));
  return await new Promise<CliSession[]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, sessions?: CliSession[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
      } else {
        resolve(sessions ?? []);
      }
    };
    const timer = setTimeout(() => {
      finish(new Error('relay auth timeout'));
    }, 5_000);
    ws.once('error', (err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    });
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        finish(new Error(`relay auth failed: ${String(frame.message ?? 'unknown error')}`));
        return;
      }
      if (frame.type === 'client.auth.ok') {
        clearTimeout(timer);
        const listTimer = setTimeout(() => finish(new Error('relay list timeout')), 5_000);
        ws.once('close', () => clearTimeout(listTimer));
        ws.send(JSON.stringify({ type: 'client.list' }));
        return;
      }
      if (frame.type === 'sessions') {
        finish(undefined, Array.isArray(frame.sessions) ? frame.sessions as CliSession[] : []);
        return;
      }
      if (frame.type === 'error') {
        finish(new Error(String(frame.message ?? frame.code ?? 'relay error')));
      }
    });
  });
}

async function createSessionViaRelay(
  provider: ProviderDefinition,
  options: Pick<StartOptions, 'project' | 'title' | 'providerArgs'>,
  relayUrl: string,
  accessToken: string,
  gatewayId: string
): Promise<CreatedGatewaySession> {
  const ws = new WebSocket(relayClientUrl(relayUrl));
  return await new Promise<CreatedGatewaySession>((resolve, reject) => {
    let authOk = false;
    let settled = false;
    const finish = (error?: Error, session?: CreatedGatewaySession) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(session as CreatedGatewaySession);
    };
    const timer = setTimeout(() => {
      finish(new Error(authOk ? 'relay PTY session create timeout' : 'relay auth timeout'));
    }, authOk ? 10_000 : 5_000);
    ws.once('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    });
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        finish(new Error(`relay auth failed: ${String(frame.message ?? 'unknown error')}`));
        return;
      }
      if (!authOk && frame.type === 'client.auth.ok') {
        authOk = true;
        clearTimeout(timer);
        const createTimer = setTimeout(() => {
          finish(new Error('relay PTY session create timeout'));
        }, 10_000);
        ws.send(JSON.stringify({
          type: 'client.new-pty-session',
          provider: provider.name,
          command: provider.command,
          cwd: path.resolve(options.project ?? process.cwd()),
          cols: process.stdout.columns ?? 120,
          rows: process.stdout.rows ?? 40,
          gatewayId,
          ...(typeof options.title === 'string' ? { title: options.title } : {}),
          ...(Array.isArray(options.providerArgs) && options.providerArgs.length > 0
            ? { providerArgs: options.providerArgs }
            : {})
        }));
        ws.once('close', () => clearTimeout(createTimer));
        return;
      }
      if (frame.type === 'gateway.session-created' && typeof frame.sessionId === 'string') {
        finish(undefined, { id: frame.sessionId });
        return;
      }
      if (frame.type === 'error') {
        finish(new Error(`session create error: ${String(frame.message ?? frame.code ?? 'unknown error')}`));
      }
    });
  });
}

program
  .command('ls')
  .description('列出已知 session')
  .action(async () => {
    const relay = resolveRelayConfig({ file: readTetherConfig() });
    if (!relay) {
      throw new Error('当前 Gateway 未配置 Relay，无法列出 session。');
    }
    const auth = await readFreshGatewayAuthState();
    const sessions = await listSessionsViaRelay(relay.url, auth.accessToken).catch((error: unknown) => {
      throw new Error(`无法连接 Relay：${String(error)}`);
    });
    for (const session of sessions) {
      console.log(`${session.id}\t${session.status}\t${session.transport}\t${session.projectPath}`);
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
    const host = options.host ?? localLanAddress() ?? '127.0.0.1';
    console.log(`http://${host}:${options.port}/remote/session/${id}`);
  });

program
  .command('send')
  .argument('<id>')
  .argument('<text>')
  .description('向已有 session 发送文本')
  .action(async (id: string, text: string) => {
    const gatewayUrl = await findPersistentGateway();
    if (!gatewayUrl) {
      throw new Error('未检测到常驻 Gateway。\n请先运行：tether gateway start');
    }
    const response = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(id)}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await gatewayAuthHeaders()) },
      body: JSON.stringify({ data: `${text}\r` })
    });
    if (!response.ok) {
      throw new Error(`send failed: HTTP ${response.status}`);
    }
  });

program
  .command('stop')
  .argument('[id]')
  .option('--all', '停止所有运行中的 session')
  .option('--host <host>', 'Gateway 地址', '127.0.0.1')
  .option('--port <port>', 'Gateway 端口', parsePort, 4789)
  .description('停止运行中的 session')
  .action(async (id: string | undefined, options: { all?: boolean; host: string; port: number }) => {
    if (options.all) {
      const gatewayUrl = await stopGatewayUrl(options);
      const sessions = await fetchGatewaySessions(gatewayUrl);
      const ids = runningSessionIds(sessions);
      for (const sessionId of ids) {
        await stopSession(sessionId, gatewayUrl);
        console.log(`已关闭 ${sessionId}`);
      }
      console.log(`已关闭 ${ids.length} 个 session。`);
      return;
    }
    if (!id) {
      throw new Error('missing session id; use `tether stop <id>` or `tether stop --all`');
    }
    const result = await stopSession(id, await stopGatewayUrl(options));
    console.log(result === 'already-stopped' ? `${id} 已经不是 running 状态。` : `已关闭 ${id}`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(formatTmuxError(error));
  process.exitCode = 1;
});

async function stopGatewayUrl(options: { host: string; port: number }): Promise<string> {
  return await findPersistentGateway().catch(() => undefined) ?? `http://${options.host}:${options.port}`;
}

async function stopSession(id: string, gatewayUrl: string): Promise<'stopped' | 'already-stopped'> {
  const sessions = await fetchGatewaySessions(gatewayUrl);
  const session = sessions.find((item) => item.id === id);
  if (!session) {
    throw new Error(`unknown session: ${id}`);
  }
  if (session.status !== 'running') {
    return 'already-stopped';
  }
  const gatewayStopped = await stopPtySessionViaGateway(id, gatewayUrl);
  if (!gatewayStopped) {
    throw new Error(`stop failed: ${id}`);
  }
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
    const chosen = profile ?? 'relay';
    const existing = readTetherConfig();
    const next: TetherConfig = { ...defaultTetherConfig(chosen), providers: existing.providers };
    await writeTetherConfig(next);
    terminal.success(`配置已写入：${configPath()}`);
    profile = chosen;
  }
  profile ??= 'relay';
  await ensureGatewayAuthForProfile(profile);
  const before = await launchAgentStatus();
  const status = await startLaunchAgent({ env: { ...process.env, TETHER_GATEWAY_PROFILE: profile } });
  const gatewayStatus = await waitForStartedGateway(profile);
  if (!before.installed) {
    terminal.success(`LaunchAgent 已安装：${status.path}`);
  }
  terminal.section('Gateway 启动');
  terminal.line('启动模式', profile);
  terminal.line('Gateway 状态', `运行中 (${stringValue(gatewayStatus.url) ?? 'URL 未知'})`);
  if (profile === 'relay') {
    terminal.line('Relay 连接', formatRelayConnectionState(stringValue(gatewayStatus.relay?.state)));
  }
  terminal.success(`Gateway 已在后台启动：${status.path}`);
}

async function startGatewayForeground(profile?: GatewayProfileName): Promise<void> {
  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({
    file,
    profile
  });
  await assertGatewayPortAvailable(resolved.gateway.host, resolved.gateway.port);
  await ensureGatewayAuthForProfile(resolved.profile);
  const ptySessions = new PtySessionManager();
  const daemon = await startDaemon({
    host: resolved.gateway.host,
    port: resolved.gateway.port,
    ptySessions,
    allowApiSessionCreate: resolved.gateway.allowApiSessionCreate,
    relay: relayConfig(file, resolved.profile),
    config: file
  });
  terminal.section('Gateway 前台运行');
  terminal.line('Gateway 模式', resolved.profile);
  terminal.line('Tether Gateway', daemon.url);
  if (resolved.profile === 'direct') {
    terminal.line('Web 直连地址', `http://${localLanAddress() ?? '你的Mac局域网IP'}:${resolved.gateway.port}`);
  }
  if (resolved.relay) {
    terminal.line('Relay', resolved.relay.url);
  } else {
    terminal.line('Relay', '未启用');
  }
  terminal.success('Gateway 正在运行。按 Ctrl-C 停止。');
  await waitForShutdown();
  await daemon.close();
}

async function stopGatewayBackground(): Promise<void> {
  await stopLaunchAgent();

  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({ file });
  const gatewayConfig = resolved.gateway;
  const registryRecords = await listGateways();
  const status = await fetchFirstGatewayStatus([
    ...registryRecords.map((record) => record.url),
    gatewayApiUrl(gatewayConfig.host, gatewayConfig.port)
  ]);
  const pid = numberValue(status?.pid);
  if (!pid || pid === process.pid) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ESRCH') {
      return;
    }
    throw error;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    const stillRunning = await fetchFirstGatewayStatus([
      ...registryRecords.map((record) => record.url),
      gatewayApiUrl(gatewayConfig.host, gatewayConfig.port)
    ]);
    if (!stillRunning) {
      return;
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ESRCH') {
      throw error;
    }
  }
}

async function ensureGatewayAuthForProfile(profile: GatewayProfileName): Promise<void> {
  if (profile === 'local') {
    return;
  }
  const existing = await readFreshGatewayAuthState().catch(() => undefined);
  if (existing && existing.expiresAt > Date.now()) {
    return;
  }
  throw new Error(
    `${profile === 'relay' ? 'Relay' : 'Direct'} 模式需要先绑定 Gateway 账号。\n` +
    '请先执行：tether gateway login\n' +
    '登录成功后再执行：tether gateway start'
  );
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
  const authSummary = await gatewayAuthSummary();
  const deviceState = await loadOrCreateDeviceState();
  const hostname = os.hostname();

  terminal.section('Gateway 状态');
  terminal.line('默认模式', resolved.profile);
  terminal.line('本机 Gateway 进程', api ? '运行中' : '已停止或无法连接');
  terminal.line('PID', pid);
  terminal.line('URL', url);
  terminal.line('配置文件', configPath());
  terminal.line('Server', resolved.serverUrl);
  terminal.line('Server 登录', authSummary.state);
  terminal.line('Gateway ID', authSummary.gatewayId);
  terminal.line('Account ID', authSummary.accountId);
  terminal.line('Device Key', deviceState.deviceKey);
  terminal.line('Hostname', hostname);
  terminal.line('Token 过期时间', authSummary.expiresAt ? new Date(authSummary.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '-');
  terminal.line('Host', host);
  terminal.line('Port', port);
  terminal.line('Relay 配置', relayConfigured ? '已配置' : '未配置');
  terminal.line('Relay 连接', formatRelayConnectionState(relayState));
  terminal.line('最近 Server 心跳', formatGatewayServerHeartbeat(api));
  terminal.line('后台 PATH', formatGatewayPathStatus(api));
  terminal.line('Provider 命令', formatProviderCommands(file));
  terminal.line('LaunchAgent', formatLaunchAgentStatus(launchd));
}

async function waitForStartedGateway(profile: GatewayProfileName): Promise<GatewayStatus> {
  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({ file, profile });
  const url = gatewayApiUrl(resolved.gateway.host, resolved.gateway.port);
  let lastStatus: GatewayStatus | undefined;

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const status = await fetchGatewayStatusBody(url);
    if (status) {
      lastStatus = status;
      if (profile !== 'relay' || stringValue(status.relay?.state) === 'connected') {
        return status;
      }
    }
    await sleep(500);
  }

  const relayState = stringValue(lastStatus?.relay?.state);
  const reason = lastStatus
    ? `Gateway HTTP 已启动，但 Relay 连接状态是 ${formatRelayConnectionState(relayState)}`
    : `无法连接 Gateway HTTP：${url}`;
  throw new Error(
    `${reason}。\n` +
    '请查看日志：pnpm tether gateway logs --stderr\n' +
    '当前未确认启动成功，未打印“Gateway 已在后台启动”。'
  );
}

function formatRelayConnectionState(state: string | undefined): string {
  switch (state) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'disconnected':
      return '已断开';
    case 'auth_failed':
      return '认证失败';
    case undefined:
    case '':
      return '未确认';
    default:
      return state;
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

function formatGatewayServerHeartbeat(api: GatewayStatus | undefined): string {
  const lastOkAt = numberValue(api?.serverHeartbeat?.lastOkAt);
  const lastError = stringValue(api?.serverHeartbeat?.lastError);
  if (lastOkAt) {
    const ageSec = Math.max(0, Math.round((Date.now() - lastOkAt) / 1000));
    return `${new Date(lastOkAt).toLocaleString('zh-CN', { hour12: false })}（${ageSec}s 前）`;
  }
  return lastError ? `失败：${lastError}` : '未确认';
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
    terminal.section(`==> ${filePath} <==`);
    const text = await readFile(filePath, 'utf8').catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    });
    const lines = text.trimEnd().split('\n').filter(Boolean).slice(-80);
    console.log(lines.length > 0 ? lines.join('\n') : terminal.color.dim('(暂无日志)'));
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
  const ptyCheck = checkNodePty();
  checks.push({ name: 'node-pty', status: ptyCheck.ok ? 'ok' : 'fail', detail: ptyCheck.detail });
  for (const runtime of checkGatewayRuntimeInfo()) {
    checks.push(runtime);
  }
  checks.push({ name: 'Gateway 状态存储', status: 'ok', detail: '本地 SQLite 已移除；运行态依赖内存 + Relay/Server 同步' });
  // 配置 & launchd
  pushCheck('配置文件', fs.existsSync(configPath()), configPath());
  pushCheck('LaunchAgent 已安装', launchd.installed, launchd.path);
  pushCheck('LaunchAgent 已加载', launchd.loaded, launchd.error ?? `PID ${launchd.pid ?? '-'}`);
  pushCheck('Gateway API 可连接', Boolean(api), gatewayUrl);
  pushCheck('API session creation', gateway.allowApiSessionCreate, gateway.allowApiSessionCreate ? '已开启' : '未开启');
  pushCheck('Relay 配置', Boolean(relay), relay ? relay.url : '未配置');
  pushCheck('Relay 连接', stringValue(api?.relay?.state) === 'connected', formatRelayConnectionState(stringValue(api?.relay?.state)));
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
    const label = check.status === 'ok' ? terminal.color.green('通过') : check.status === 'warn' ? terminal.color.yellow('警告') : terminal.color.red('失败');
    console.log(`${label} ${terminal.color.dim(check.name)}: ${terminal.status(check.detail)}`);
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

function detectRuntimeMode(): string {
  return import.meta.url.includes('/dist/') ? 'prod (dist bundle)' : 'dev (源码 + tsx)';
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

async function verifyGatewaySession(providerName: string): Promise<void> {
  if (!isProviderName(providerName)) {
    throw new Error(`unknown provider: ${providerName}`);
  }
  const gateway = resolveGatewayConfig();
  const gatewayUrl = gatewayApiUrl(gateway.host, gateway.port);
  const relay = resolveRelayConfig({ file: readTetherConfig() });
  if (!relay) {
    throw new Error('当前未配置 Relay，无法验证 relay PTY 创建链路');
  }
  const auth = await readFreshGatewayAuthState();
  const payload = decodeTokenPayload(auth.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined;
  if (!gatewayId) {
    throw new Error('gateway access token 缺少 gatewayId，请重新执行 tether gateway login。');
  }
  const session = await createSessionViaRelay(PROVIDERS[providerName], { project: process.cwd() }, relay.url, auth.accessToken, gatewayId);
  if (!session) {
    throw new Error('无法通过 Relay 创建 session，请确认 Gateway 已连接 Relay');
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

function relayClientUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }
  url.pathname = '/ws/client';
  url.search = '';
  url.hash = '';
  return url.toString();
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

function deviceStatePath(): string {
  return process.env.TETHER_DEVICE_PATH ?? path.join(os.homedir(), '.tether', 'device.json');
}

async function loadOrCreateDeviceState(): Promise<DeviceState> {
  const raw = await readFile(deviceStatePath(), 'utf8').catch(() => undefined);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DeviceState>;
      if (typeof parsed.deviceKey === 'string' && parsed.deviceKey.startsWith('dev_')) {
        return {
          deviceKey: parsed.deviceKey,
          deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : os.hostname()
        };
      }
    } catch {
      // Regenerate malformed local device metadata below.
    }
  }
  const { randomBytes } = await import('node:crypto');
  const state: DeviceState = {
    deviceKey: `dev_${randomBytes(12).toString('hex')}`,
    deviceName: os.hostname()
  };
  await mkdir(path.dirname(deviceStatePath()), { recursive: true });
  await writeFile(deviceStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return state;
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
  const device = await loadOrCreateDeviceState();
  const browserUrl = `${serverUrl}/gateway-auth?port=${port}&hostname=${encodeURIComponent(hostname)}&deviceKey=${encodeURIComponent(device.deviceKey)}`;
  terminal.section('正在打开浏览器进行授权...');
  terminal.warn(`如果浏览器未自动打开，请访问：${browserUrl}`);
  openBrowser(browserUrl);
  const result = await waitForGatewayAuthCallback(port, 120_000);
  const payload = decodeTokenPayload(result.gatewayAccessToken);
  if (!payload || typeof payload.expiresAt !== 'number') {
    throw new Error('Gateway 登录失败：access token 缺少 expiresAt');
  }
  await writeGatewayAuthState({
    serverUrl,
    accessToken: result.gatewayAccessToken,
    refreshToken: result.gatewayRefreshToken,
    expiresAt: payload.expiresAt
  });
  terminal.success(`Gateway 登录成功，凭据已写入：${gatewayAuthPath()}`);
  terminal.line('已绑定 Gateway ID', result.gatewayId);
  terminal.line('Account ID', result.accountId);
  terminal.line('下一步', 'tether gateway start');
  terminal.line('查看状态', 'tether gateway status');
}

async function logoutGateway(): Promise<void> {
  await rm(gatewayAuthPath(), { force: true });
  terminal.success(`已删除本机 Gateway 登录凭据：${gatewayAuthPath()}`);
  terminal.warn('服务端 Gateway 绑定未变；如需解绑，请在管理后台取消链接。');
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
  gatewayAccessToken: string;
  gatewayRefreshToken: string;
};

async function waitForGatewayAuthCallback(port: number, timeoutMs: number): Promise<GatewayAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: GatewayAuthCallbackResult | undefined, error: Error | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close(() => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as GatewayAuthCallbackResult);
      });
    };
    const timer = setTimeout(() => {
      finish(undefined, new Error('Gateway 授权超时（2 分钟），请重试'));
    }, timeoutMs);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { connection: 'close' }).end();
        return;
      }
      const get = (k: string) => url.searchParams.get(k);
      const gatewayId = get('gatewayId');
      const accountId = get('accountId');
      const gatewayAccessToken = get('gatewayAccessToken');
      const gatewayRefreshToken = get('gatewayRefreshToken');

      if (!gatewayId || !accountId || !gatewayAccessToken || !gatewayRefreshToken) {
        const errorHtml = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>授权失败 · Tether</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 80% 60% at 50% -10%,#2a0d0d 0%,#0a0a0a 70%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e5e5}.card{background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:40px 36px;width:100%;max-width:380px;text-align:center}h1{font-size:20px;font-weight:600;color:#f5f5f5;margin-bottom:8px}p{font-size:14px;color:#a3a3a3;line-height:1.6}</style>
</head><body><div class="card"><h1>授权失败</h1><p>回调参数缺失，请重新运行 tether gateway login。</p></div></body></html>`;
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
          .end(errorHtml, () => {
            req.socket.destroy();
            finish(undefined, new Error('Gateway 授权失败：回调缺少必要参数'));
          });
        return;
      }

      const successHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权成功 · Tether</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse 80% 60% at 50% -10%,#0d2a1a 0%,#0a0a0a 70%);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e5e5}
  .card{background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.08);
    border-radius:16px;padding:40px 36px;width:100%;max-width:380px;
    box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center}
  .icon{width:52px;height:52px;border-radius:50%;background:rgba(34,197,94,.15);
    border:1.5px solid rgba(34,197,94,.4);display:flex;align-items:center;
    justify-content:center;margin:0 auto 20px}
  .icon svg{width:26px;height:26px;stroke:#22c55e;fill:none;stroke-width:2.5;
    stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:20px;font-weight:600;color:#f5f5f5;margin-bottom:8px}
  p{font-size:14px;color:#a3a3a3;line-height:1.6;margin-bottom:28px}
  button{width:100%;padding:11px 0;border-radius:8px;border:none;cursor:pointer;
    font-size:14px;font-weight:500;
    background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;
    transition:opacity .15s}
  button:hover{opacity:.85}
</style>
</head>
<body>
<div class="card">
  <div class="icon">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h1>授权成功</h1>
  <p>Gateway 已绑定到你的账号，可以关闭此窗口，返回终端继续操作。</p>
  <button onclick="window.close()">关闭窗口</button>
</div>
</body>
</html>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(
        successHtml,
        () => {
          req.socket.destroy();
          finish({ gatewayId, accountId, gatewayAccessToken, gatewayRefreshToken }, undefined);
        }
      );
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
  const auth = await readFreshGatewayAuthState();
  return { authorization: `Bearer ${auth.accessToken}` };
}

async function readFreshGatewayAuthState(): Promise<GatewayAuthState> {
  const auth = await readGatewayAuthState();
  if (auth.expiresAt > Date.now() + GATEWAY_TOKEN_REFRESH_SKEW_MS) {
    return auth;
  }
  const refreshed = await refreshGatewayAuthState(auth).catch(() => undefined);
  if (refreshed) {
    return refreshed;
  }
  if (auth.expiresAt <= Date.now()) {
    throw new Error('本地 auth.json 已过期，且 refresh 失败。请重新执行 tether gateway login。');
  }
  return auth;
}

async function readGatewayAuthState(): Promise<GatewayAuthState> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    throw new Error('缺少 ~/.tether/auth.json，请先执行 tether gateway login。');
  }
  const parsed = JSON.parse(raw) as Partial<GatewayAuthState>;
  if (
    typeof parsed.serverUrl !== 'string' ||
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

async function refreshGatewayAuthState(state: GatewayAuthState): Promise<GatewayAuthState | undefined> {
  const response = await fetch(`${state.serverUrl}/api/relay/gateway/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: state.refreshToken })
  });
  if (!response.ok) {
    return undefined;
  }
  const data = unwrapServerApiData(await response.json().catch(() => undefined)) as { accessToken?: unknown; refreshToken?: unknown } | undefined;
  if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
    return undefined;
  }
  const payload = decodeTokenPayload(data.accessToken);
  if (!payload || typeof payload.expiresAt !== 'number') {
    return undefined;
  }
  const next: GatewayAuthState = {
    serverUrl: state.serverUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: payload.expiresAt
  };
  await writeGatewayAuthState(next);
  return next;
}

async function gatewayAuthSummary(): Promise<{
  state: string;
  gatewayId?: string;
  accountId?: string;
  expiresAt?: number;
}> {
  const raw = await readFile(gatewayAuthPath(), 'utf8').catch(() => undefined);
  if (!raw) {
    return { state: '未登录' };
  }
  let parsed: Partial<GatewayAuthState>;
  try {
    parsed = JSON.parse(raw) as Partial<GatewayAuthState>;
  } catch {
    return { state: 'auth.json 无效' };
  }
  if (
    typeof parsed.serverUrl !== 'string' ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string' ||
    typeof parsed.expiresAt !== 'number'
  ) {
    return { state: 'auth.json 无效' };
  }
  const refreshed = await readFreshGatewayAuthState().catch(() => undefined);
  const auth = refreshed ?? (parsed as GatewayAuthState);
  const payload = decodeTokenPayload(auth.accessToken);
  return {
    state: refreshed ? '已登录' : auth.expiresAt > Date.now() ? '已登录（refresh 未确认）' : '已过期',
    gatewayId: typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined,
    accountId: typeof payload?.accountId === 'string' ? payload.accountId : undefined,
    expiresAt: auth.expiresAt
  };
}

function decodeTokenPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
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
