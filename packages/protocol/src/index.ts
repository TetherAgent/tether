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

export type RelayGatewayToServerFrame =
  | { type: 'gateway.auth'; gatewayId: string; secret: string }
  | { type: 'gateway.sessions'; gatewayId: string; sessions: RelaySession[] }
  | { type: 'gateway.replay'; gatewayId: string; clientId: string; sessionId: string; events: RelayTerminalEvent[] }
  | { type: 'gateway.event'; gatewayId: string; event: RelayTerminalEvent }
  | { type: 'gateway.error'; gatewayId: string; clientId?: string; sessionId?: string; code: string; message: string };

export type RelayServerToGatewayFrame =
  | { type: 'gateway.auth.ok'; gatewayId: string }
  | { type: 'gateway.auth.failed'; code: string; message: string }
  | { type: 'client.list'; clientId: string }
  | { type: 'client.subscribe'; clientId: string; sessionId: string; after?: number; mode: RelayClientMode }
  | { type: 'client.input'; clientId: string; sessionId: string; data: string }
  | { type: 'client.resize'; clientId: string; sessionId: string; cols: number; rows: number }
  | { type: 'client.detach'; clientId: string; sessionId: string };

export type RelayClientToServerFrame =
  | { type: 'client.auth'; secret: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; mode: RelayClientMode }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.detach'; sessionId: string };

export type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'sessions'; sessions: RelaySession[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: RelayTerminalEvent }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };
