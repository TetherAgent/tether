import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isProviderName, PROVIDERS, type ProviderDefinition } from '@tether/core';

const PROVIDER_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  'CODEX_HOME',
  'CODEX_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'COPILOT_PROVIDER_BASE_URL',
  'COPILOT_PROVIDER_TYPE',
  'COPILOT_PROVIDER_API_KEY',
  'COPILOT_PROVIDER_BEARER_TOKEN',
  'COPILOT_PROVIDER_WIRE_API',
  'COPILOT_PROVIDER_AZURE_API_VERSION',
  'COPILOT_MODEL',
  'COPILOT_PROVIDER_MODEL_ID',
  'COPILOT_PROVIDER_WIRE_MODEL',
  'COPILOT_PROVIDER_MAX_PROMPT_TOKENS',
  'COPILOT_PROVIDER_MAX_OUTPUT_TOKENS',
  'COPILOT_ALLOW_ALL'
];

export function providerChildEnv(provider: string): Record<string, string> | undefined {
  const env = {
    ...(isProviderName(provider) ? ((PROVIDERS[provider] as ProviderDefinition).env ?? {}) : {}),
    ...readShellWrapperEnv(provider)
  };
  return Object.keys(env).length > 0 ? env : undefined;
}

export function providerEffectiveEnv(provider: string, cwd?: string): NodeJS.ProcessEnv {
  const childEnv = providerChildEnv(provider) ?? {};
  const shellPathEnv = readShellPathEnv(process.env);
  const preSettingsEnv = { ...process.env, ...shellPathEnv, ...childEnv };
  const settingsEnv = provider === 'claude' ? readClaudeSettingsEnv(cwd, preSettingsEnv.CLAUDE_CONFIG_DIR) : {};
  const baseEnv = { ...process.env, ...shellPathEnv, ...settingsEnv };
  const envFile = provider === 'claude'
    ? readEnvFile(({ ...baseEnv, ...childEnv }).CLAUDE_ENV_FILE)
    : {};
  return {
    ...baseEnv,
    ...envFile,
    ...childEnv
  };
}

function readShellPathEnv(baseEnv: NodeJS.ProcessEnv): Record<string, string> {
  const zshrc = path.join(os.homedir(), '.zshrc');
  let content = '';
  try {
    content = readFileSync(zshrc, 'utf8');
  } catch {
    return {};
  }
  let pathValue = baseEnv.PATH ?? '';
  const shellEnv: NodeJS.ProcessEnv = { ...baseEnv, PATH: pathValue };
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^export\s+([A-Za-z_]\w*)=(.+)$/);
    if (!match?.[1]) {
      continue;
    }
    const key = match[1];
    const expanded = expandShellEnvValue(match[2] ?? '', shellEnv);
    shellEnv[key] = expanded;
    if (key === 'PATH') {
      pathValue = expanded;
      shellEnv.PATH = expanded;
    }
  }
  return pathValue && pathValue !== baseEnv.PATH ? { PATH: pathValue } : {};
}

function expandShellEnvValue(raw: string, env: NodeJS.ProcessEnv): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  value = value.replace(/^\~(?=\/|$)/, os.homedir());
  return value.replace(/\$(\w+)|\$\{([^}]+)\}/g, (_match, bareKey: string | undefined, bracedKey: string | undefined) => {
    const key = bareKey ?? bracedKey ?? '';
    if (key === 'HOME') {
      return env.HOME ?? os.homedir();
    }
    return env[key] ?? '';
  });
}

function readShellWrapperEnv(provider: string): Record<string, string> {
  const result: Record<string, string> = {};
  const zshrc = path.join(os.homedir(), '.zshrc');
  let content = '';
  try {
    content = readFileSync(zshrc, 'utf8');
  } catch {
    return result;
  }
  const wrapper = extractShellFunction(content, provider);
  if (!wrapper) {
    return result;
  }
  for (const key of PROVIDER_ENV_KEYS) {
    const match = wrapper.match(new RegExp(`(?:^|\\n)\\s*${key}=["']?([^"'\\\\\\n\\s]+)["']?\\s*(?:\\\\|\\n|$)`));
    if (match?.[1]) {
      result[key] = match[1];
    }
  }
  return result;
}

function extractShellFunction(content: string, name: string): string | undefined {
  const startPattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(name)}\\s*\\(\\)\\s*\\{`);
  const match = startPattern.exec(content);
  if (!match) {
    return undefined;
  }
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return content.slice(start, index);
      }
    }
  }
  return undefined;
}

function readClaudeSettingsEnv(cwd?: string, configDirOverride?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of claudeSettingsFiles(cwd, configDirOverride)) {
    Object.assign(env, readSettingsEnvFile(file));
  }
  return env;
}

function claudeSettingsFiles(cwd?: string, configDirOverride?: string): string[] {
  const configDir = resolveHomePath(configDirOverride ?? path.join(os.homedir(), '.claude'));
  const files = [
    path.join(configDir, 'settings.json')
  ];
  const projectDir = cwd ? findProjectSettingsDir(cwd) : undefined;
  if (projectDir) {
    files.push(path.join(projectDir, 'settings.json'));
    files.push(path.join(projectDir, 'settings.local.json'));
  }
  return files;
}

function findProjectSettingsDir(cwd: string): string | undefined {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, '.claude');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function readSettingsEnvFile(file: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { env?: unknown };
    return normalizeEnvRecord(parsed.env);
  } catch {
    return {};
  }
}

function readEnvFile(file: string | undefined): Record<string, string> {
  if (!file) {
    return {};
  }
  try {
    return parseDotEnv(readFileSync(resolveHomePath(file), 'utf8'));
  } catch {
    return {};
  }
}

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    env[match[1]!] = unquoteEnvValue(match[2] ?? '');
  }
  return env;
}

function normalizeEnvRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue === 'string') {
      env[key] = rawValue;
    } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      env[key] = String(rawValue);
    }
  }
  return env;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveHomePath(value: string): string {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
