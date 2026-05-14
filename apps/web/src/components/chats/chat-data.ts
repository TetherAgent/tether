import { createHttpClient } from '@tether/http';

export type ChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
};

export type ChatHistoryUsage = ChatUsage & {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  contextWindow?: number;
  contextInputTokens?: number;
  contextUsedPercentage?: number;
  rateLimitInfo?: {
    resetsAt?: number;
    rateLimitType?: string;
    status?: string;
    primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
    secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
    planType?: string;
  };
};

export type ChatHistoryMessage = {
  role: string;
  content: string;
  turnId?: string;
  clientRequestId?: string;
  usageJson?: ChatHistoryUsage;
  createdAt: string;
};

export type ChatMessagesResponse = {
  messages: ChatHistoryMessage[];
  snapshotEventSeq: number;
};

export type ChatRuntimeEventResponse = {
  eventId: number;
  eventSeq: number;
  turnId?: string;
  clientRequestId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ProviderOption = {
  provider: string;
  models: string[];
};

export type ChatSessionRecord = {
  id: string;
  gatewayId?: string;
  provider?: string;
  projectPath?: string;
  title?: string;
  agentSessionId?: string;
  status?: string;
  transport?: string;
  lastActiveAt?: number;
};

export async function fetchChatMessages(sessionId: string, token?: string): Promise<ChatMessagesResponse> {
  const http = createHttpClient();
  const data = await http.get<{ messages: ChatHistoryMessage[]; snapshotEventSeq?: number; lastEventId?: number }>(
    `/api/server/chat-sessions/${sessionId}/messages`,
    undefined,
    { token }
  );
  return {
    messages: data.messages ?? [],
    snapshotEventSeq: typeof data.snapshotEventSeq === 'number'
      ? data.snapshotEventSeq
      : typeof data.lastEventId === 'number'
        ? data.lastEventId
        : 0
  };
}

export async function fetchChatEventsAfter(sessionId: string, after: number, token?: string): Promise<ChatRuntimeEventResponse[]> {
  const http = createHttpClient();
  const data = await http.get<{ events: ChatRuntimeEventResponse[] }>(
    `/api/server/chat-sessions/${encodeURIComponent(sessionId)}/events?after=${after}`,
    undefined,
    { token }
  );
  return data.events ?? [];
}

export async function fetchChatSessions(token?: string, suppressGlobalError = true): Promise<ChatSessionRecord[]> {
  const http = createHttpClient();
  const data = await http.get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, {
    token,
    suppressGlobalError
  });
  return data.sessions ?? [];
}
