import type { SessionEventType } from '../types.js';

export type AgentRuntimeStatus =
  | 'idle'
  | 'submitted'
  | 'running'
  | 'responding'
  | 'done'
  | 'exited'
  | 'disconnected';

export type AgentStatusSource = 'pty' | 'runner';

export class AgentStatusPublisher {
  private current?: AgentRuntimeStatus;

  constructor(
    private readonly sessionId: string,
    private readonly appendEvent: (type: SessionEventType, payload: Record<string, unknown>) => void
  ) {}

  emit(status: AgentRuntimeStatus, reason: string, source: AgentStatusSource): void {
    if (status === this.current) {
      return;
    }
    const previousStatus = this.current;
    this.current = status;
    this.appendEvent('agent.status', {
      status,
      previousStatus,
      reason,
      source
    });
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

  onExited(): void {
    this.emit('exited', 'session_exited', 'runner');
  }
}
