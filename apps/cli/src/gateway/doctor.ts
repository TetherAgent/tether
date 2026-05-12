import fs from 'node:fs';
import process from 'node:process';
import { configPath, readTetherConfig, resolveGatewayConfig, resolveRelayConfig } from '@tether/config';
import { PtySessionManager } from '@tether/gateway';
import { isProviderName, PROVIDERS } from '@tether/core';
import {
  gatewayRuntimeJsonPath,
  readGatewayRuntimeInfo,
} from '../launchd.js';
import * as terminal from '../terminal.js';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { decodeTokenPayload } from '../auth/token.js';
import { createSessionViaRelay, stopSessionViaRelay } from '../relay/sessions.js';
import { commandAvailable } from '../utils/process.js';
import { stringValue } from '../utils/values.js';
import { fetchFirstGatewayStatus } from './probe.js';
import { formatGatewayPathStatus, formatRelayConnectionState, getLaunchAgentStatus } from './status.js';
import { gatewayApiUrl } from './urls.js';

export async function runGatewayDoctor(): Promise<void> {
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

  pushCheck('配置文件', fs.existsSync(configPath()), configPath());
  pushCheck('LaunchAgent 已安装', launchd.installed, launchd.path);
  pushCheck('LaunchAgent 已加载', launchd.loaded, launchd.error ?? `PID ${launchd.pid ?? '-'}`);
  pushCheck('Gateway API 可连接', Boolean(api), gatewayUrl);
  pushCheck('Relay 配置', Boolean(relay), relay ? relay.url : '未配置');
  pushCheck('Relay 连接', stringValue(api?.relay?.state) === 'connected', formatRelayConnectionState(stringValue(api?.relay?.state)));
  for (const provider of Object.values(PROVIDERS)) {
    const configuredCommand = (file.providers as Record<string, { command?: string } | undefined> | undefined)?.[provider.name]?.command;
    const command = provider.name === 'shell'
      ? process.env.SHELL || '/bin/zsh'
      : configuredCommand ?? provider.command;
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
      detail: `未找到 ${gatewayRuntimeJsonPath()}（运行 tether start 后会写入）`
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

export async function verifyGatewaySession(providerName: string): Promise<void> {
  if (!isProviderName(providerName)) {
    throw new Error(`unknown provider: ${providerName}`);
  }
  const relay = resolveRelayConfig({ file: readTetherConfig() });
  if (!relay) {
    throw new Error('当前未配置 Relay，无法验证 relay PTY 创建链路');
  }
  const auth = await readFreshGatewayAuthState();
  const payload = decodeTokenPayload(auth.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined;
  if (!gatewayId) {
    throw new Error('gateway access token 缺少 gatewayId，请重新执行 tether login。');
  }
  const session = await createSessionViaRelay(PROVIDERS[providerName], {}, relay.url, auth.accessToken, gatewayId);
  if (!session) {
    throw new Error('无法通过 Relay 创建 session，请确认 Gateway 已连接 Relay');
  }
  console.log(`已创建验证 session：${session.id}`);
  await stopSessionViaRelay(session.id, relay.url, auth.accessToken);
  console.log(`已停止验证 session：${session.id}`);
}
