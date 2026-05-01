export type RelaySessionStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'lost';

export type RelayClientMode = 'control' | 'observe';

export type RelaySession = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  status: RelaySessionStatus;
  transport: 'pty-event-stream' | 'tmux';
  lastActiveAt: number;
};

export type RelayTerminalEvent = {
  id: number;
  sessionId: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
};
