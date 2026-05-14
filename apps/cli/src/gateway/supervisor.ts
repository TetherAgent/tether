import fs from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import {
  configPath,
  defaultTetherConfig,
  isGatewayProfileName,
  readTetherConfig,
  resolveGatewayProfileConfig,
  resolveRelayConfig,
  writeTetherConfig,
  type GatewayProfileName,
  type TetherConfig
} from '@tether/config';
import { listGateways, localLanAddress, PtySessionManager, startDaemon } from '@tether/gateway';
import {
  launchAgentStatus,
  startLaunchAgent,
  stopLaunchAgent,
} from '../launchd.js';
import * as terminal from '../terminal.js';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { isNodeError } from '../utils/errors.js';
import { sleep } from '../utils/sleep.js';
import { numberValue, stringValue } from '../utils/values.js';
import { ensureClaudeHudHook } from './hooks.js';
import { fetchFirstGatewayStatus, fetchGatewayStatusBody, waitForStartedGateway } from './probe.js';
import { formatRelayConnectionState } from './status.js';
import { gatewayApiUrl } from './urls.js';

export async function startGatewayBackground(): Promise<void> {
  terminal.section('Gateway 启动');
  let profile = gatewayProfileFromEnv();
  if (!fs.existsSync(configPath())) {
    terminal.line('配置检查', '未找到配置，正在初始化');
    const chosen = profile ?? 'relay';
    const existing = readTetherConfig();
    const next: TetherConfig = { ...defaultTetherConfig(chosen), providers: existing.providers };
    await writeTetherConfig(next);
    terminal.success(`配置已写入：${configPath()}`);
    profile = chosen;
  } else {
    terminal.line('配置检查', configPath());
  }
  profile ??= 'relay';
  terminal.line('启动模式', profile);
  terminal.line('登录检查', '检查中');
  await ensureGatewayAuthForProfile(profile);
  terminal.line('登录检查', profile === 'local' ? '本地模式无需登录' : '已登录');
  const before = await launchAgentStatus();
  const file = readTetherConfig();
  const resolved = resolveGatewayProfileConfig({ file, profile });
  const gatewayUrl = gatewayApiUrl(resolved.gateway.host, resolved.gateway.port);
  terminal.line('现有 Gateway', `检查 ${gatewayUrl}`);
  const existing = await fetchGatewayStatusBody(gatewayApiUrl(resolved.gateway.host, resolved.gateway.port));
  if (existing && (profile !== 'relay' || stringValue(existing.relay?.state) === 'connected')) {
    terminal.line('Gateway 状态', `已运行 (${stringValue(existing.url) ?? gatewayUrl})`);
    if (profile === 'relay') {
      terminal.line('Relay 连接', formatRelayConnectionState(stringValue(existing.relay?.state)));
    }
    terminal.success(`Gateway 已在后台运行：${before.path}`);
    return;
  }
  terminal.line('现有 Gateway', '未运行或未就绪');
  terminal.line('LaunchAgent', before.installed ? '已安装，正在启动' : '未安装，正在安装并启动');
  const status = await startLaunchAgent({ env: { ...process.env, TETHER_GATEWAY_PROFILE: profile } });
  terminal.line('等待 Gateway HTTP', gatewayUrl);
  if (profile === 'relay') {
    terminal.line('等待 Relay', '连接中');
  }
  const gatewayStatus = await waitForStartedGateway(profile);
  if (!before.installed) {
    terminal.success(`LaunchAgent 已安装：${status.path}`);
  }
  terminal.line('Gateway 状态', `运行中 (${stringValue(gatewayStatus.url) ?? 'URL 未知'})`);
  if (profile === 'relay') {
    terminal.line('Relay 连接', formatRelayConnectionState(stringValue(gatewayStatus.relay?.state)));
  }
  await ensureClaudeHudHook({
    host: resolved.gateway.host,
    port: resolved.gateway.port,
    config: file
  });
  terminal.success(`Gateway 已在后台启动：${status.path}`);
}

export async function startGatewayForeground(profile?: GatewayProfileName): Promise<void> {
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

export async function stopGatewayBackground(): Promise<void> {
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

export async function ensureGatewayAuthForProfile(profile: GatewayProfileName): Promise<void> {
  if (profile === 'local') {
    return;
  }
  const existing = await readFreshGatewayAuthState().catch(() => undefined);
  if (existing && existing.expiresAt > Date.now()) {
    return;
  }
  throw new Error(
    `${profile === 'relay' ? 'Relay' : 'Direct'} 模式需要先绑定 Gateway 账号。\n` +
    '请先执行：tether login\n' +
    '登录成功后再执行：tether start'
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
          '通常是已有 Gateway 正在运行。先执行：pnpm tether status\n' +
          '如果确认要重启，执行：pnpm tether stop，然后再启动。'
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

export function gatewayProfileFromEnv(): GatewayProfileName | undefined {
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
