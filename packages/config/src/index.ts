import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProviderName } from '@tether/core';

export const DEFAULT_GATEWAY_PORT = 4789;
export const DEFAULT_GATEWAY_HOST = '127.0.0.1';
export type TetherDefaultDeployment = 'earntools' | 'fundingrate';

// 内置官方部署域名。
//
// 切换默认使用哪套域名：改下面的 DEFAULT_DEPLOYMENT，影响代码默认值。
//
// 如果还希望启动 CLI 时把本机 ~/.tether/config.json 和已有 auth.json.serverUrl
// 强制覆盖为所选 deployment，把 DEFAULT_FORCE_LOCAL_CONFIG_SYNC 改为 true。
//
// 注意：local profile 仍固定走本机 http://127.0.0.1:4800，不受这里影响。
export const TETHER_DEFAULT_DEPLOYMENTS = {
  earntools: {
    serverUrl: 'https://tether.earntools.me',
    relayUrl: 'wss://tether.earntools.me'
  },
  fundingrate: {
    serverUrl: 'https://tether.fundingrate.cn',
    relayUrl: 'wss://tether.fundingrate.cn'
  }
} as const satisfies Record<TetherDefaultDeployment, { serverUrl: string; relayUrl: string }>;

// 代码默认使用的官方部署。
// 需要默认切回旧域名时，把这里改成 'earntools'。
export const DEFAULT_DEPLOYMENT: TetherDefaultDeployment = 'fundingrate';
// 是否允许 CLI 启动时强制同步本机 ~/.tether/config.json 和 auth.json.serverUrl。
// 默认 false，避免静默覆盖用户本机配置。
// 需要强制覆盖时，把下面默认值改为 true。
export const DEFAULT_FORCE_LOCAL_CONFIG_SYNC = true;
export const DEFAULT_SERVER_URL = TETHER_DEFAULT_DEPLOYMENTS[DEFAULT_DEPLOYMENT].serverUrl;
export const DEFAULT_RELAY_URL = TETHER_DEFAULT_DEPLOYMENTS[DEFAULT_DEPLOYMENT].relayUrl;



export type GatewayProfileName = 'local' | 'direct' | 'relay';

export type GatewayProfileConfig = {
  server?: {
    url?: string;
  };
  gateway?: {
    host?: string;
    port?: number;
  };
  relay?: {
    url?: string;
    secret?: string;
  };
};

export type TetherConfig = {
  defaultDeployment?: TetherDefaultDeployment;
  defaultProfile?: GatewayProfileName;
  deployments?: Partial<Record<TetherDefaultDeployment, {
    serverUrl?: string;
    relayUrl?: string;
  }>>;
  server?: {
    url?: string;
  };
  profiles?: Partial<Record<GatewayProfileName, GatewayProfileConfig>>;
  gateway?: {
    host?: string;
    port?: number;
  };
  relay?: {
    url?: string;
    secret?: string;
  };
  claudeHook?: {
    autoInstall?: boolean;
  };
  providers?: Partial<Record<ProviderName, {
    command?: string;
  }>>;
};

export type GatewayConfigInput = {
  cli?: {
    host?: string;
    port?: number;
  };
  env?: NodeJS.ProcessEnv;
  file?: TetherConfig;
  pathOverride?: string;
  profile?: GatewayProfileName;
};

export type ResolvedGatewayConfig = {
  host: string;
  port: number;
};

export const DEFAULT_GATEWAY_CONFIG = {
  host: DEFAULT_GATEWAY_HOST,
  port: DEFAULT_GATEWAY_PORT
} satisfies ResolvedGatewayConfig;

export type RelayConfigInput = {
  cli?: {
    relayUrl?: string;
    relaySecret?: string;
  };
  env?: NodeJS.ProcessEnv;
  file?: TetherConfig;
  pathOverride?: string;
  profile?: GatewayProfileName;
};

export type ResolvedRelayConfig = {
  url: string;
  secret: string;
};

export type ResolvedGatewayProfileConfig = {
  profile: GatewayProfileName;
  serverUrl: string;
  gateway: ResolvedGatewayConfig;
  relay?: ResolvedRelayConfig;
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

export function isTetherDefaultDeployment(value: string): value is TetherDefaultDeployment {
  return value === 'earntools' || value === 'fundingrate';
}

export function resolveDefaultDeployment(input: {
  file?: TetherConfig;
} = {}): TetherDefaultDeployment {
  const raw = input.file?.defaultDeployment;
  return raw && isTetherDefaultDeployment(raw) ? raw : DEFAULT_DEPLOYMENT;
}

export function resolveDeploymentDefaults(input: {
  env?: NodeJS.ProcessEnv;
  file?: TetherConfig;
  deployment?: TetherDefaultDeployment;
} = {}): { deployment: TetherDefaultDeployment; serverUrl: string; relayUrl: string } {
  const file = input.file ?? {};
  const deployment = input.deployment ?? resolveDefaultDeployment({ file });
  const builtIn = TETHER_DEFAULT_DEPLOYMENTS[deployment];
  const fileDeployment = file.deployments?.[deployment];
  return {
    deployment,
    serverUrl: stripTrailingSlashes(fileDeployment?.serverUrl ?? builtIn.serverUrl),
    relayUrl: stripTrailingSlashes(fileDeployment?.relayUrl ?? builtIn.relayUrl)
  };
}

export function shouldForceLocalConfigSync(): boolean {
  return DEFAULT_FORCE_LOCAL_CONFIG_SYNC;
}

export async function syncTetherConfigDefaults(input: {
  env?: NodeJS.ProcessEnv;
  force?: boolean;
  pathOverride?: string;
} = {}): Promise<{ changed: boolean; deployment: TetherDefaultDeployment; serverUrl: string; relayUrl: string }> {
  const env = input.env ?? process.env;
  const file = readTetherConfig(input.pathOverride);
  const defaults = resolveDeploymentDefaults({ env, file });
  const next: TetherConfig = {
    ...file,
    defaultDeployment: defaults.deployment,
    deployments: {
      ...file.deployments,
      earntools: {
        ...TETHER_DEFAULT_DEPLOYMENTS.earntools,
        ...file.deployments?.earntools
      },
      fundingrate: {
        ...TETHER_DEFAULT_DEPLOYMENTS.fundingrate,
        ...file.deployments?.fundingrate
      }
    },
    server: {
      ...file.server,
      url: defaults.serverUrl
    },
    profiles: {
      ...file.profiles,
      relay: {
        ...file.profiles?.relay,
        gateway: file.profiles?.relay?.gateway,
        server: {
          ...file.profiles?.relay?.server,
          url: defaults.serverUrl
        },
        relay: {
          ...file.profiles?.relay?.relay,
          url: defaults.relayUrl
        }
      }
    }
  };
  const shouldWrite = input.force === true || JSON.stringify(file) !== JSON.stringify(next);
  if (shouldWrite) {
    await writeTetherConfig(next, input.pathOverride);
  }
  return {
    changed: shouldWrite,
    ...defaults
  };
}

export function resolveGatewayConfig(input: GatewayConfigInput = {}): ResolvedGatewayConfig {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const profile = resolveProfileName({ file, env, profile: input.profile });
  const profileConfig = profileDefaults(profile, file);
  return {
    host: input.cli?.host ?? env.TETHER_GATEWAY_HOST ?? profileConfig?.gateway?.host ?? file.gateway?.host ?? DEFAULT_GATEWAY_CONFIG.host,
    port: input.cli?.port ?? parseOptionalPort(env.TETHER_GATEWAY_PORT, 'TETHER_GATEWAY_PORT') ?? profileConfig?.gateway?.port ?? file.gateway?.port ?? DEFAULT_GATEWAY_CONFIG.port
  };
}

export function resolveRelayConfig(input: RelayConfigInput = {}): ResolvedRelayConfig | undefined {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const profile = resolveProfileName({ file, env, profile: input.profile });
  const profileConfig = profileDefaults(profile, file);
  const deploymentDefaults = resolveDeploymentDefaults({ env, file });
  const explicitUrl = input.cli?.relayUrl ?? env.TETHER_RELAY_URL;
  const explicitSecret = input.cli?.relaySecret ?? env.TETHER_RELAY_SECRET;
  const url = explicitUrl ?? (profile === 'relay' ? profileConfig?.relay?.url ?? file.relay?.url ?? deploymentDefaults.relayUrl : undefined);
  const secret = explicitSecret ?? (profile === 'relay' ? profileConfig?.relay?.secret ?? file.relay?.secret : undefined);
  if (!url) {
    return undefined;
  }
  return { url, secret: secret ?? '' };
}

export function resolveServerUrl(input: Omit<GatewayConfigInput, 'cli'> = {}): string {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const profile = resolveProfileName({ file, env, profile: input.profile });
  const profileConfig = profileDefaults(profile, file);
  const deploymentDefaults = resolveDeploymentDefaults({ env, file });
  return stripTrailingSlashes(env.TETHER_SERVER_URL ?? profileConfig?.server?.url ?? file.server?.url ?? deploymentDefaults.serverUrl);
}

export function resolveGatewayProfileConfig(input: GatewayConfigInput & RelayConfigInput = {}): ResolvedGatewayProfileConfig {
  const file = input.file ?? readTetherConfig(input.pathOverride);
  const env = input.env ?? process.env;
  const profile = resolveProfileName({ file, env, profile: input.profile });
  return {
    profile,
    serverUrl: resolveServerUrl({ file, env, profile }),
    gateway: resolveGatewayConfig({ ...input, file, env, profile }),
    relay: resolveRelayConfig({ ...input, file, env, profile })
  };
}

export function defaultTetherConfig(profile: GatewayProfileName = 'direct'): TetherConfig {
  const defaults = resolveDeploymentDefaults();
  return {
    defaultDeployment: defaults.deployment,
    defaultProfile: profile,
    deployments: {
      ...TETHER_DEFAULT_DEPLOYMENTS
    },
    server: {
      url: defaults.serverUrl
    },
    profiles: {
      local: {
        server: {
          url: 'http://127.0.0.1:4800'
        },
        gateway: {
          host: '127.0.0.1',
          port: DEFAULT_GATEWAY_PORT
        }
      },
      direct: {
        gateway: {
          host: '0.0.0.0',
          port: DEFAULT_GATEWAY_PORT
        }
      },
      relay: {
        gateway: {
          host: '127.0.0.1',
          port: DEFAULT_GATEWAY_PORT
        },
        relay: {
          url: defaults.relayUrl
        }
      }
    }
  };
}

export function isGatewayProfileName(value: string): value is GatewayProfileName {
  return value === 'local' || value === 'direct' || value === 'relay';
}

function resolveProfileName(input: {
  file: TetherConfig;
  env: NodeJS.ProcessEnv;
  profile?: GatewayProfileName;
}): GatewayProfileName {
  const envProfile = input.env.TETHER_GATEWAY_PROFILE;
  if (input.profile) {
    return input.profile;
  }
  if (envProfile && isGatewayProfileName(envProfile)) {
    return envProfile;
  }
  if (input.file.defaultProfile && isGatewayProfileName(input.file.defaultProfile)) {
    return input.file.defaultProfile;
  }
  return 'local';
}

function profileDefaults(profile: GatewayProfileName, file: TetherConfig): GatewayProfileConfig {
  return {
    ...(defaultTetherConfig(profile).profiles?.[profile] ?? {}),
    ...(file.profiles?.[profile] ?? {}),
    gateway: {
      ...(defaultTetherConfig(profile).profiles?.[profile]?.gateway ?? {}),
      ...(file.profiles?.[profile]?.gateway ?? {})
    },
    server: {
      ...(defaultTetherConfig(profile).profiles?.[profile]?.server ?? {}),
      ...(file.profiles?.[profile]?.server ?? {})
    },
    relay: {
      ...(defaultTetherConfig(profile).profiles?.[profile]?.relay ?? {}),
      ...(file.profiles?.[profile]?.relay ?? {})
    }
  };
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

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
