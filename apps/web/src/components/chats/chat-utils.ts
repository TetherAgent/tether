import type { ChatHistoryMessage, ProviderOption } from './chat-data.js';
import type { ChatNextSuggestion } from './messages/chat-bubble-agent.js';
import type { GatewayInfo, MessageItem, RelaySessionSummary, UsageStats } from './chat-types.js';

export function isProviderOption(value: unknown): value is ProviderOption {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { provider?: unknown }).provider === 'string' &&
    Array.isArray((value as { models?: unknown }).models) &&
    (value as { models: unknown[] }).models.every((model) => typeof model === 'string') &&
    (value as { models: unknown[] }).models.length > 0
  );
}

export function isRelaySessionSummary(value: unknown): value is RelaySessionSummary {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

export function gatewayDisplayName(gateway: GatewayInfo): string {
  const name = gateway.name?.trim();
  if (name) return name;
  const hostname = gateway.hostname?.trim();
  if (hostname) return hostname;
  return gateway.gatewayId.slice(0, 8);
}

export function compactPathLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '~') {
    return '~';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/Users/') && parts.length >= 2) {
    const relativeParts = parts.slice(2);
    if (relativeParts.length === 0) {
      return '~';
    }
    if (relativeParts.length <= 2) {
      return `~/${relativeParts.join('/')}`;
    }
    return `~/.../${relativeParts.slice(-2).join('/')}`;
  }
  if (parts.length <= 3) {
    return normalized;
  }
  return `.../${parts.slice(-2).join('/')}`;
}

export function compactProjectPath(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return '请选择工作目录';
  }
  if (normalized === '~') {
    return '~';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (normalized.startsWith('/Users/') && parts.length >= 2) {
    const relativeParts = parts.slice(2);
    return relativeParts.length > 0 ? `~/${relativeParts.join('/')}` : '~';
  }
  if (parts.length <= 3) {
    return normalized;
  }
  return `.../${parts.slice(-3).join('/')}`;
}

export function findLatestOpenAgentId(items: MessageItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'agent' && (item.isWaiting || item.isStreaming)) {
      return item.id;
    }
  }
  return undefined;
}

export function findLatestLostAgentId(items: MessageItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'agent' && item.isLost) {
      return item.id;
    }
  }
  return undefined;
}

export function findLastAgentIndex(items: MessageItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'agent') {
      return index;
    }
  }
  return -1;
}

export function normalizeNextSuggestions(value: unknown): ChatNextSuggestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const suggestions = value
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const suggestion = item as { description?: unknown; title?: unknown };
      if (typeof suggestion.description !== 'string' || suggestion.description.trim().length === 0) return undefined;
      return {
        description: suggestion.description.trim(),
        ...(typeof suggestion.title === 'string' && suggestion.title.trim().length > 0 ? { title: suggestion.title.trim() } : {})
      };
    })
    .filter((item): item is ChatNextSuggestion => Boolean(item));
  return suggestions.length > 0 ? suggestions.slice(0, 3) : undefined;
}

export function historyMessagesToItems(messages: ChatHistoryMessage[], provider: string): MessageItem[] {
  return messages.map((message, index) =>
    message.role === 'user'
      ? { kind: 'user', id: `history-user-${index}`, content: message.content, ts: Date.parse(message.createdAt) }
      : {
          kind: 'agent',
          id: `history-agent-${index}`,
          text: message.content,
          isStreaming: false,
          isWaiting: false,
          isLost: false,
          provider,
          usage: message.usageJson
        }
  );
}

function chatItemsOnly(items: MessageItem[]): Array<Extract<MessageItem, { kind: 'user' | 'agent' }>> {
  return items.filter((item): item is Extract<MessageItem, { kind: 'user' | 'agent' }> => item.kind === 'user' || item.kind === 'agent');
}

export function historySnapshotLooksOlder(currentItems: MessageItem[], snapshotItems: MessageItem[]): boolean {
  const currentChatItems = chatItemsOnly(currentItems);
  const snapshotChatItems = chatItemsOnly(snapshotItems);
  if (snapshotChatItems.length < currentChatItems.length) {
    return true;
  }
  const currentLastAgent = [...currentChatItems].reverse().find((item) => item.kind === 'agent');
  const snapshotLastAgent = [...snapshotChatItems].reverse().find((item) => item.kind === 'agent');
  if (!currentLastAgent || !snapshotLastAgent) {
    return false;
  }
  return currentLastAgent.text.length > snapshotLastAgent.text.length &&
    currentLastAgent.text.startsWith(snapshotLastAgent.text);
}

export function usageStatsFromHistory(messages: ChatHistoryMessage[]): UsageStats | undefined {
  const lastAssistant = messages.filter((message) => message.role === 'assistant').at(-1);
  if (lastAssistant?.usageJson?.contextWindow == null) {
    return undefined;
  }
  const usage = lastAssistant.usageJson;
  const contextWindow = usage.contextWindow!;
  const totalTokens = usage.contextInputTokens !== undefined
    ? usage.contextInputTokens
    : (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const contextPct = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
  const rateLimit = usage.rateLimitInfo;
  const rateLimitStillValid = rateLimit?.resetsAt !== undefined && rateLimit.resetsAt * 1000 > Date.now();
  return {
    contextPct,
    rateLimitResetsAt: rateLimitStillValid ? rateLimit?.resetsAt : undefined,
    rateLimitType: rateLimitStillValid ? rateLimit?.rateLimitType : undefined,
    primary: rateLimitStillValid ? rateLimit?.primary : undefined,
    secondary: rateLimitStillValid ? rateLimit?.secondary : undefined
  };
}
