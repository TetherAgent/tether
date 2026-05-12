import os from 'node:os';
import { configPath, readTetherConfig, resolveGatewayProfileConfig, type TetherConfig } from '@tether/config';
import { listGateways } from '@tether/gateway';
import {
  launchAgentPath,
  launchAgentStatus,
  type LaunchAgentStatus
} from '../launchd.js';
import * as terminal from '../terminal.js';
import { loadOrCreateDeviceState } from '../auth/device-state.js';
import { gatewayAuthSummary } from '../auth/gateway-auth-store.js';
import { booleanValue, numberValue, stringValue } from '../utils/values.js';
import { fetchFirstGatewayStatus, type GatewayStatus } from './probe.js';
import { gatewayApiUrl } from './urls.js';

export async function printGatewayStatus(): Promise<void> {
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

export function formatRelayConnectionState(state: string | undefined): string {
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

export function formatGatewayPathStatus(api: GatewayStatus | undefined): string {
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

function formatLaunchAgentStatus(status: LaunchAgentStatus): string {
  if (status.loaded) {
    return status.installed ? '已安装，已加载' : '未安装，已加载';
  }
  if (status.installed) {
    return '已安装，未加载';
  }
  return '未安装';
}

export async function getLaunchAgentStatus(): Promise<LaunchAgentStatus> {
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
