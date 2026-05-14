import type { ChatHistoryUsage, ChatUsage } from './chat-data.js';
import type { ChatNextSuggestion } from './messages/chat-bubble-agent.js';

export type Usage = ChatUsage;
export type HistoryUsage = ChatHistoryUsage;

export type MessageItem =
  | { kind: 'user'; id: string; content: string; ts: number }
  | { kind: 'agent'; id: string; text: string; isStreaming: boolean; isWaiting: boolean; isLost: boolean; provider: string; usage?: Usage; durationMs?: number; nextSuggestions?: ChatNextSuggestion[] }
  | { kind: 'tool'; id: string; toolName: string; input: Record<string, unknown>; result?: string; isError: boolean; isInFlight: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'permission'; id: string; requestId: string; toolName: string; decided?: 'allow' | 'deny' };

export type UsageStats = {
  contextPct?: number;
  rateLimitResetsAt?: number;
  rateLimitType?: string;
  primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
};

export type RelaySessionSummary = {
  id: string;
  gatewayId?: string;
  provider?: string;
  projectPath?: string;
  agentSessionId?: string;
  transport?: string;
};

export type GatewayInfo = {
  gatewayId: string;
  name?: string;
  hostname?: string;
  status?: string;
};
