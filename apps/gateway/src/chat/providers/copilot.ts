import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { providerEffectiveEnv } from '../../utils/provider-env.js';
import { uniqueStrings } from '../provider-registry.js';

export function isCopilotInstalled(): boolean {
  const result = spawnSync('gh', ['copilot', '--help'], { stdio: 'ignore', timeout: 2000 });
  return result.status === 0;
}

export function copilotModels(): string[] {
  const env = providerEffectiveEnv('copilot', process.cwd());
  return uniqueStrings([
    env.COPILOT_MODEL,
    env.COPILOT_PROVIDER_MODEL_ID,
    readCopilotConfiguredModel(),
    ...copilotModelsFromHelp(),
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.2',
    'claude-sonnet-4'
  ]);
}

function readCopilotConfiguredModel(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(os.homedir(), '.copilot', 'settings.json'), 'utf8')) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

function copilotModelsFromHelp(): string[] {
  const result = spawnSync('gh', ['copilot', 'help', 'config'], { encoding: 'utf8', timeout: 2000 });
  const help = typeof result.stdout === 'string' ? result.stdout : '';
  const models: string[] = [];
  for (const line of help.split('\n')) {
    const match = line.match(/^\s*-\s+"([^"]+)"/);
    if (match?.[1]) {
      models.push(match[1]);
    }
  }
  return models;
}
