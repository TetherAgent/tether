import { readTetherConfig, resolveGatewayConfig, resolveGatewayProfileConfig, type GatewayProfileName } from '@tether/config';
import { listGateways } from '@tether/gateway';
import { NonTetherGatewayError } from '../utils/errors.js';
import { sleep } from '../utils/sleep.js';
import { stringValue } from '../utils/values.js';
import { gatewayApiUrl } from './urls.js';

export type GatewayStatus = {
  ok?: unknown;
  pid?: unknown;
  version?: unknown;
  url?: unknown;
  host?: unknown;
  port?: unknown;
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

export async function findPersistentGateway(): Promise<string | undefined> {
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

export async function gatewayCandidateUrls(): Promise<string[]> {
  const config = resolveGatewayConfig();
  const candidates = new Set<string>();
  for (const record of await listGateways()) {
    candidates.add(record.url);
  }
  candidates.add(`http://${config.host}:${config.port}`);
  return [...candidates];
}

export async function waitForStartedGateway(profile: GatewayProfileName): Promise<GatewayStatus> {
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
    '请查看日志：pnpm tether debug\n' +
    '当前未确认启动成功，未打印“Gateway 已在后台启动”。'
  );
}

export async function fetchFirstGatewayStatus(urls: string[]): Promise<GatewayStatus | undefined> {
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

export async function fetchGatewayStatusBody(url: string): Promise<GatewayStatus | undefined> {
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
