import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_GATEWAY_PORT = 4789;
export const DEFAULT_GATEWAY_HOST = '127.0.0.1';

export type TetherConfig = {
  gateway?: {
    host?: string;
    port?: number;
    allowApiSessionCreate?: boolean;
  };
  relay?: {
    url?: string;
    secret?: string;
  };
};

export type GatewayConfigInput = {
  cli?: {
    host?: string;
    port?: number;
    allowApiSessionCreate?: boolean;
  };
  env?: NodeJS.ProcessEnv;
  file?: TetherConfig;
  pathOverride?: string;
};

export type ResolvedGatewayConfig = {
  host: string;
  port: number;
  allowApiSessionCreate: boolean;
};

export const DEFAULT_GATEWAY_CONFIG = {
  host: DEFAULT_GATEWAY_HOST,
  port: DEFAULT_GATEWAY_PORT,
  allowApiSessionCreate: false
} satisfies ResolvedGatewayConfig;

export type RelayConfigInput = {
  cli?: {
    relayUrl?: string;
    relaySecret?: string;
  };
  env?: NodeJS.ProcessEnv;
  file?: TetherConfig;
  pathOverride?: string;
};

export type ResolvedRelayConfig = {
  url: string;
  secret: string;
};

export function configPath(): string {
  return path.join(os.homedir(), '.tether', 'config.json');
}

export function readTetherConfig(pathOverride?: string): TetherConfig {
  const filePath = pathOverride ?? configPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as TetherConfig;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Tether config JSON: ${message}`);
  }
}

export async function writeTetherConfig(config: TetherConfig, pathOverride?: string): Promise<void> {
  const filePath = pathOverride ?? configPath();
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function resolveGatewayConfig(input: GatewayConfigInput = {}): ResolvedGatewayConfig {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  return {
    host: input.cli?.host ?? env.TETHER_GATEWAY_HOST ?? file.gateway?.host ?? DEFAULT_GATEWAY_CONFIG.host,
    port: input.cli?.port ?? parseOptionalPort(env.TETHER_GATEWAY_PORT, 'TETHER_GATEWAY_PORT') ?? file.gateway?.port ?? DEFAULT_GATEWAY_CONFIG.port,
    allowApiSessionCreate:
      input.cli?.allowApiSessionCreate ??
      parseOptionalBoolean(env.TETHER_GATEWAY_ALLOW_API_SESSION_CREATE, 'TETHER_GATEWAY_ALLOW_API_SESSION_CREATE') ??
      file.gateway?.allowApiSessionCreate ??
      DEFAULT_GATEWAY_CONFIG.allowApiSessionCreate
  };
}

export function resolveRelayConfig(input: RelayConfigInput = {}): ResolvedRelayConfig | undefined {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const url = input.cli?.relayUrl ?? env.TETHER_RELAY_URL ?? file.relay?.url;
  const secret = input.cli?.relaySecret ?? env.TETHER_RELAY_SECRET ?? file.relay?.secret;
  if (!url || !secret) {
    return undefined;
  }
  return { url, secret };
}

function parseOptionalPort(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

function parseOptionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new Error(`${name} must be true, false, 1, or 0`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
