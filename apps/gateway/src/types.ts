export type SessionStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'lost';
export type AttachState = 'attached' | 'detached';
export type SessionTransport = 'tmux' | 'pty-event-stream' | 'chat';

export type Session = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  accountId?: string;
  userId?: string;
  deviceId?: string;
  gatewayId?: string;
  status: SessionStatus;
  attachState: AttachState;
  tmuxSessionName: string;
  command: string;
  pid?: number;
  runnerPid?: number;
  runnerSocketPath?: string;
  runnerStartedAt?: number;
  runnerLastHeartbeatAt?: number;
  transport: SessionTransport;
  agentSessionId?: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
};

export type SessionEventType =
  | 'session.started'
  | 'session.exited'
  | 'session.error'
  | 'terminal.output'
  | 'terminal.theme.detected'
  | 'user.input'
  | 'client.attached'
  | 'client.detached'
  | 'terminal.resize'
  | 'runner.started'
  | 'runner.heartbeat'
  | 'runner.exited'
  | 'client.control_changed'
  | 'approval.requested'
  | 'diff.detected'
  | 'agent.handoff'
  | 'agent.status'
  | 'agent.select';

export type SessionEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: number;
  sessionId: string;
  type: SessionEventType;
  ts: number;
  payload: TPayload;
};

export type ChatEventType = 'user.message' | 'agent.result' | 'agent.tool' | 'session.error';

export type ChatEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: number;
  sessionId: string;
  type: ChatEventType;
  ts: number;
  payload: TPayload;
};
