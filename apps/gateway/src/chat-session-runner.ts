import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createSessionId } from './ids.js';
import type { ChatEvent, Store } from './store.js';

export type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
};

export type ChatRunnerOptions = {
  store: Store;
  gatewayId: () => string;
  onSessionCreated: (clientId: string, sessionId: string) => void;
  onUserMessage: (event: { clientId: string; sessionId: string; event: ChatEvent<{ message: string }> }) => void;
  onDelta: (event: { clientId: string; sessionId: string; text: string }) => void;
  onResult: (event: {
    clientId: string;
    sessionId: string;
    event: ChatEvent<{ text: string; usage: ChatUsage; stop_reason?: string }>;
    text: string;
    usage: ChatUsage;
    stopReason?: string;
  }) => void;
  onTool: (event: {
    clientId: string;
    sessionId: string;
    event: ChatEvent<{ name: string; input: Record<string, unknown>; result?: string; isError?: boolean }>;
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
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
          workspaceId?: string;
          userId?: string;
        }
      | { clientId: string; sessionId: string; message: string }
  ): Promise<void>;
  getCatchup(sessionId: string): string | undefined;
  kill(sessionId: string): void;
}

type ActiveSubprocess = {
  process: ChildProcess;
  accumulatedText: string;
  startedAt: number;
  clientId: string;
  cwd: string;
  lastUsage: ChatUsage;
  agentSessionId?: string;
  lineBuffer: string;
  completed: boolean;
};

const SUPPORTED_PROVIDER = 'claude';
const ZERO_USAGE: ChatUsage = { input_tokens: 0, output_tokens: 0 };

export class ChatSessionRunner implements IChatRunner {
  private readonly activeSubprocesses = new Map<string, ActiveSubprocess>();

  constructor(private readonly options: ChatRunnerOptions) {}

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
          workspaceId?: string;
          userId?: string;
        }
      | { clientId: string; sessionId: string; message: string }
  ): Promise<void> {
    if ('provider' in params && params.provider !== SUPPORTED_PROVIDER) {
      this.options.onError({
        clientId: params.clientId,
        sessionId: '',
        code: 'provider_not_supported',
        message: 'provider not yet supported'
      });
      return;
    }

    const session =
      params.sessionId === null
        ? this.createChatSession(params)
        : this.options.store.getSession(params.sessionId);
    if (!session) {
      this.options.onError({
        clientId: params.clientId,
        sessionId: params.sessionId ?? '',
        code: 'session_not_found',
        message: 'session not found'
      });
      return;
    }

    const sessionId = session.id;
    const cwd = normalizeCwd(params.sessionId === null ? params.cwd : session.projectPath);
    const providerArgs = [
      '-p',
      params.message,
      '--output-format',
      'stream-json',
      '--verbose',
      ...('model' in params && params.model ? ['--model', params.model] : []),
      ...(session.agentSessionId ? ['--resume', session.agentSessionId] : [])
    ];
    const child = spawn(
      'claude',
      providerArgs,
      {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      }
    );

    const userEvent = this.options.store.appendChatEvent(sessionId, 'user.message', { message: params.message });
    this.options.store.touchSession(sessionId);
    this.options.onUserMessage({ clientId: params.clientId, sessionId, event: userEvent });

    const active: ActiveSubprocess = {
      process: child,
      accumulatedText: '',
      startedAt: Date.now(),
      clientId: params.clientId,
      cwd,
      lastUsage: ZERO_USAGE,
      agentSessionId: session.agentSessionId,
      lineBuffer: '',
      completed: false
    };
    this.activeSubprocesses.set(sessionId, active);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const current = this.activeSubprocesses.get(sessionId);
      if (!current) {
        return;
      }
      current.lineBuffer += chunk.toString();
      const lines = current.lineBuffer.split('\n');
      current.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          this.handleStreamEvent(event, sessionId, current);
        } catch {
          continue;
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const message = chunk.toString().trim();
      if (!message) {
        return;
      }
      this.emitError(params.clientId, sessionId, 'chat_runner_stderr', message);
    });

    child.on('error', (error) => {
      this.emitError(params.clientId, sessionId, 'chat_runner_spawn_failed', error.message);
      this.activeSubprocesses.delete(sessionId);
    });

    child.on('close', (code) => {
      const current = this.activeSubprocesses.get(sessionId);
      if (current?.process === child) {
        if (!current.completed) {
          if (code === 0 && current.accumulatedText) {
            this.emitResult(sessionId, current, current.accumulatedText, current.lastUsage);
            return;
          }
          this.emitError(params.clientId, sessionId, 'chat_runner_exit', `chat runner exited before producing a result${typeof code === 'number' ? ` (${code})` : ''}`);
        }
        this.activeSubprocesses.delete(sessionId);
      }
    });
  }

  getCatchup(sessionId: string): string | undefined {
    return this.activeSubprocesses.get(sessionId)?.accumulatedText;
  }

  kill(sessionId: string): void {
    const active = this.activeSubprocesses.get(sessionId);
    if (!active) {
      return;
    }
    active.process.kill('SIGTERM');
    this.activeSubprocesses.delete(sessionId);
  }

  private createChatSession(params: {
    clientId: string;
    sessionId: null;
    provider: string;
    model: string;
    cwd: string;
    message: string;
    accountId?: string;
    workspaceId?: string;
    userId?: string;
  }) {
    const now = Date.now();
    const sessionId = createSessionId();
    this.options.store.insertSession({
      id: sessionId,
      provider: params.provider,
      title: params.message.slice(0, 60),
      projectPath: normalizeCwd(params.cwd),
      accountId: params.accountId,
      workspaceId: params.workspaceId,
      userId: params.userId,
      gatewayId: this.options.gatewayId(),
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: params.provider,
      transport: 'chat',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });
    this.options.onSessionCreated(params.clientId, sessionId);
    return this.options.store.getSession(sessionId);
  }

  private handleStreamEvent(event: Record<string, unknown>, sessionId: string, active: ActiveSubprocess): void {
    const eventType = typeof event.type === 'string' ? event.type : '';
    if (eventType === 'content_block_delta') {
      const delta = recordValue(event.delta);
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        active.accumulatedText += delta.text;
        this.options.onDelta({ clientId: active.clientId, sessionId, text: delta.text });
      }
      return;
    }

    if (eventType === 'message_start') {
      const message = recordValue(event.message);
      active.agentSessionId = readSessionId(message) ?? active.agentSessionId;
      const usage = normalizeUsage(message?.usage);
      if (usage) {
        active.lastUsage = usage;
      }
      return;
    }

    if (eventType === 'assistant') {
      const message = recordValue(event.message);
      active.agentSessionId = readSessionId(event) ?? readSessionId(message) ?? active.agentSessionId;
      const text = readAssistantText(message);
      if (text) {
        const delta = text.startsWith(active.accumulatedText) ? text.slice(active.accumulatedText.length) : text;
        active.accumulatedText = text;
        if (delta) {
          this.options.onDelta({ clientId: active.clientId, sessionId, text: delta });
        }
      }
      const usage = normalizeUsage(message?.usage);
      if (usage) {
        active.lastUsage = usage;
      }
      return;
    }

    if (eventType === 'message_delta' || eventType === 'message') {
      const message = recordValue(event.message);
      const usage = normalizeUsage(event.usage ?? message?.usage);
      if (usage) {
        active.lastUsage = usage;
      }
      active.agentSessionId = readSessionId(event) ?? readSessionId(message) ?? active.agentSessionId;
      return;
    }

    if (eventType === 'content_block_start') {
      const contentBlock = recordValue(event.content_block);
      if (contentBlock?.type === 'tool_use' && typeof contentBlock.name === 'string') {
        this.emitTool(sessionId, active.clientId, contentBlock.name, recordValue(contentBlock.input) ?? {});
      }
      return;
    }

    if (eventType === 'tool_use') {
      if (typeof event.name === 'string') {
        this.emitTool(sessionId, active.clientId, event.name, recordValue(event.input) ?? {});
      }
      return;
    }

    if (eventType === 'error') {
      const error = recordValue(event.error);
      this.emitError(active.clientId, sessionId, 'chat_runner_error', String(error?.message ?? 'chat runner error'));
      return;
    }

    if (eventType === 'result') {
      if (event.is_error === true) {
        this.emitError(active.clientId, sessionId, 'chat_runner_error', String(event.result ?? 'chat runner error'));
        this.activeSubprocesses.delete(sessionId);
        return;
      }
      const text = typeof event.result === 'string' ? event.result : active.accumulatedText;
      const usage = normalizeUsage(event.usage) ?? active.lastUsage;
      const stopReason = typeof event.stop_reason === 'string'
        ? event.stop_reason
        : typeof event.terminal_reason === 'string'
          ? event.terminal_reason
          : undefined;
      active.agentSessionId = readSessionId(event) ?? active.agentSessionId;
      this.emitResult(sessionId, active, text, usage, stopReason);
      return;
    }

    if (eventType === 'message_stop') {
      const usage = normalizeUsage(event.usage ?? recordValue(event.message)?.usage) ?? active.lastUsage;
      const stopReason = typeof event.stop_reason === 'string' ? event.stop_reason : undefined;
      active.agentSessionId = readSessionId(event) ?? readSessionId(recordValue(event.message)) ?? active.agentSessionId;
      this.emitResult(sessionId, active, active.accumulatedText, usage, stopReason);
    }
  }

  private emitResult(sessionId: string, active: ActiveSubprocess, text: string, usage: ChatUsage, stopReason?: string): void {
    active.completed = true;
    active.accumulatedText = text;
    const agentSessionId = active.agentSessionId ?? randomUUID();
    const resultEvent = this.options.store.appendChatEvent(sessionId, 'agent.result', {
      text,
      usage,
      ...(stopReason ? { stop_reason: stopReason } : {})
    });
    this.options.store.updateAgentSessionId(sessionId, agentSessionId);
    this.options.store.touchSession(sessionId);
    this.options.onAgentIdUpdate(sessionId, agentSessionId);
    this.options.onResult({
      clientId: active.clientId,
      sessionId,
      event: resultEvent,
      text,
      usage,
      stopReason
    });
    this.activeSubprocesses.delete(sessionId);
  }

  private emitTool(sessionId: string, clientId: string, name: string, input: Record<string, unknown>, result?: string, isError?: boolean): void {
    const event = this.options.store.appendChatEvent(sessionId, 'agent.tool', {
      name,
      input,
      ...(result ? { result } : {}),
      ...(isError !== undefined ? { isError } : {})
    });
    this.options.store.touchSession(sessionId);
    this.options.onTool({ clientId, sessionId, event, name, input, result, isError });
  }

  private emitError(clientId: string, sessionId: string, code: string, message: string): void {
    const event = this.options.store.appendChatEvent(sessionId, 'session.error', { code, message });
    this.options.store.touchSession(sessionId);
    this.options.onError({ clientId, sessionId, code, message, event });
  }
}

export class CodexChatRunner implements IChatRunner {
  constructor(private readonly options: ChatRunnerOptions) {}

  async run(params: { clientId: string; sessionId: string | null; message: string; [k: string]: unknown }): Promise<void> {
    this.options.onError({
      clientId: params.clientId,
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
      code: 'provider_not_supported',
      message: 'provider not yet supported'
    });
  }

  getCatchup(_sessionId: string): string | undefined {
    return undefined;
  }

  kill(_sessionId: string): void {}
}

export class CopilotChatRunner implements IChatRunner {
  constructor(private readonly options: ChatRunnerOptions) {}

  async run(params: { clientId: string; sessionId: string | null; message: string; [k: string]: unknown }): Promise<void> {
    this.options.onError({
      clientId: params.clientId,
      sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
      code: 'provider_not_supported',
      message: 'provider not yet supported'
    });
  }

  getCatchup(_sessionId: string): string | undefined {
    return undefined;
  }

  kill(_sessionId: string): void {}
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function normalizeCwd(value: string): string {
  const trimmed = value.trim();
  return trimmed || process.cwd();
}

function readAssistantText(message: Record<string, unknown> | undefined): string | undefined {
  const content = message?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
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
  if (!usage) {
    return undefined;
  }
  const input_tokens = numberValue(usage.input_tokens);
  const output_tokens = numberValue(usage.output_tokens);
  if (input_tokens === undefined || output_tokens === undefined) {
    return undefined;
  }
  const cost_usd = numberValue(usage.cost_usd);
  return {
    input_tokens,
    output_tokens,
    ...(cost_usd === undefined ? {} : { cost_usd })
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readSessionId(value: unknown): string | undefined {
  const record = recordValue(value);
  return typeof record?.session_id === 'string' ? record.session_id : undefined;
}
