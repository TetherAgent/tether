import { closeSync, openSync, readdirSync, readSync, statSync, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderName } from '@tether/core';
import type { SessionEvent, Store } from './store.js';

function truncateInput(input: unknown): string {
  const serialized = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  if (serialized.length <= 100) {
    return serialized;
  }
  return `${serialized.slice(0, 100)}...`;
}

function resolveCodexJournalPath(agentSessionId: string): string | undefined {
  const base = path.join(os.homedir(), '.codex', 'sessions');
  try {
    for (const year of readdirSync(base)) {
      const yearDir = path.join(base, year);
      if (!statSync(yearDir).isDirectory()) continue;
      for (const month of readdirSync(yearDir)) {
        const monthDir = path.join(yearDir, month);
        if (!statSync(monthDir).isDirectory()) continue;
        for (const day of readdirSync(monthDir)) {
          const dayDir = path.join(monthDir, day);
          if (!statSync(dayDir).isDirectory()) continue;
          for (const file of readdirSync(dayDir)) {
            if (file.endsWith(`${agentSessionId}.jsonl`)) {
              return path.join(dayDir, file);
            }
          }
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveJournalPath(provider: ProviderName, projectPath: string, agentSessionId: string): string | undefined {
  const home = os.homedir();
  if (provider === 'claude' || provider === 'claude-proxy') {
    const encoded = projectPath.replaceAll('/', '-');
    return path.join(home, '.claude', 'projects', encoded, `${agentSessionId}.jsonl`);
  }
  if (provider === 'codex' || provider === 'codex-proxy') {
    return resolveCodexJournalPath(agentSessionId);
  }
  return undefined;
}

export class JournalWatcher {
  private lastOffset = 0;
  private residual = '';
  private watcher?: FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private existenceTimer?: NodeJS.Timeout;
  private filePath?: string;
  private codexPendingTexts: string[] = [];
  private codexInTask = false;

  constructor(
    private readonly sessionId: string,
    private readonly provider: ProviderName,
    private readonly agentSessionId: string,
    private readonly projectPath: string,
    private readonly store: Store,
    private readonly publishEvent: (event: SessionEvent) => void
  ) {}

  start(): void {
    const resolved = resolveJournalPath(this.provider, this.projectPath, this.agentSessionId);
    if (!resolved) return;
    this.filePath = resolved;

    try {
      statSync(this.filePath);
      this.attachWatcher();
    } catch {
      this.existenceTimer = setInterval(() => {
        try {
          if (!this.filePath) return;
          statSync(this.filePath);
          clearInterval(this.existenceTimer);
          this.existenceTimer = undefined;
          this.attachWatcher();
        } catch {
          // Keep waiting.
        }
      }, 1000);
      this.existenceTimer.unref?.();
    }
  }

  stop(): void {
    clearInterval(this.existenceTimer);
    clearInterval(this.pollTimer);
    this.watcher?.close();
    this.existenceTimer = undefined;
    this.pollTimer = undefined;
    this.watcher = undefined;
  }

  processClaudeEntry(entry: Record<string, unknown>): void {
    if (entry.type !== 'assistant') return;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || !Array.isArray(message.content)) return;

    let textContent = '';
    const tools: Array<{ name: string; inputSummary: string }> = [];

    for (const item of message.content) {
      const block = item as Record<string, unknown>;
      if (block.type === 'text') {
        textContent += String(block.text ?? '');
      } else if (block.type === 'tool_use') {
        tools.push({
          name: String(block.name ?? ''),
          inputSummary: truncateInput(block.input)
        });
      }
    }

    if (!textContent && tools.length === 0) return;
    this.emitAssistantTurn(textContent, tools);
  }

  processCodexEntry(entry: Record<string, unknown>): void {
    const type = entry.type as string;
    if (type === 'event_msg') {
      const payload = entry.payload as Record<string, unknown> | undefined;
      const eventType = payload?.type as string | undefined;
      if (eventType === 'task_started') {
        this.codexInTask = true;
        this.codexPendingTexts = [];
      } else if (eventType === 'task_completed' || eventType === 'task_complete') {
        if (this.codexInTask && this.codexPendingTexts.length > 0) {
          this.emitAssistantTurn(this.codexPendingTexts.join('\n\n'), []);
        }
        this.codexInTask = false;
        this.codexPendingTexts = [];
      } else if (eventType === 'user_message' && typeof payload?.message === 'string' && payload.message.trim()) {
        this.emitUserTurn(payload.message);
      }
      return;
    }

    const payload = entry.payload as Record<string, unknown> | undefined;
    if (type !== 'response_item' || !this.codexInTask || payload?.role !== 'assistant') return;
    const content = payload.content as unknown[] | undefined;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const item = block as Record<string, unknown>;
      if (item.type === 'output_text') {
        const text = String(item.text ?? '');
        if (text.trim()) this.codexPendingTexts.push(text);
      }
    }
  }

  private attachWatcher(): void {
    this.tryRead();
    if (!this.filePath) return;
    this.watcher = watch(this.filePath, { persistent: false }, () => this.tryRead());
    this.pollTimer = setInterval(() => this.tryRead(), 2000);
    this.pollTimer.unref?.();
  }

  private tryRead(): void {
    if (!this.filePath) return;
    try {
      const { size } = statSync(this.filePath);
      if (size <= this.lastOffset) return;
      const fd = openSync(this.filePath, 'r');
      const chunkSize = size - this.lastOffset;
      const chunkBuffer = Buffer.alloc(chunkSize);
      readSync(fd, chunkBuffer, 0, chunkBuffer.length, this.lastOffset);
      closeSync(fd);
      this.lastOffset = size;

      const lines = `${this.residual}${chunkBuffer.toString('utf8')}`.split('\n');
      this.residual = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (this.provider === 'claude' || this.provider === 'claude-proxy') {
            this.processClaudeEntry(entry);
          } else if (this.provider === 'codex' || this.provider === 'codex-proxy') {
            this.processCodexEntry(entry);
          }
        } catch {
          // Skip malformed JSON line.
        }
      }
    } catch {
      // File may be absent/transient.
    }
  }

  private emitAssistantTurn(content: string, tools: Array<{ name: string; inputSummary: string }>): void {
    const toolsJson = tools.length > 0 ? JSON.stringify(tools) : undefined;
    const turnIndex = this.store.insertConversationTurn(this.sessionId, 'assistant', content, toolsJson);
    const event = this.store.appendEvent(this.sessionId, 'agent.turn', {
      role: 'assistant',
      content,
      tools,
      turnIndex
    });
    this.publishEvent(event);
  }

  private emitUserTurn(content: string): void {
    const turnIndex = this.store.insertConversationTurn(this.sessionId, 'user', content);
    const event = this.store.appendEvent(this.sessionId, 'agent.turn', {
      role: 'user',
      content,
      tools: [],
      turnIndex
    });
    this.publishEvent(event);
  }
}
