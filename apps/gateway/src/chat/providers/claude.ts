import { spawnSync } from 'node:child_process';
import { providerEffectiveEnv } from '../../utils/provider-env.js';
import { uniqueStrings } from '../provider-registry.js';

export function isClaudeInstalled(): boolean {
  return isInstalled('claude');
}

export async function claudeModels(): Promise<string[]> {
  const env = providerEffectiveEnv('claude', process.cwd());
  const envModels = claudeModelsFromEnv(env);
  if (envModels.length > 0) {
    return envModels;
  }
  const gatewayModels = await claudeModelsFromGateway(env);
  if (gatewayModels.length > 0) {
    return gatewayModels;
  }
  return claudeModelAliases(env);
}

function claudeModelsFromEnv(env: NodeJS.ProcessEnv): string[] {
  return uniqueStrings([
    env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL
  ]);
}

async function claudeModelsFromGateway(env: NodeJS.ProcessEnv): Promise<string[]> {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl || env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY !== '1') {
    return [];
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/models`;
    url.search = 'limit=1000';
  } catch {
    return [];
  }
  const headers: Record<string, string> = {};
  if (env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  }
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return [];
    }
    const json = (await response.json()) as { data?: unknown };
    if (!Array.isArray(json.data)) {
      return [];
    }
    return uniqueStrings(
      json.data.flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const id = (item as { id?: unknown }).id;
        return typeof id === 'string' ? [id] : [];
      })
    );
  } catch {
    return [];
  }
}

function claudeModelAliases(env: NodeJS.ProcessEnv): string[] {
  const result = spawnSync('claude', ['--help'], { encoding: 'utf8', timeout: 2000, env });
  const help = typeof result.stdout === 'string' ? result.stdout : '';
  const modelLine = help.split('\n').find((line) => line.includes('--model'));
  if (!modelLine) {
    return ['sonnet', 'opus', 'haiku'];
  }
  const aliasExample = modelLine.match(/alias[^()]*\(e\.g\.\s*([^)]+)\)/i)?.[1] ?? modelLine;
  const aliases = Array.from(aliasExample.matchAll(/'([^']+)'/g))
    .map((match) => match[1])
    .filter((model): model is string => Boolean(model && /^[a-z][a-z0-9_-]*$/i.test(model) && !model.startsWith('claude-')));
  const normalized = uniqueStrings([...aliases, 'haiku']);
  return normalized.length > 0 ? normalized : ['sonnet', 'opus', 'haiku'];
}

function isInstalled(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0 || result.error === undefined;
}
