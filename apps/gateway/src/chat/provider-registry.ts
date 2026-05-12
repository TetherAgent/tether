import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeModels, isClaudeInstalled } from './providers/claude.js';
import { codexModels, isCodexInstalled } from './providers/codex.js';
import { copilotModels, isCopilotInstalled } from './providers/copilot.js';
import { resolveHomePath } from './provider-utils.js';

export type ChatProviderInfo = {
  provider: string;
  models: string[];
};

export async function listChatProviders(): Promise<ChatProviderInfo[]> {
  return [
    isClaudeInstalled() ? { provider: 'claude', models: await claudeModels() } : undefined,
    isCodexInstalled() ? { provider: 'codex', models: codexModels() } : undefined,
    isCopilotInstalled() ? { provider: 'copilot', models: copilotModels() } : undefined
  ].filter((provider): provider is ChatProviderInfo => provider !== undefined);
}

export async function directorySuggestions(input: string): Promise<string[]> {
  const trimmed = input.trim();
  const expanded = resolveInputPath(trimmed);
  const shouldListChildren = !trimmed || trimmed.endsWith('/') || trimmed === '~';
  const baseDir = shouldListChildren ? expanded : path.dirname(expanded);
  const prefix = shouldListChildren ? '' : path.basename(expanded).toLowerCase();
  const showHidden = prefix.startsWith('.') || path.basename(baseDir).startsWith('.');
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => showHidden || !entry.name.startsWith('.'))
      .filter((entry) => !prefix || entry.name.toLowerCase().startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 20)
      .map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function resolveInputPath(input: string): string {
  if (!input) {
    return os.homedir();
  }
  return path.resolve(resolveHomePath(input));
}
