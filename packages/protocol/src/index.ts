export type TrustedChatSessionMetadata = {
  id: string;
  provider: string;
  title?: string;
  projectPath: string;
  agentSessionId?: string;
  accountId: string;
  userId: string;
  gatewayId: string;
  transport: 'chat';
};

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
  gatewayId?: string;
  userId?: string;
  agentSessionId?: string;
  status: RelaySessionStatus;
  transport: 'pty-event-stream' | 'tmux' | 'chat';
  lastActiveAt: number;
};

export type RelayTerminalEvent = {
  id: number;
  sessionId: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
};

export type RelayNextSuggestion = {
  description: string;
  title?: string;
  toolName?: string;
  reason?: string;
};

export type RelayGatewayToServerFrame =
  | { type: 'gateway.auth'; gatewayId: string; token?: string; secret?: string; scope?: RelayAuthScope; version?: string }
  | { type: 'gateway.sessions'; gatewayId: string; sessions: RelaySession[] }
  | { type: 'gateway.replay'; gatewayId: string; clientId: string; sessionId: string; events: RelayTerminalEvent[]; done?: boolean; latestEventId?: number }
  | { type: 'gateway.event'; gatewayId: string; event: RelayTerminalEvent }
  | { type: 'gateway.session-created'; gatewayId: string; clientId: string; sessionId: string }
  | { type: 'gateway.chat-catchup'; gatewayId: string; clientId: string; sessionId: string; text: string }
  | { type: 'gateway.chat-session-created'; gatewayId: string; clientId: string; session: TrustedChatSessionMetadata }
  | { type: 'gateway.error'; gatewayId: string; clientId?: string; sessionId?: string; code: string; message: string };

export type RelayServerToGatewayFrame =
  | { type: 'gateway.auth.ok'; gatewayId: string }
  | { type: 'gateway.auth.failed'; code: string; message: string }
  | { type: 'client.list'; clientId: string }
  | { type: 'client.subscribe'; clientId: string; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; clientId: string; sessionId: string; data: string }
  | { type: 'client.resize'; clientId: string; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; clientId: string; sessionId: string }
  | { type: 'client.unsubscribe'; clientId: string; sessionId: string }
  | { type: 'client.detach'; clientId: string; sessionId: string }
  | { type: 'client.permission_response'; clientId: string; sessionId: string; requestId: string; decision: 'allow' | 'deny' }
  | {
      type: 'client.chat';
      clientId: string;
      sessionId: null;
      provider: string;
      model: string;
      cwd: string;
      message: string;
      accountId?: string;
      userId?: string;
    }
  | { type: 'client.chat'; clientId: string; sessionId: string; message: string; model?: string; session: TrustedChatSessionMetadata }
  | { type: 'client.cwd-suggest'; clientId: string; cwd: string }
  | { type: 'client.list-providers'; clientId: string }
  | { type: 'client.switch-model'; clientId: string; sessionId: string; provider: string; model: string }
  | { type: 'gateway.sessions-restore'; gatewayId: string; sessions: RelaySession[] }
  | { type: 'client.new-pty-session'; clientId: string; provider: string; command: string; cwd: string; cols: number; rows: number };

export type RelayClientToServerFrame =
  // `secret` is retained only for the personal-relay bootstrap fallback path.
  | { type: 'client.auth'; token?: string; ticket?: string; scope?: RelayAuthScope; secret?: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: RelayClientMode; cols?: number; rows?: number }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; sessionId: string }
  | { type: 'client.unsubscribe'; sessionId: string }
  | { type: 'client.detach'; sessionId: string }
  | { type: 'client.chat'; sessionId: null; provider: string; model: string; cwd: string; message: string; gatewayId: string }
  | { type: 'client.chat'; sessionId: string; message: string; model?: string }
  | { type: 'client.cwd-suggest'; cwd: string; gatewayId: string }
  | { type: 'client.list-providers'; gatewayId: string }
  | { type: 'client.switch-model'; sessionId: string; provider: string; model: string }
  | { type: 'client.permission_response'; sessionId: string; requestId: string; decision: 'allow' | 'deny' }
  | { type: 'client.new-pty-session'; provider: string; command: string; cwd: string; cols: number; rows: number; gatewayId: string };

export type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'sessions'; sessions: RelaySession[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'gateway.status'; gatewayId: string; status: 'connected' | 'disconnected'; version?: string }
  | { type: 'event'; event: RelayTerminalEvent }
  | { type: 'replay.output'; sessionId: string; data: string; latestEventId: number }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'gateway.session-created'; sessionId: string }
  | { type: 'user.message'; sessionId: string; text: string; eventId?: number }
  | { type: 'agent.delta'; sessionId: string; text: string; eventId?: number }
  | { type: 'agent.result'; sessionId: string; text: string; usage: { input_tokens: number; output_tokens: number; cost_usd?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }; stop_reason?: string; contextWindow?: number; rateLimitInfo?: { resetsAt: number; rateLimitType: string; status: string }; nextSuggestions?: RelayNextSuggestion[] }
  | { type: 'agent.tool'; sessionId: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
  | { type: 'agent.permission_request'; sessionId: string; requestId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'gateway.chat-catchup'; sessionId: string; text: string; lastEventId?: number }
  | { type: 'gateway.providers'; gatewayId?: string; providers: Array<{ provider: string; models: string[] }> }
  | { type: 'gateway.cwd-suggestions'; gatewayId?: string; cwd: string; suggestions: string[] }
  | { type: 'error'; sessionId?: string; code: string; message: string };
