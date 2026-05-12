import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { providerEffectiveEnv } from '../../utils/provider-env.js';
import { resolveHomePath, uniqueStrings } from '../provider-registry.js';

export function isCodexInstalled(): boolean {
  const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
  return result.status === 0 || result.error === undefined;
}

export function codexModels(): string[] {
  const env = providerEffectiveEnv('codex', process.cwd());
  return uniqueStrings([
    env.CODEX_MODEL,
    readCodexConfiguredModel(env),
    ...readCodexCachedModels(env),
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2'
  ]);
}

function readCodexConfiguredModel(env: NodeJS.ProcessEnv): string | undefined {
  const configDir = env.CODEX_HOME ? resolveHomePath(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  try {
    const content = readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    const match = content.match(/(?:^|\n)\s*model\s*=\s*["']([^"'\n]+)["']/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function readCodexCachedModels(env: NodeJS.ProcessEnv): string[] {
  const configDir = env.CODEX_HOME ? resolveHomePath(env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  try {
    const parsed = JSON.parse(readFileSync(path.join(configDir, 'models_cache.json'), 'utf8')) as { models?: unknown };
    if (!Array.isArray(parsed.models)) {
      return [];
    }
    return parsed.models.flatMap((model) => {
      if (!model || typeof model !== 'object') {
        return [];
      }
      const slug = (model as { slug?: unknown }).slug;
      return typeof slug === 'string' ? [slug] : [];
    });
  } catch {
    return [];
  }
}
