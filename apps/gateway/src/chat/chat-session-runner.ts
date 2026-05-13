import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionId } from '../utils/ids.js';
import { nextEventId } from '../utils/events.js';
import { providerEffectiveEnv, providerLaunchCommand } from '../utils/provider-env.js';
import type { ChatEvent, ChatEventType } from '../types.js';
import type { TrustedChatSessionMetadata } from '@tether/protocol';

// ─── Public types ────────────────────────────────────────────────────────────

export type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type RateLimitInfo = {
  // Claude-style
  resetsAt?: number;
  rateLimitType?: string;
  status?: string;
  // Codex-style (read from ~/.codex session jsonl)
  primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  planType?: string;
};

export type NextSuggestion = {
  description: string;
  title?: string;
  toolName?: string;
  reason?: string;
};

export type ChatRunnerOptions = {
  gatewayId: () => string;
  onSessionCreated: (clientId: string, sessionId: string) => void;
  onChatSessionCreated: (clientId: string, metadata: TrustedChatSessionMetadata) => void;
  onPermissionRequest: (event: { clientId: string; sessionId: string; requestId: string; toolName: string; input: Record<string, unknown> }) => void;
  onUserMessage: (event: { clientId: string; sessionId: string; event: ChatEvent<{ message: string }> }) => void;
  onDelta: (event: { clientId: string; sessionId: string; text: string; deltaEventId: number; providerRaw?: unknown }) => void;
  onResult: (event: {
    clientId: string;
    sessionId: string;
    event: ChatEvent<{ text: string; usage: ChatUsage; stop_reason?: string; providerRaw?: unknown }>;
    text: string;
    usage: ChatUsage;
    stopReason?: string;
    contextWindow?: number;
    rateLimitInfo?: RateLimitInfo;
    contextInputTokens?: number;
    nextSuggestions?: NextSuggestion[];
    providerRaw?: unknown;
  }) => void;
  onTool: (event: {
    clientId: string;
    sessionId: string;
    event: ChatEvent<{ name: string; input: Record<string, unknown>; result?: string; isError?: boolean; providerRaw?: unknown }>;
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
    providerRaw?: unknown;
  }) => void;
  onError: (event: {
    clientId: string;
    sessionId: string;
    code: string;
    message: string;
    event?: ChatEvent<{ code: string; message: string }>;
  }) => void;
  onAgentIdUpdate: (sessionId: string, agentSessionId: string) => void;
};

const CHAT_TITLE_MAX_LENGTH = 64;

function titleFromFirstMessage(message: string): string | undefined {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  const chars = Array.from(normalized);
  if (chars.length <= CHAT_TITLE_MAX_LENGTH) {
    return normalized;
  }
  return `${chars.slice(0, CHAT_TITLE_MAX_LENGTH).join('')}...`;
}

function createChatEvent<TPayload extends Record<string, unknown>>(
  sessionId: string,
  type: ChatEventType,
  payload: TPayload,
  ts = Date.now()
): ChatEvent<TPayload> {
  return {
    id: nextEventId(ts),
    sessionId,
    type,
    ts,
    payload
  };
}

export interface IChatRunner {
  run(
    params:
      | {
          clientId: string;
          sessionId: null;
          provider: string;
          model: string;
          cwd: string;
          message: string;
          accountId?: string;
          userId?: string;
        }
      | { clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }
  ): Promise<void>;
  getCatchup(sessionId: string): string | undefined;
  kill(sessionId: string): void;
  respondToPermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): void;
}

// ─── Provider Adapter Contract ────────────────────────────────────────────────
//
// Implement CliProviderAdapter to add a new CLI provider.
// The CliChatRunner handles all process lifecycle, session management, and
// routing — the adapter only needs to know how to build args and parse lines.

export type BuildArgsParams = {
  message: string;
  model?: string;
  cwd: string;
  sessionId: string;
  agentSessionId?: string;
};

/**
 * Callbacks passed to handleLine. Call the relevant methods as events arrive.
 *
 * Required path every turn:
 *   - Call result() exactly once to signal turn completion.
 *
 * Optional enrichment (call only if the provider supports it):
 *   - delta()            — streaming text chunk (skip for batch providers)
 *   - rateLimitInfo()    — rate-limit reset data → shown in usage stats UI
 *   - contextWindow()    — context window size → used to compute Context %
 *   - agentSessionId()   — update the resume ID for this session
 *   - tool()             — tool use event
 *   - permissionRequest()— permission gate the user must approve
 *   - nextSuggestions   — pass post-result suggestions via result() options
 *   - setLastUsage()     — update tracked usage before calling result()
 */
export type LineEmitter = {
  delta(text: string, providerRaw?: unknown): void;
  result(text: string, usage: ChatUsage, opts?: { stopReason?: string; nextSuggestions?: NextSuggestion[]; providerRaw?: unknown }): void;
  rateLimitInfo(info: RateLimitInfo): void;
  contextWindow(tokens: number): void;
  contextInputTokens(tokens: number): void;
  agentSessionId(id: string): void;
  tool(name: string, input: Record<string, unknown>, providerRaw?: unknown): void;
  permissionRequest(requestId: string, toolName: string, input: Record<string, unknown>): void;
  error(code: string, message: string): void;
  setLastUsage(usage: ChatUsage): void;
  getAccumulated(): string;
  getLastUsage(): ChatUsage;
};

/**
 * Implement this interface to support a new CLI provider.
 * One adapter instance is shared across all sessions of that provider.
 */
export interface CliProviderAdapter {
  /** Matched against session.provider for routing. */
  readonly provider: string;
  /** Executable name, e.g. 'claude', 'codex', 'gh'. */
  readonly command: string;
  /** Build the CLI argument list for a new or resumed turn. */
  buildArgs(params: BuildArgsParams): string[];
  /**
   * Parse one stdout line and call the appropriate emit methods.
   * Called for every non-empty line. JSON parse errors are caught by the runner.
   */
  handleLine(line: string, emit: LineEmitter): void;
  /**
   * Write a permission response back to the process.
   * Omit if the provider does not support bidirectional permission flow.
   */
  respondToPermission?(process: ChildProcess, requestId: string, decision: 'allow' | 'deny'): void;
  /**
   * Called after each turn completes, before onResult fires.
   * Use to read out-of-band usage data (e.g. local session files).
   * Return null to skip; returned info is merged into rateLimitInfo if not already set.
   */
  afterTurn?(cwd: string): Promise<RateLimitInfo | null>;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

const ZERO_USAGE: ChatUsage = { input_tokens: 0, output_tokens: 0 };

function isIgnorableCodexStderr(message: string): boolean {
  return (
    message.includes('Reading additional input from stdin') ||
    message.includes('failed to record rollout items: thread')
  );
}

function trimStderrMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized;
}

type ActiveSubprocess = {
  process: ChildProcess;
  accumulatedText: string;
  startedAt: number;
  clientId: string;
  cwd: string;
  lastStderr?: string;
  lastUsage: ChatUsage;
  agentSessionId?: string;
  lastEmittedAgentSessionId?: string;
  lineBuffer: string;
  completed: boolean;
  nextDeltaId: number;
  rateLimitInfo?: RateLimitInfo;
  contextWindow?: number;
  contextInputTokens?: number;
  pendingPermissions: Map<string, (decision: 'allow' | 'deny') => void>;
};

// ─── Base runner ──────────────────────────────────────────────────────────────

class CliChatRunner implements IChatRunner {
  private readonly activeSubprocesses = new Map<string, ActiveSubprocess>();

  constructor(
    private readonly options: ChatRunnerOptions,
    private readonly adapter: CliProviderAdapter
  ) {}

  async run(
    params:
      | {
          clientId: string;
          sessionId: null;
          provider: string;
          model: string;
          cwd: string;
          message: string;
          accountId?: string;
          userId?: string;
        }
      | { clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }
  ): Promise<void> {
    if ('provider' in params && params.provider !== this.adapter.provider) {
      this.options.onError({
        clientId: params.clientId,
        sessionId: '',
        code: 'provider_not_supported',
        message: `${params.provider} is not handled by ${this.adapter.provider} runner`
      });
      return;
    }

    const session: TrustedChatSessionMetadata =
      params.sessionId === null
        ? this.createChatSession(params)
        : params.session;

    const sessionId = session.id;
    const cwd = normalizeCwd(params.sessionId === null ? params.cwd : session.projectPath);
    const args = this.adapter.buildArgs({
      message: params.message,
      model: 'model' in params ? params.model : undefined,
      cwd,
      sessionId,
      agentSessionId: session.agentSessionId
    });

    logger.info('chat', 'session started', { sessionId, provider: this.adapter.provider });
    const env = providerEffectiveEnv(this.adapter.provider, cwd);
    const launch = providerLaunchCommand(this.adapter.provider, this.adapter.command, args, env);
    const child = spawn(launch.command, launch.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    });
    if (!this.adapter.respondToPermission) {
      child.stdin?.end();
    }

    const userEvent = createChatEvent(sessionId, 'user.message', { message: params.message });
    this.options.onUserMessage({ clientId: params.clientId, sessionId, event: userEvent });

    const active: ActiveSubprocess = {
      process: child,
      accumulatedText: '',
      startedAt: Date.now(),
      clientId: params.clientId,
      cwd,
      lastStderr: undefined,
      lastUsage: ZERO_USAGE,
      agentSessionId: session.agentSessionId,
      lastEmittedAgentSessionId: undefined,
      lineBuffer: '',
      completed: false,
      nextDeltaId: 1,
      pendingPermissions: new Map()
    };
    this.activeSubprocesses.set(sessionId, active);

    const emit = this.createEmitter(sessionId, active);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (!this.activeSubprocesses.has(sessionId)) return;
      active.lineBuffer += chunk.toString();
      const lines = active.lineBuffer.split('\n');
      active.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.adapter.handleLine(line, emit);
        } catch {
          // ignore parse errors from individual lines
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const message = chunk.toString().trim();
      if (this.adapter.provider === 'codex' && isIgnorableCodexStderr(message)) return;
      if (message) active.lastStderr = trimStderrMessage(message);
    });

    child.on('error', (error) => {
      logger.error('chat', 'runner spawn failed', { sessionId, error: error.message });
      emit.error('chat_runner_spawn_failed', error.message);
      this.activeSubprocesses.delete(sessionId);
    });

    child.on('close', (code) => {
      const current = this.activeSubprocesses.get(sessionId);
      if (current?.process !== child) return;
      if (!current.completed) {
        if (code === 0 && current.accumulatedText) {
          void this.finishResult(sessionId, current, current.accumulatedText, current.lastUsage);
          return;
        }
        const errMsg = [
          `${this.adapter.provider} exited before producing a result${typeof code === 'number' ? ` (${code})` : ''}`,
          current.lastStderr
        ].filter(Boolean).join(': ');
        logger.error('chat', 'runner exited with error', { sessionId, code, error: errMsg });
        emit.error('chat_runner_exit', errMsg);
      } else {
        logger.info('chat', 'session ended', { sessionId });
      }
      this.activeSubprocesses.delete(sessionId);
    });
  }

  getCatchup(sessionId: string): string | undefined {
    return this.activeSubprocesses.get(sessionId)?.accumulatedText;
  }

  kill(sessionId: string): void {
    const active = this.activeSubprocesses.get(sessionId);
    if (!active) return;
    active.process.kill('SIGTERM');
    this.activeSubprocesses.delete(sessionId);
  }

  respondToPermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): void {
    const active = this.activeSubprocesses.get(sessionId);
    if (!active) return;
    const callback = active.pendingPermissions.get(requestId);
    if (callback) {
      callback(decision);
      active.pendingPermissions.delete(requestId);
    }
  }

  private createEmitter(sessionId: string, active: ActiveSubprocess): LineEmitter {
    return {
      delta: (text, providerRaw) => {
        active.accumulatedText += text;
        const deltaEventId = active.nextDeltaId++;
        this.options.onDelta({ clientId: active.clientId, sessionId, text, deltaEventId, providerRaw });
      },
      result: (text, usage, opts) => {
        void this.finishResult(sessionId, active, text, usage, opts?.stopReason, opts?.nextSuggestions, opts?.providerRaw);
      },
      rateLimitInfo: (info) => { active.rateLimitInfo = info; },
      contextWindow: (tokens) => { active.contextWindow = tokens; },
      contextInputTokens: (tokens) => { active.contextInputTokens = tokens; },
      agentSessionId: (id) => {
        this.emitAgentSessionId(sessionId, active, id);
      },
      tool: (name, input, providerRaw) => { this.emitTool(sessionId, active.clientId, name, input, providerRaw); },
      permissionRequest: (requestId, toolName, input) => {
        active.pendingPermissions.set(requestId, (decision) => {
          this.adapter.respondToPermission?.(active.process, requestId, decision);
        });
        this.options.onPermissionRequest({ clientId: active.clientId, sessionId, requestId, toolName, input });
      },
      error: (code, message) => { this.emitError(active.clientId, sessionId, code, message); },
      setLastUsage: (usage) => { active.lastUsage = usage; },
      getAccumulated: () => active.accumulatedText,
      getLastUsage: () => active.lastUsage
    };
  }

  private async finishResult(sessionId: string, active: ActiveSubprocess, text: string, usage: ChatUsage, stopReason?: string, nextSuggestions?: NextSuggestion[], providerRaw?: unknown): Promise<void> {
    active.completed = true;
    active.accumulatedText = text;
    if (this.adapter.afterTurn && !active.rateLimitInfo) {
      active.rateLimitInfo = await this.adapter.afterTurn(active.cwd).catch(() => null) ?? undefined;
    }
    const agentSessionId = active.agentSessionId ?? randomUUID();
    const lastDeltaEventId = active.nextDeltaId > 1 ? active.nextDeltaId - 1 : 0;
    const resultEvent = createChatEvent(sessionId, 'agent.result', {
      text,
      usage,
      lastDeltaEventId,
      ...(stopReason ? { stop_reason: stopReason } : {}),
      ...(providerRaw !== undefined ? { providerRaw } : {})
    });
    this.emitAgentSessionId(sessionId, active, agentSessionId);
    this.options.onResult({
      clientId: active.clientId,
      sessionId,
      event: resultEvent,
      text,
      usage,
      stopReason,
      contextWindow: active.contextWindow,
      rateLimitInfo: active.rateLimitInfo,
      contextInputTokens: active.contextInputTokens,
      nextSuggestions,
      providerRaw
    });
    this.activeSubprocesses.delete(sessionId);
  }

  private emitAgentSessionId(sessionId: string, active: ActiveSubprocess, agentSessionId: string): void {
    if (active.lastEmittedAgentSessionId === agentSessionId) {
      active.agentSessionId = agentSessionId;
      return;
    }
    active.agentSessionId = agentSessionId;
    active.lastEmittedAgentSessionId = agentSessionId;
    this.options.onAgentIdUpdate(sessionId, agentSessionId);
  }

  private emitTool(sessionId: string, clientId: string, name: string, input: Record<string, unknown>, providerRaw?: unknown): void {
    const event = createChatEvent(sessionId, 'agent.tool', {
      name,
      input,
      ...(providerRaw !== undefined ? { providerRaw } : {})
    });
    this.options.onTool({ clientId, sessionId, event, name, input, providerRaw });
  }

  private emitError(clientId: string, sessionId: string, code: string, message: string): void {
    const event = createChatEvent(sessionId, 'session.error', { code, message });
    this.options.onError({ clientId, sessionId, code, message, event });
  }

  private createChatSession(params: {
    clientId: string;
    sessionId: null;
    provider: string;
    model: string;
    cwd: string;
    message: string;
    accountId?: string;
    userId?: string;
  }): TrustedChatSessionMetadata {
    const sessionId = createSessionId();
    const metadata: TrustedChatSessionMetadata = {
      id: sessionId,
      provider: params.provider,
      title: titleFromFirstMessage(params.message),
      projectPath: normalizeCwd(params.cwd),
      accountId: params.accountId ?? '',
      userId: params.userId ?? '',
      gatewayId: this.options.gatewayId(),
      transport: 'chat'
    };
    this.options.onChatSessionCreated(params.clientId, metadata);
    return metadata;
  }
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

class ClaudeAdapter implements CliProviderAdapter {
  readonly provider = 'claude';
  readonly command = 'claude';

  buildArgs({ message, model, agentSessionId }: BuildArgsParams): string[] {
    return [
      '-p', message,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(model ? ['--model', model] : []),
      ...(agentSessionId ? ['--resume', agentSessionId] : [])
    ];
  }

  handleLine(line: string, emit: LineEmitter): void {
    const event = JSON.parse(line) as Record<string, unknown>;
    const type = typeof event.type === 'string' ? event.type : '';

    if (type === 'content_block_delta') {
      const delta = recordValue(event.delta);
      if ((delta?.type === 'text_delta' || delta?.type === 'text') && typeof delta.text === 'string') {
        emit.delta(delta.text);
      }
      return;
    }

    if (type === 'message_start') {
      const message = recordValue(event.message);
      const id = readSessionId(message);
      if (id) emit.agentSessionId(id);
      const usage = normalizeUsage(message?.usage);
      if (usage) emit.setLastUsage(usage);
      return;
    }

    if (type === 'assistant') {
      const message = recordValue(event.message);
      const id = readSessionId(event) ?? readSessionId(message);
      if (id) emit.agentSessionId(id);
      const text = readAssistantText(message);
      if (text) {
        const accumulated = emit.getAccumulated();
        const chunk = text.startsWith(accumulated) ? text.slice(accumulated.length) : text;
        if (chunk) emit.delta(chunk);
      }
      const usage = normalizeUsage(message?.usage);
      if (usage) emit.setLastUsage(usage);
      return;
    }

    if (type === 'message_delta' || type === 'message') {
      const message = recordValue(event.message);
      const usage = normalizeUsage(event.usage ?? message?.usage);
      if (usage) emit.setLastUsage(usage);
      const id = readSessionId(event) ?? readSessionId(message);
      if (id) emit.agentSessionId(id);
      return;
    }

    if (type === 'content_block_start') {
      const block = recordValue(event.content_block);
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        emit.tool(block.name, recordValue(block.input) ?? {}, event);
      }
      return;
    }

    if (type === 'tool_use') {
      if (typeof event.name === 'string') {
        emit.tool(event.name, recordValue(event.input) ?? {}, event);
      }
      return;
    }

    if (type === 'rate_limit_event') {
      const info = recordValue(event.rate_limit_info);
      if (info) {
        const resetsAt = numberValue(info.resetsAt);
        const rateLimitType = typeof info.rateLimitType === 'string' ? info.rateLimitType : '';
        const status = typeof info.status === 'string' ? info.status : 'unknown';
        if (resetsAt !== undefined) emit.rateLimitInfo({ resetsAt, rateLimitType, status });
      }
      return;
    }

    if (type === 'control_request') {
      const requestId = typeof event.request_id === 'string' ? event.request_id : undefined;
      const request = recordValue(event.request);
      if (requestId && request?.subtype === 'can_use_tool' && typeof request.tool_name === 'string') {
        emit.permissionRequest(requestId, request.tool_name, recordValue(request.input) ?? {});
      }
      return;
    }

    if (type === 'error') {
      const error = recordValue(event.error);
      emit.error('chat_runner_error', String(error?.message ?? 'chat runner error'));
      return;
    }

    if (type === 'result') {
      if (event.is_error === true) {
        emit.error('chat_runner_error', String(event.result ?? 'chat runner error'));
        return;
      }
      const text = typeof event.result === 'string' ? event.result : emit.getAccumulated();
      const usage = normalizeUsage(event.usage) ?? emit.getLastUsage();
      const stopReason =
        typeof event.stop_reason === 'string' ? event.stop_reason :
        typeof event.terminal_reason === 'string' ? event.terminal_reason : undefined;
      const id = readSessionId(event);
      if (id) emit.agentSessionId(id);
      // Extract contextWindow from modelUsage
      const modelUsage = recordValue(event.modelUsage);
      if (modelUsage) {
        const firstKey = Object.keys(modelUsage)[0];
        const modelData = firstKey ? recordValue((modelUsage as Record<string, unknown>)[firstKey]) : undefined;
        if (modelData) {
          const cw = numberValue(modelData.contextWindow);
          if (cw !== undefined) emit.contextWindow(cw);
        }
      }
      // Extract last iteration's input tokens for accurate context % (top-level totals accumulate across all agentic sub-calls)
      const rawUsage = recordValue(event.usage);
      const iterations = Array.isArray(rawUsage?.iterations) ? rawUsage!.iterations as unknown[] : [];
      const lastIter = iterations.length > 0 ? recordValue(iterations[iterations.length - 1]) : undefined;
      if (lastIter) {
        const iterInput = numberValue(lastIter.input_tokens) ?? 0;
        const iterCacheRead = numberValue(lastIter.cache_read_input_tokens) ?? 0;
        const iterCacheCreate = numberValue(lastIter.cache_creation_input_tokens) ?? 0;
        emit.contextInputTokens(iterInput + iterCacheRead + iterCacheCreate);
      }
      emit.result(text, usage, { stopReason, nextSuggestions: suggestionsFromPermissionDenials(event.permission_denials), providerRaw: event });
      return;
    }

    if (type === 'message_stop') {
      const usage = normalizeUsage(event.usage ?? recordValue(event.message)?.usage) ?? emit.getLastUsage();
      const stopReason = typeof event.stop_reason === 'string' ? event.stop_reason : undefined;
      const id = readSessionId(event) ?? readSessionId(recordValue(event.message));
      if (id) emit.agentSessionId(id);
      emit.result(emit.getAccumulated(), usage, { stopReason, providerRaw: event });
    }
  }

  respondToPermission(process: ChildProcess, requestId: string, decision: 'allow' | 'deny'): void {
    const response = JSON.stringify({
      type: 'control_response',
      subtype: decision === 'allow' ? 'success' : 'deny',
      request_id: requestId
    });
    process.stdin?.write(`${response}\n`);
  }
}

class CodexAdapter implements CliProviderAdapter {
  readonly provider = 'codex';
  readonly command = 'codex';

  buildArgs({ message, model, cwd, agentSessionId }: BuildArgsParams): string[] {
    const modelArgs = model ? ['--model', model] : [];
    return agentSessionId
      ? ['exec', 'resume', '--json', '--skip-git-repo-check', ...modelArgs, agentSessionId, message]
      : ['exec', '--json', '--skip-git-repo-check', '--color', 'never', '-C', cwd, ...modelArgs, message];
  }

  handleLine(line: string, emit: LineEmitter): void {
    const event = JSON.parse(line) as Record<string, unknown>;
    const type = typeof event.type === 'string' ? event.type : '';

    if (type === 'thread.started') {
      const threadId = typeof event.thread_id === 'string' ? event.thread_id : undefined;
      if (threadId) emit.agentSessionId(threadId);
      return;
    }

    if (type === 'item.completed') {
      const item = recordValue(event.item);
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
        const accumulated = emit.getAccumulated();
        const chunk = item.text.startsWith(accumulated) ? item.text.slice(accumulated.length) : item.text;
        if (chunk) emit.delta(chunk);
      }
      return;
    }

    if (type === 'turn.completed') {
      const raw = recordValue(event.usage);
      const usage: ChatUsage = raw
        ? {
            input_tokens: numberValue(raw.input_tokens) ?? 0,
            output_tokens: numberValue(raw.output_tokens) ?? 0,
            ...(numberValue(raw.cached_input_tokens) !== undefined
              ? { cache_read_input_tokens: numberValue(raw.cached_input_tokens) }
              : {})
          }
        : emit.getLastUsage();
      emit.result(emit.getAccumulated(), usage, { providerRaw: event });
      return;
    }

    if (type === 'error') {
      emit.error('chat_runner_error', String(event.message ?? 'codex error'));
    }
  }

  async afterTurn(_cwd: string): Promise<RateLimitInfo | null> {
    return readCodexRateLimits();
  }
}

class CopilotAdapter implements CliProviderAdapter {
  readonly provider = 'copilot';
  readonly command = 'gh';

  buildArgs({ message, model, cwd, sessionId, agentSessionId }: BuildArgsParams): string[] {
    return [
      'copilot',
      '--prompt', message,
      '--silent',
      '--no-color',
      '--output-format', 'json',
      '--stream', 'on',
      '--allow-all',
      '-C', cwd,
      ...(model ? ['--model', model] : []),
      ...(agentSessionId ? [`--resume=${agentSessionId}`] : ['--name', sessionId])
    ];
  }

  handleLine(line: string, emit: LineEmitter): void {
    const event = JSON.parse(line) as Record<string, unknown>;
    const type = typeof event.type === 'string' ? event.type : '';

    if (type === 'assistant.message_delta') {
      const data = recordValue(event.data);
      if (typeof data?.deltaContent === 'string' && data.deltaContent) {
        emit.delta(data.deltaContent);
      }
      return;
    }

    if (type === 'assistant.message') {
      const data = recordValue(event.data);
      const outputTokens = numberValue(data?.outputTokens);
      if (outputTokens !== undefined) {
        emit.setLastUsage({ input_tokens: 0, output_tokens: outputTokens });
      }
      return;
    }

    if (type === 'result') {
      if (typeof event.sessionId === 'string') emit.agentSessionId(event.sessionId);
      emit.result(emit.getAccumulated(), emit.getLastUsage(), { providerRaw: event });
      return;
    }

    if (type === 'error') {
      emit.error('chat_runner_error', String(event.message ?? 'copilot error'));
    }
  }
}

// ─── Public runners (thin wrappers) ───────────────────────────────────────────

export class ChatSessionRunner extends CliChatRunner {
  constructor(options: ChatRunnerOptions) {
    super(options, new ClaudeAdapter());
  }
}

export class CodexChatRunner extends CliChatRunner {
  constructor(options: ChatRunnerOptions) {
    super(options, new CodexAdapter());
  }
}

export class CopilotChatRunner extends CliChatRunner {
  constructor(options: ChatRunnerOptions) {
    super(options, new CopilotAdapter());
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function normalizeCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return process.cwd();
  if (trimmed === '~') return os.homedir();
  return trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed;
}

function readAssistantText(message: Record<string, unknown> | undefined): string | undefined {
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => {
      const block = recordValue(item);
      return block?.type === 'text' && typeof block.text === 'string' ? block.text : '';
    })
    .join('');
  return text || undefined;
}

function normalizeUsage(value: unknown): ChatUsage | undefined {
  const usage = recordValue(value);
  if (!usage) return undefined;
  const input_tokens = numberValue(usage.input_tokens);
  const output_tokens = numberValue(usage.output_tokens);
  if (input_tokens === undefined || output_tokens === undefined) return undefined;
  return {
    input_tokens,
    output_tokens,
    ...(numberValue(usage.cost_usd) !== undefined ? { cost_usd: numberValue(usage.cost_usd) } : {}),
    ...(numberValue(usage.cache_creation_input_tokens) !== undefined ? { cache_creation_input_tokens: numberValue(usage.cache_creation_input_tokens) } : {}),
    ...(numberValue(usage.cache_read_input_tokens) !== undefined ? { cache_read_input_tokens: numberValue(usage.cache_read_input_tokens) } : {})
  };
}

function suggestionsFromPermissionDenials(value: unknown): NextSuggestion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const suggestions = value
    .map((item, index) => suggestionFromPermissionDenial(item, index))
    .filter((item): item is NextSuggestion => Boolean(item));
  return suggestions.length > 0 ? suggestions.slice(0, 3) : undefined;
}

function suggestionFromPermissionDenial(value: unknown, index: number): NextSuggestion | undefined {
  const record = recordValue(value);
  if (!record) {
    return undefined;
  }
  const toolName = stringValue(record.tool_name ?? record.toolName ?? record.name);
  const reason = stringValue(record.reason ?? record.message ?? record.error);
  const input = recordValue(record.input);
  const command = stringValue(input?.command ?? input?.cmd ?? input?.description);
  const pathValue = stringValue(input?.path ?? input?.file_path ?? input?.filePath);
  const target = command ?? pathValue;
  const label = toolName ? `${toolName}${target ? `: ${truncateText(target, 80)}` : ''}` : `操作 ${index + 1}`;
  return {
    title: '重新授权重试',
    description: `请重新尝试并在需要时允许 ${label}`,
    ...(toolName ? { toolName } : {}),
    ...(reason ? { reason } : {})
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readSessionId(value: unknown): string | undefined {
  const record = recordValue(value);
  return typeof record?.session_id === 'string' ? record.session_id : undefined;
}

async function readCodexRateLimits(): Promise<RateLimitInfo | null> {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');
  const entries = await fsp.readdir(sessionsDir, { recursive: true }).catch(() => [] as string[]);
  const jsonlFiles = (entries as string[])
    .filter(e => path.basename(e).startsWith('rollout-') && e.endsWith('.jsonl'))
    .map(e => path.join(sessionsDir, e));
  if (!jsonlFiles.length) return null;

  const withStats = await Promise.all(
    jsonlFiles.map(f => fsp.stat(f).then(s => ({ f, mtime: s.mtimeMs })).catch(() => null))
  );
  const valid = withStats.filter((x): x is { f: string; mtime: number } => x !== null);
  valid.sort((a, b) => b.mtime - a.mtime);
  const newest = valid[0]?.f;
  if (!newest) return null;

  const content = await fsp.readFile(newest, 'utf8').catch(() => '');
  const lines = content.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]) as Record<string, unknown>;
      const payload = recordValue(event.payload);
      if (payload?.type !== 'token_count') continue;
      const rl = recordValue(payload.rate_limits);
      if (!rl) continue;
      const primary = recordValue(rl.primary);
      const secondary = recordValue(rl.secondary);
      return {
        primary: primary ? {
          usedPercent: numberValue(primary.used_percent) ?? 0,
          windowMinutes: numberValue(primary.window_minutes),
          resetsAt: numberValue(primary.resets_at)
        } : undefined,
        secondary: secondary ? {
          usedPercent: numberValue(secondary.used_percent) ?? 0,
          windowMinutes: numberValue(secondary.window_minutes),
          resetsAt: numberValue(secondary.resets_at)
        } : undefined,
        planType: typeof rl.plan_type === 'string' ? rl.plan_type : undefined
      };
    } catch { /* skip malformed line */ }
  }
  return null;
}
