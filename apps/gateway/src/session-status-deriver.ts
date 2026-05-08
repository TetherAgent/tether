import type { SessionEvent, Store } from './store.js';

export type AgentRuntimeStatus =
  | 'idle'
  | 'submitted'
  | 'running'
  | 'responding'
  | 'done'
  | 'exited'
  | 'disconnected';

export type AgentStatusSource = 'pty' | 'journal' | 'runner';

export class AgentStatusPublisher {
  private current?: AgentRuntimeStatus;

  constructor(
    private readonly sessionId: string,
    private readonly store: Store,
    private readonly publishEvent: (event: SessionEvent) => void
  ) {}

  emit(status: AgentRuntimeStatus, reason: string, source: AgentStatusSource): void {
    if (status === this.current) {
      return;
    }
    const previousStatus = this.current;
    this.current = status;
    const event = this.store.appendEvent(this.sessionId, 'agent.status', {
      status,
      previousStatus,
      reason,
      source
    });
    this.publishEvent(event);
  }

  onUserInput(data: string): void {
    if (data === '\r') {
      this.emit('submitted', 'enter_received', 'pty');
    }
  }

  onTerminalOutput(data: string): void {
    if (!data) {
      return;
    }
    if (this.current === 'submitted') {
      this.emit('running', 'terminal_output', 'pty');
    }
  }

  onAgentTurn(role: 'user' | 'assistant'): void {
    if (role === 'user') {
      this.emit('submitted', 'journal_user_turn', 'journal');
      return;
    }
    this.emit('done', 'journal_assistant_turn', 'journal');
  }

  onTaskStarted(): void {
    this.emit('responding', 'journal_task_started', 'journal');
  }

  onTaskCompleted(): void {
    this.emit('done', 'journal_task_completed', 'journal');
  }

  onExited(): void {
    this.emit('exited', 'session_exited', 'runner');
  }
}
