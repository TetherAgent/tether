import { readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RelayServerToGatewayFrame } from '@tether/protocol';
import { providerEffectiveEnv } from '../provider-env.js';
import type { IChatRunner } from '../chat-session-runner.js';
import type { ChatSessionRegistry } from '../chat/chat-session-registry.js';
import type { RelaySender } from './relay-sender.js';
import type { SessionCatalog } from './session-catalog.js';
import type { SubscriptionManager } from './subscription-manager.js';

type ChatFrame = Extract<RelayServerToGatewayFrame, { type: 'client.chat' }>;
type PermissionResponseFrame = Extract<RelayServerToGatewayFrame, { type: 'client.permission_response' }>;

export type ChatHandlerOptions = {
  chatRegistry: ChatSessionRegistry;
  relaySender: RelaySender;
  sessionCatalog: SessionCatalog;
  subscriptions: SubscriptionManager;
  runnerForProvider: (provider: string) => IChatRunner | undefined;
  sendError: (clientId: string, sessionId: string, code: string, message: string) => void;
};

export class ChatHandler {
  constructor(private readonly options: ChatHandlerOptions) {}

  handleChat(frame: ChatFrame): void {
    if (frame.sessionId === null) {
      const runner = this.options.runnerForProvider(frame.provider);
      if (!runner) {
        this.options.relaySender.error(frame.clientId, '', 'provider_not_supported', `provider is not supported: ${frame.provider}`);
        return;
      }
      void runner.run({
        clientId: frame.clientId,
        sessionId: null,
        provider: frame.provider,
        model: frame.model,
        cwd: frame.cwd,
        message: frame.message,
        accountId: frame.accountId,
        userId: frame.userId
      });
      return;
    }
    if (this.options.chatRegistry.isInFlight(frame.sessionId)) {
      this.options.sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
      return;
    }
    if (!frame.session) {
      this.options.relaySender.error(frame.clientId, frame.sessionId, 'missing_session_metadata', 'trusted session metadata is missing from relay frame');
      return;
    }
    this.options.chatRegistry.upsertFromMetadata(frame.session);
    const runner = this.options.runnerForProvider(frame.session.provider);
    if (!runner) {
      this.options.relaySender.error(frame.clientId, frame.sessionId, 'provider_not_supported', `provider is not supported: ${frame.session.provider}`);
      return;
    }
    this.options.chatRegistry.markInFlight(frame.sessionId);
    void runner.run({
      clientId: frame.clientId,
      sessionId: frame.sessionId,
      message: frame.message,
      model: frame.model,
      session: frame.session
    }).catch((err: unknown) => {
      this.options.chatRegistry.releaseInFlight(frame.sessionId);
      this.options.sendError(frame.clientId, frame.sessionId, 'chat_runner_failed', String(err));
    });
  }

  async sendProviders(clientId: string): Promise<void> {
    const providers = [
      isInstalled('claude') ? { provider: 'claude', models: await providerModels('claude') } : undefined,
      isInstalled('codex') ? { provider: 'codex', models: await providerModels('codex') } : undefined,
      isCopilotInstalled() ? { provider: 'copilot', models: await providerModels('copilot') } : undefined
    ].filter((provider): provider is { provider: string; models: string[] } => provider !== undefined);
    this.sendChatEvent(0, '', 'gateway.providers', { clientId, providers });
  }

  async sendCwdSuggestions(clientId: string, cwd: string): Promise<void> {
    this.sendChatEvent(0, '', 'gateway.cwd-suggestions', {
      clientId,
      cwd,
      suggestions: await directorySuggestions(cwd)
    });
  }

  handleSwitchModel(clientId: string, sessionId: string): void {
    this.options.relaySender.chatCatchup(clientId, sessionId, '模型切换功能将在后续版本中实现');
    this.options.relaySender.error(clientId, sessionId, 'switch_not_implemented', '模型切换功能将在后续版本中实现');
  }

  handlePermissionResponse(frame: PermissionResponseFrame): void {
    if (!this.options.subscriptions.get(frame.clientId, frame.sessionId)) {
      this.options.sendError(frame.clientId, frame.sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    const session = this.options.sessionCatalog.get(frame.sessionId);
    if (session) {
      this.options.runnerForProvider(session.provider)?.respondToPermission(frame.sessionId, frame.requestId, frame.decision);
    }
  }

  private sendChatEvent(id: number, sessionId: string, type: string, payload: Record<string, unknown>): void {
    this.options.relaySender.event({
      id,
      sessionId,
      type,
      ts: Date.now(),
      payload
    });
  }
}

async function providerModels(provider: string): Promise<string[]> {
  const env = providerEffectiveEnv(provider, process.cwd());
  switch (provider) {
    case 'claude':
      return claudeModels();
    case 'codex':
      return codexModels(env);
    case 'copilot':
      return copilotModels(env);
    default:
      return [];
  }
}

function codexModels(env: NodeJS.ProcessEnv): string[] {
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

function copilotModels(env: NodeJS.ProcessEnv): string[] {
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

async function claudeModels(): Promise<string[]> {
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function isInstalled(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return result.status === 0 || result.error === undefined;
}

function isCopilotInstalled(): boolean {
  const result = spawnSync('gh', ['copilot', '--help'], { stdio: 'ignore', timeout: 2000 });
  return result.status === 0;
}

async function directorySuggestions(input: string): Promise<string[]> {
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

function resolveHomePath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}
