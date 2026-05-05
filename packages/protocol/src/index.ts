export type RelaySessionStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'lost';

export type RelayClientMode = 'control' | 'observe';

export type RelayAuthTokenClass =
  | 'normal_client_access'
  | 'normal_client_refresh'
  | 'management_access'
  | 'management_refresh'
  | 'gateway_access'
  | 'gateway_refresh'
  | 'ws_ticket';

export type RelayAuthScope = {
  accountId: string;
  workspaceId: string;
  gatewayId?: string;
  sessionId?: string;
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  mode?: RelayClientMode;
  tokenClass: RelayAuthTokenClass;
  expiresAt: number;
  jti: string;
};

export type RelaySession = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  accountId?: string;
  workspaceId?: string;
  gatewayId?: string;
  userId?: string;
  agentSessionId?: string;
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
  | { type: 'gateway.auth'; gatewayId: string; token?: string; secret?: string; scope?: RelayAuthScope }
  | { type: 'gateway.sessions'; gatewayId: string; sessions: RelaySession[] }
  | { type: 'gateway.replay'; gatewayId: string; clientId: string; sessionId: string; events: RelayTerminalEvent[]; done?: boolean; latestEventId?: number }
  | { type: 'gateway.event'; gatewayId: string; event: RelayTerminalEvent }
  | { type: 'gateway.error'; gatewayId: string; clientId?: string; sessionId?: string; code: string; message: string };

export type RelayServerToGatewayFrame =
  | { type: 'gateway.auth.ok'; gatewayId: string }
  | { type: 'gateway.auth.failed'; code: string; message: string }
  | { type: 'client.list'; clientId: string }
  | { type: 'client.subscribe'; clientId: string; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; clientId: string; sessionId: string; data: string }
  | { type: 'client.resize'; clientId: string; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; clientId: string; sessionId: string }
  | { type: 'client.detach'; clientId: string; sessionId: string }
  | { type: 'client.chat'; clientId: string; sessionId: string; message: string };

export type RelayClientToServerFrame =
  // `secret` is retained only for the personal-relay bootstrap fallback path.
  | { type: 'client.auth'; token?: string; ticket?: string; scope?: RelayAuthScope; secret?: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; sessionId: string }
  | { type: 'client.detach'; sessionId: string }
  | { type: 'client.chat'; sessionId: string; message: string };

export type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'sessions'; sessions: RelaySession[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: RelayTerminalEvent }
  | { type: 'replay.output'; sessionId: string; data: string; latestEventId: number }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };
