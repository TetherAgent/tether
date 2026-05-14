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
  usageJson?: ChatHistoryUsage;
  createdAt: string;
};

export type ChatMessagesResponse = {
  messages: ChatHistoryMessage[];
  lastEventId: number;
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
  const data = await http.get<{ messages: ChatHistoryMessage[]; lastEventId?: number }>(
    `/api/server/chat-sessions/${sessionId}/messages`,
    undefined,
    { token }
  );
  return {
    messages: data.messages ?? [],
    lastEventId: typeof data.lastEventId === 'number' ? data.lastEventId : 0
  };
}

export async function fetchChatSessions(token?: string, suppressGlobalError = true): Promise<ChatSessionRecord[]> {
  const http = createHttpClient();
  const data = await http.get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, {
    token,
    suppressGlobalError
  });
  return data.sessions ?? [];
}
