import type { Command } from 'commander';
import { readTetherConfig, resolveRelayConfig } from '@tether/config';
import { isProviderName, PROVIDERS, type ProviderDefinition } from '@tether/core';
import { attachPtySession } from '../attach/pty-attach.js';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { decodeTokenPayload } from '../auth/token.js';
import { findPersistentGateway } from '../gateway/probe.js';
import { createSessionViaRelay } from '../relay/sessions.js';

type StartOptions = {
  title?: string;
  reconnect?: boolean;
  providerArgs?: string[];
};

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .argument('<provider>')
    .argument('[providerArgs...]')
    .description('为指定 provider 启动一个 PTY event-stream session')
    .option('--title <title>', '前端展示的 session 标题')
    .option('--no-reconnect', '本地 attach 断开后不自动重连')
    .allowUnknownOption(true)
    .action((providerName: string, providerArgs: string[], options: StartOptions) => {
      if (!isProviderName(providerName)) {
        throw new Error(`不支持的 provider：${providerName}`);
      }
      if (providerName === 'shell' && providerArgs.length > 0) {
        throw new Error('shell provider 不接受额外参数；请直接运行：tether run shell');
      }
      const provider = PROVIDERS[providerName];
      return startProviderSession(provider, { ...options, providerArgs });
    });
}

async function startProviderSession(provider: ProviderDefinition, options: StartOptions): Promise<void> {
  const gatewayUrl = await findPersistentGateway();
  if (!gatewayUrl) {
    throw new Error('未检测到常驻 Gateway。\n请先运行：tether start');
  }
  const relay = resolveRelayConfig({ file: readTetherConfig() });
  if (!relay) {
    throw new Error('当前 Gateway 未配置 Relay，无法通过 relay 创建 PTY session。请切到 relay 模式后重试。');
  }
  const auth = await readFreshGatewayAuthState();
  const payload = decodeTokenPayload(auth.accessToken);
  const gatewayId = typeof payload?.gatewayId === 'string' ? payload.gatewayId : undefined;
  if (!gatewayId) {
    throw new Error('gateway access token 缺少 gatewayId，请重新执行 tether login。');
  }
  const session = await createSessionViaRelay(provider, options, relay.url, auth.accessToken, gatewayId);
  const remoteUrl = `${gatewayUrl}/remote/session/${session.id}`;
  console.log(`Tether session: ${session.id}`);
  console.log(`Remote URL: ${remoteUrl}`);
  const result = await attachPtySession(session.id, {
    relayUrl: relay.url,
    mode: 'control',
    reconnect: options.reconnect
  });
  if (result === 'detached') {
    console.error(`已断开本地 attach。常驻 Gateway 仍在托管 ${remoteUrl}`);
  }
}
