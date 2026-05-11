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
  rateLimitInfo?: {
    resetsAt?: number;
    rateLimitType?: string;
    primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
    secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  };
};

export type ChatHistoryMessage = {
  role: string;
  content: string;
  usageJson?: ChatHistoryUsage;
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

export async function fetchChatMessages(sessionId: string, token?: string): Promise<ChatHistoryMessage[]> {
  const http = createHttpClient();
  const data = await http.get<{ messages: ChatHistoryMessage[] }>(
    `/api/server/chat-sessions/${sessionId}/messages`,
    undefined,
    { token }
  );
  return data.messages ?? [];
}

export async function fetchChatSessions(token?: string, suppressGlobalError = true): Promise<ChatSessionRecord[]> {
  const http = createHttpClient();
  const data = await http.get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, {
    token,
    suppressGlobalError
  });
  return data.sessions ?? [];
}
