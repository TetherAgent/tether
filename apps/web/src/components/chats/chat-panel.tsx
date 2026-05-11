import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Check, Copy, Folder, Loader2, Menu, PanelLeftOpen, Settings } from 'lucide-react';
import { NotificationBell } from './notification-bell.js';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@tether/design';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { rememberGatewayVersion } from '../../hooks/use-update-check.js';
import { gatewayAuthHeaders, getStoredNormalAccessToken, readGatewayData } from '../../lib/api.js';
import { providerResumeCommand } from '../../lib/provider-resume-command.js';
import { fetchChatMessages, fetchChatSessions, type ChatHistoryMessage, type ChatHistoryUsage, type ChatSessionRecord, type ChatUsage, type ProviderOption } from './chat-data.js';
import { ChatBubbleAgent, type ChatNextSuggestion } from './chat-bubble-agent.js';
import { ChatBubbleUser } from './chat-bubble-user.js';
import { SystemMessage } from './system-message.js';
import { ToolCard } from './tool-card.js';
import { PermissionPrompt } from './permission-prompt.js';
import { type RelayFrame, useChatRelaySocket } from './use-chat-relay-socket.js';
import { GatewaySelector } from './gateway-selector.js';

type Usage = ChatUsage;
type HistoryUsage = ChatHistoryUsage;
type MessageItem =
  | { kind: 'user'; id: string; content: string; ts: number }
  | { kind: 'agent'; id: string; text: string; isStreaming: boolean; isWaiting: boolean; isLost: boolean; provider: string; usage?: Usage; durationMs?: number; nextSuggestions?: ChatNextSuggestion[] }
  | { kind: 'tool'; id: string; toolName: string; input: Record<string, unknown>; result?: string; isError: boolean; isInFlight: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'permission'; id: string; requestId: string; toolName: string; decided?: 'allow' | 'deny' };
type UsageStats = {
  contextPct?: number;
  rateLimitResetsAt?: number;
  rateLimitType?: string;
  primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
};
type RelaySessionSummary = {
  id: string;
  gatewayId?: string;
  provider?: string;
  projectPath?: string;
  transport?: string;
};
type GatewayInfo = {
  gatewayId: string;
  name?: string;
  hostname?: string;
  status?: string;
};

const RELAY_URL_KEY = 'tether:relayUrl';
const DEFAULT_RELAY_URL = import.meta.env.VITE_TETHER_RELAY_URL ?? 'wss://tether.earntools.me';
const DEFAULT_PROVIDER_OPTIONS: ProviderOption[] = [
  { provider: 'claude', models: ['sonnet', 'opus', 'haiku'] }
];

function isProviderOption(value: unknown): value is ProviderOption {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { provider?: unknown }).provider === 'string' &&
    Array.isArray((value as { models?: unknown }).models) &&
    (value as { models: unknown[] }).models.every((model) => typeof model === 'string') &&
    (value as { models: unknown[] }).models.length > 0
  );
}

function isRelaySessionSummary(value: unknown): value is RelaySessionSummary {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function gatewayDisplayName(gateway: GatewayInfo): string {
  const name = gateway.name?.trim();
  if (name) return name;
  const hostname = gateway.hostname?.trim();
  if (hostname) return hostname;
  return gateway.gatewayId.slice(0, 8);
}

function compactPathLabel(value: string): string {
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

function compactProjectPath(value: string): string {
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

function findLatestOpenAgentId(items: MessageItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'agent' && (item.isWaiting || item.isStreaming)) {
      return item.id;
    }
  }
  return undefined;
}

function findLatestLostAgentId(items: MessageItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'agent' && item.isLost) {
      return item.id;
    }
  }
  return undefined;
}

function findLastAgentIndex(items: MessageItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'agent') {
      return index;
    }
  }
  return -1;
}

function normalizeNextSuggestions(value: unknown): ChatNextSuggestion[] | undefined {
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

function historyMessagesToItems(messages: ChatHistoryMessage[], provider: string): MessageItem[] {
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

function historySnapshotLooksOlder(currentItems: MessageItem[], snapshotItems: MessageItem[]): boolean {
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

function usageStatsFromHistory(messages: ChatHistoryMessage[]): UsageStats | undefined {
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

function formatResetCountdown(resetsAt: number): string {
  const diffMs = resetsAt * 1000 - Date.now();
  if (diffMs <= 0) return '刷新中';
  const totalMin = Math.floor(diffMs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function UsageStatsChip({ contextPct, rateLimitResetsAt, rateLimitType }: { contextPct?: number; rateLimitResetsAt?: number; rateLimitType?: string }) {
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!rateLimitResetsAt) return;
    const id = window.setInterval(() => forceUpdate(), 60000);
    return () => window.clearInterval(id);
  }, [rateLimitResetsAt]);

  const parts: string[] = [];
  if (contextPct !== undefined) parts.push(`ctx ${contextPct}%`);
  if (rateLimitResetsAt) {
    const label = rateLimitType === 'five_hour' ? '5h' : rateLimitType ?? 'limit';
    parts.push(`${label} resets ${formatResetCountdown(rateLimitResetsAt)}`);
  }
  if (parts.length === 0) return null;

  return (
    <span className="flex h-7 items-center rounded-full bg-muted px-3 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
      {parts.join(' · ')}
    </span>
  );
}

function UsageStatsRows({ contextPct, rateLimitResetsAt, rateLimitType, primary, secondary }: {
  contextPct?: number;
  rateLimitResetsAt?: number;
  rateLimitType?: string;
  primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
  secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
}) {
  const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const hasTimer = rateLimitResetsAt || primary?.resetsAt || secondary?.resetsAt;
    if (!hasTimer) return;
    const id = window.setInterval(() => forceUpdate(), 60000);
    return () => window.clearInterval(id);
  }, [rateLimitResetsAt, primary?.resetsAt, secondary?.resetsAt]);

  // Resolve usage row
  let usagePct: number | undefined;
  let usageResetsAt: number | undefined;
  let weeklyPct: number | undefined;
  let weeklyResetsAt: number | undefined;

  if (primary) {
    usagePct = primary.usedPercent;
    usageResetsAt = primary.resetsAt;
    if (secondary) {
      weeklyPct = secondary.usedPercent;
      weeklyResetsAt = secondary.resetsAt;
    }
  } else if (rateLimitResetsAt) {
    const windowMs = rateLimitType === 'five_hour' ? 5 * 60 * 60 * 1000 : undefined;
    if (windowMs) {
      const remainingMs = Math.max(0, rateLimitResetsAt * 1000 - Date.now());
      usagePct = Math.min(100, Math.round(((windowMs - remainingMs) / windowMs) * 100));
    }
    usageResetsAt = rateLimitResetsAt;
  }

  if (contextPct === undefined && usageResetsAt === undefined) return null;

  return (
    <div className="flex flex-col gap-2 pt-0.5">
      {contextPct !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Context</span>
            <span className="font-mono text-[11px] tabular-nums">{contextPct}%</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${Math.min(100, contextPct)}%` }} />
          </div>
        </div>
      )}
      {usageResetsAt !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Usage</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">resets {formatResetCountdown(usageResetsAt)}</span>
          </div>
          {usagePct !== undefined && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${usagePct}%` }} />
            </div>
          )}
        </div>
      )}
      {weeklyResetsAt !== undefined && weeklyPct !== undefined && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Weekly</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">resets {formatResetCountdown(weeklyResetsAt)}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${weeklyPct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  activeSessionId,
  onExpandSidebar,
  onOpenDrawer,
  onReconnectCatchup
}: {
  activeSessionId?: string;
  onExpandSidebar?: () => void;
  onOpenDrawer?: () => void;
  onReconnectCatchup?: () => void;
}) {
  const navigate = useNavigate();
  const { normalAuth } = useAuth();
  const { t } = useI18n();
  const [messages, setMessages] = React.useState<MessageItem[]>([]);
  const [inputText, setInputText] = React.useState('');
  const [isInflight, setIsInflight] = React.useState(false);
  const [currentSessionId, setCurrentSessionId] = React.useState<string | undefined>(activeSessionId);
  const [providerOptions, setProviderOptions] = React.useState<ProviderOption[]>(DEFAULT_PROVIDER_OPTIONS);
  const [selectedProvider, setSelectedProvider] = React.useState(DEFAULT_PROVIDER_OPTIONS[0]!.provider);
  const [selectedModel, setSelectedModel] = React.useState(DEFAULT_PROVIDER_OPTIONS[0]!.models[0]!);
  const [activeSessionProvider, setActiveSessionProvider] = React.useState<string | undefined>(undefined);
  const [activeSessionModel, setActiveSessionModel] = React.useState<string | undefined>(undefined);
  const [activeSessionProjectPath, setActiveSessionProjectPath] = React.useState<string | undefined>(undefined);
  const [activeSessionGatewayId, setActiveSessionGatewayId] = React.useState<string | undefined>(undefined);
  const [activeSessionMetadataReady, setActiveSessionMetadataReady] = React.useState(!activeSessionId);
  const [relayGatewayId, setRelayGatewayId] = React.useState<string | undefined>(undefined);
  const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
  const [selectedGatewayName, setSelectedGatewayName] = React.useState<string | undefined>(undefined);
  const [gatewayNamesById, setGatewayNamesById] = React.useState<Record<string, string>>({});
  const [onlineGatewayIds, setOnlineGatewayIds] = React.useState<Set<string>>(new Set());
  const [relaySessions, setRelaySessions] = React.useState<RelaySessionSummary[]>([]);
  const [subscribeRetryKey, setSubscribeRetryKey] = React.useState(0);
  const [cwd, setCwd] = React.useState('~');
  const [cwdSuggestions, setCwdSuggestions] = React.useState<string[]>([]);
  const [cwdPickerOpen, setCwdPickerOpen] = React.useState(false);
  const [cwdActiveIndex, setCwdActiveIndex] = React.useState(0);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(undefined);
  const [connectionError, setConnectionError] = React.useState<string | undefined>(undefined);
  const [sessionAccessError, setSessionAccessError] = React.useState<string | undefined>(undefined);
  const hasEverConnectedRef = React.useRef(false);
  const [gatewayReady, setGatewayReady] = React.useState(false);
  const [hasGatewayStatusFrame, setHasGatewayStatusFrame] = React.useState(false);
  const [usageStats, setUsageStats] = React.useState<UsageStats | undefined>(undefined);
  const [copiedAgentId, setCopiedAgentId] = React.useState(false);
  const [sessionSettingsOpen, setSessionSettingsOpen] = React.useState(false);
  const messageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const messageEndRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const currentAgentIdRef = React.useRef<string | null>(null);
  const inflightStartedAtRef = React.useRef<number>(0);
  const revealTimerRef = React.useRef<number | undefined>(undefined);
  const messagesRef = React.useRef<MessageItem[]>([]);
  const activeSessionProviderRef = React.useRef(activeSessionProvider);
  const selectedProviderRef = React.useRef(selectedProvider);
  const currentSessionIdRef = React.useRef(currentSessionId);
  const selectedGatewayIdRef = React.useRef(selectedGatewayId);
  const activeSessionGatewayIdRef = React.useRef(activeSessionGatewayId);
  const onlineGatewayIdsRef = React.useRef(onlineGatewayIds);
  const subscribedSessionIdRef = React.useRef<string | null>(null);
  const cwdRef = React.useRef(cwd);
  const skipNextHistoryLoadSessionIdRef = React.useRef<string | null>(null);
  const pendingCreatedSessionIdRef = React.useRef<string | null>(null);
  const pendingSessionProviderRef = React.useRef<string | undefined>(undefined);
  const pendingSessionModelRef = React.useRef<string | undefined>(undefined);
  const createdSessionIdRef = React.useRef<string | null>(null);
  const lastCatchupConnectionEpochRef = React.useRef(0);
  const previousSelectedGatewayIdRef = React.useRef<string | undefined>(undefined);
  const providerRequestKeyRef = React.useRef<string | undefined>(undefined);
  const isComposingRef = React.useRef(false);

  React.useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    activeSessionProviderRef.current = activeSessionProvider;
  }, [activeSessionProvider]);

  React.useEffect(() => {
    selectedProviderRef.current = selectedProvider;
  }, [selectedProvider]);

  React.useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  React.useEffect(() => {
    selectedGatewayIdRef.current = selectedGatewayId;
  }, [selectedGatewayId]);

  React.useEffect(() => {
    activeSessionGatewayIdRef.current = activeSessionGatewayId;
  }, [activeSessionGatewayId]);

  React.useEffect(() => {
    onlineGatewayIdsRef.current = onlineGatewayIds;
  }, [onlineGatewayIds]);

  const scrollMessagesToBottom = React.useCallback((behavior: ScrollBehavior = 'smooth') => {
    window.requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: 'end', behavior });
    });
  }, []);

  React.useEffect(() => {
    if (currentSessionId) {
      scrollMessagesToBottom('auto');
    }
  }, [currentSessionId, scrollMessagesToBottom]);

  React.useEffect(() => {
    if (messages.length > 0) {
      scrollMessagesToBottom(messages.some((message) => message.kind === 'agent' && message.isStreaming) ? 'auto' : 'smooth');
    }
  }, [messages, scrollMessagesToBottom]);

  React.useEffect(() => {
    if (connectionError || sessionAccessError) {
      scrollMessagesToBottom('smooth');
    }
  }, [connectionError, scrollMessagesToBottom, sessionAccessError]);

  React.useEffect(() => {
    return () => {
      if (revealTimerRef.current !== undefined) {
        window.clearInterval(revealTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (revealTimerRef.current !== undefined) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = undefined;
    }
    setSessionAccessError(undefined);
    currentSessionIdRef.current = activeSessionId;
    setCurrentSessionId(activeSessionId);
    setAgentSessionId(undefined);
    setActiveSessionProjectPath(undefined);
    setActiveSessionGatewayId(undefined);
    setActiveSessionMetadataReady(!activeSessionId);
    if (activeSessionId && activeSessionId === createdSessionIdRef.current) {
      setActiveSessionProvider(pendingSessionProviderRef.current);
      setActiveSessionModel(pendingSessionModelRef.current);
      setActiveSessionGatewayId(selectedGatewayId);
      setActiveSessionMetadataReady(true);
      createdSessionIdRef.current = null;
    } else {
      setActiveSessionProvider(undefined);
      setActiveSessionModel(undefined);
    }
  }, [activeSessionId]);

  const loadActiveSessionHistory = React.useCallback(async (sessionId: string, opts?: { protectNewerLocal?: boolean }) => {
    const token = normalAuth?.accessToken ?? getStoredNormalAccessToken();
    const historyMessages = await fetchChatMessages(sessionId, token);
    const items = historyMessagesToItems(historyMessages, activeSessionProviderRef.current ?? 'agent');
    let nextAgentId: string | null = null;
    let nextIsInflight = false;
    if (items.at(-1)?.kind === 'user') {
      items.push({
        kind: 'agent',
        id: 'history-waiting',
        text: '',
        isStreaming: false,
        isWaiting: true,
        isLost: false,
        provider: activeSessionProviderRef.current ?? 'agent'
      });
      nextAgentId = 'history-waiting';
      nextIsInflight = true;
    }
    if (opts?.protectNewerLocal && historySnapshotLooksOlder(messagesRef.current, items)) {
      return;
    }
    currentAgentIdRef.current = nextAgentId;
    setIsInflight(nextIsInflight);
    setUsageStats(usageStatsFromHistory(historyMessages));
    setMessages(items);
  }, [normalAuth?.accessToken]);

  const loadActiveSessionMetadata = React.useCallback(async (sessionId: string) => {
    const token = normalAuth?.accessToken ?? getStoredNormalAccessToken();
    if (!token) {
      return;
    }
    const sessions = await fetchChatSessions(token);
    const session = sessions.find((item) => item.id === sessionId);
    setAgentSessionId(session?.agentSessionId);
    setActiveSessionProvider(session?.provider);
    setActiveSessionProjectPath(session?.projectPath);
    setActiveSessionGatewayId(session?.gatewayId);
    setActiveSessionModel(undefined);
    setActiveSessionMetadataReady(true);
  }, [normalAuth?.accessToken]);

  React.useEffect(() => {
    if (!currentSessionId) {
      return;
    }
    const session = relaySessions.find((item) => item.id === currentSessionId);
    if (!session) {
      return;
    }
    if (session.gatewayId) {
      setActiveSessionGatewayId(session.gatewayId);
      setSelectedGatewayId(session.gatewayId);
    }
    if (session.provider) {
      setActiveSessionProvider(session.provider);
    }
    if (session.projectPath) {
      setActiveSessionProjectPath(session.projectPath);
    }
    setActiveSessionMetadataReady(true);
  }, [currentSessionId, relaySessions]);

  React.useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setIsInflight(false);
      setAgentSessionId(undefined);
      setActiveSessionProjectPath(undefined);
      setActiveSessionGatewayId(undefined);
      setActiveSessionMetadataReady(true);
      return;
    }
    if (
      skipNextHistoryLoadSessionIdRef.current === activeSessionId ||
      pendingCreatedSessionIdRef.current === activeSessionId
    ) {
      skipNextHistoryLoadSessionIdRef.current = null;
      return;
    }
    void loadActiveSessionHistory(activeSessionId).catch(() => {
      setMessages([{ kind: 'system', id: 'history-error', text: t.chatsHistoryFail }]);
    });
  }, [activeSessionId, loadActiveSessionHistory, t.chatsHistoryFail]);

  React.useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    void loadActiveSessionMetadata(activeSessionId).catch(() => setActiveSessionMetadataReady(true));
  }, [activeSessionId, loadActiveSessionMetadata]);

  React.useEffect(() => {
    let cancelled = false;
    void fetch('/api/server/gateways', { headers: gatewayAuthHeaders(normalAuth?.accessToken) })
      .then((response) => response.ok ? readGatewayData<GatewayInfo[]>(response) : [])
      .then((items) => {
        if (cancelled || !Array.isArray(items)) return;
        setGatewayNamesById(Object.fromEntries(
          items
            .filter((gateway) => gateway.status !== 'revoked')
            .map((gateway) => [gateway.gatewayId, gatewayDisplayName(gateway)])
        ));
      })
      .catch(() => {
        if (!cancelled) {
          setGatewayNamesById({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [normalAuth?.accessToken]);

  const relayUrl = React.useMemo(
    () => window.localStorage.getItem(RELAY_URL_KEY) ?? DEFAULT_RELAY_URL,
    []
  );

  const handleRelayClose = React.useCallback(() => {
    setGatewayReady(false);
    setHasGatewayStatusFrame(false);
    setRelayGatewayId(undefined);
    setSelectedGatewayId(undefined);
    setOnlineGatewayIds(new Set());
    setConnectionError(t.gatewayNotConnected);
    setIsInflight(false);
    currentAgentIdRef.current = null;
  }, [t.gatewayNotConnected]);

  const markGatewayReadyFallback = React.useCallback((gatewayId?: string) => {
    if (hasGatewayStatusFrame) {
      return;
    }
    if (gatewayId) {
      setRelayGatewayId(gatewayId);
    }
    setGatewayReady(true);
    setConnectionError((current) => current === t.gatewayNotConnected ? undefined : current);
  }, [hasGatewayStatusFrame, t.gatewayNotConnected]);

  const handleRelayFrame = React.useCallback((frame: RelayFrame, relay: { sendFrame: (frame: Record<string, unknown>) => boolean }) => {
      if (frame.type === 'client.auth.ok') {
        hasEverConnectedRef.current = true;
        setConnectionError(undefined);
        return;
      }
      if (frame.type === 'hello') {
        const gatewayId = typeof frame.gatewayId === 'string' ? frame.gatewayId : undefined;
        setRelayGatewayId(gatewayId);
        if (gatewayId) {
          setSelectedGatewayId((current) => current ?? gatewayId);
          markGatewayReadyFallback(gatewayId);
        }
        return;
      }
      if (frame.type === 'gateway.status' && typeof frame.gatewayId === 'string') {
        const gatewayId = frame.gatewayId;
        setHasGatewayStatusFrame(true);
        if (typeof frame.version === 'string' && frame.version) {
          rememberGatewayVersion(frame.version);
        }
        if (frame.status === 'connected') {
          setOnlineGatewayIds((current) => {
            const next = new Set([...current, gatewayId]);
            onlineGatewayIdsRef.current = next;
            return next;
          });
          setGatewayReady(true);
          setRelayGatewayId(gatewayId);
          setSelectedGatewayId((current) => current ?? gatewayId);
          setConnectionError((current) => current === t.gatewayNotConnected ? undefined : current);
          relay.sendFrame({ type: 'client.list-providers', gatewayId });
          return;
        }
        if (frame.status === 'disconnected') {
          const nextOnlineGatewayIds = new Set(onlineGatewayIdsRef.current);
          nextOnlineGatewayIds.delete(gatewayId);
          setOnlineGatewayIds((current) => {
            const next = new Set(current);
            next.delete(gatewayId);
            onlineGatewayIdsRef.current = next;
            return next;
          });
          const effectiveGatewayId = currentSessionIdRef.current
            ? (activeSessionGatewayIdRef.current ?? selectedGatewayIdRef.current)
            : selectedGatewayIdRef.current;
          if (gatewayId === effectiveGatewayId) {
            setGatewayReady(false);
            setRelayGatewayId((current) => current === gatewayId ? undefined : current);
            setConnectionError(t.gatewayNotConnected);
          } else {
            setGatewayReady(nextOnlineGatewayIds.size > 0);
          }
          return;
        }
      }
      if (frame.type === 'sessions' && Array.isArray(frame.sessions) && frame.sessions.length === 0 && gatewayReady) {
        setGatewayReady(false);
        setHasGatewayStatusFrame(false);
        setRelayGatewayId(undefined);
        setSelectedGatewayId(undefined);
        setConnectionError(t.gatewayNotConnected);
        return;
      }
      if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
        setRelaySessions(frame.sessions.filter(isRelaySessionSummary));
        const pendingId = currentSessionIdRef.current;
        if (pendingId && subscribedSessionIdRef.current == null) {
          const appeared = (frame.sessions as unknown[]).some((s) => typeof s === 'object' && s !== null && (s as Record<string, unknown>).id === pendingId);
          if (appeared) {
            setSubscribeRetryKey((k) => k + 1);
          }
        }
        return;
      }
      if (frame.type === 'gateway.providers') {
        const frameGatewayId = typeof frame.gatewayId === 'string' ? frame.gatewayId : undefined;
        if (frameGatewayId && frameGatewayId !== selectedGatewayId) {
          return;
        }
        const nextProviders = Array.isArray(frame.providers)
          ? frame.providers.filter((provider: unknown): provider is ProviderOption => isProviderOption(provider))
          : [];
        if (nextProviders.length > 0) {
          markGatewayReadyFallback();
          setProviderOptions(nextProviders);
          setSelectedProvider((currentProvider) =>
            nextProviders.some((provider: ProviderOption) => provider.provider === currentProvider)
              ? currentProvider
              : nextProviders[0]!.provider
          );
          setSelectedModel((currentModel) => {
            const provider =
              nextProviders.find((item: ProviderOption) => item.provider === selectedProviderRef.current) ??
              nextProviders[0]!;
            return provider.models.includes(currentModel) ? currentModel : provider.models[0]!;
          });
        } else {
          setMessages((items) => [...items, { kind: 'system', id: `providers-${Date.now()}`, text: t.chatsProviderFail }]);
        }
        return;
      }
      if (frame.type === 'gateway.cwd-suggestions') {
        const frameGatewayId = typeof frame.gatewayId === 'string' ? frame.gatewayId : undefined;
        if (
          typeof frame.cwd === 'string' &&
          frame.cwd === cwdRef.current &&
          (!frameGatewayId || frameGatewayId === selectedGatewayId)
        ) {
          const suggestions = Array.isArray(frame.suggestions)
            ? frame.suggestions.filter((item: unknown): item is string => typeof item === 'string')
            : [];
          setCwdSuggestions(suggestions);
          setCwdActiveIndex(0);
        }
        return;
      }
      if (frame.type === 'gateway.session-created' && typeof frame.sessionId === 'string') {
        setConnectionError(undefined);
        setSessionAccessError(undefined);
        setActiveSessionGatewayId(selectedGatewayId);
        setActiveSessionMetadataReady(true);
        skipNextHistoryLoadSessionIdRef.current = frame.sessionId;
        pendingCreatedSessionIdRef.current = frame.sessionId;
        createdSessionIdRef.current = frame.sessionId;
        setAgentSessionId(undefined);
        setActiveSessionProvider(pendingSessionProviderRef.current);
        setActiveSessionModel(pendingSessionModelRef.current);
        currentSessionIdRef.current = frame.sessionId;
        setCurrentSessionId(frame.sessionId);
        navigate(`/chats/${frame.sessionId}`, { replace: true });
        setMessages((items) => [...items, { kind: 'system', id: `started-${frame.sessionId}`, text: t.chatsSessionStarted }]);
        return;
      }
      if (frame.type === 'event' && typeof frame.event === 'object' && frame.event) {
        const relayEvent = frame.event as { sessionId?: unknown; type?: unknown; payload?: unknown };
        if (
          relayEvent.type === 'session.agent-id-updated' &&
          relayEvent.sessionId === currentSessionIdRef.current &&
          relayEvent.payload &&
          typeof relayEvent.payload === 'object' &&
          typeof (relayEvent.payload as { agentSessionId?: unknown }).agentSessionId === 'string'
        ) {
          setAgentSessionId((relayEvent.payload as { agentSessionId: string }).agentSessionId);
        }
        return;
      }
      if (frame.type === 'gateway.chat-catchup' && typeof frame.text === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        setConnectionError(undefined);
        setSessionAccessError(undefined);
        const frameText = frame.text;
        const fallbackAgentId = currentAgentIdRef.current ?? findLatestOpenAgentId(messagesRef.current);
        if (fallbackAgentId) {
          currentAgentIdRef.current = fallbackAgentId;
        }
        setMessages((items) =>
          items.map((item) =>
            item.kind === 'agent' && item.id === currentAgentIdRef.current
              ? { ...item, text: frameText, isWaiting: false, isStreaming: true }
              : item
          )
        );
        return;
      }
      if (frame.type === 'agent.delta' && typeof frame.text === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        setConnectionError(undefined);
        setSessionAccessError(undefined);
        if (revealTimerRef.current !== undefined) {
          window.clearInterval(revealTimerRef.current);
          revealTimerRef.current = undefined;
        }
        const frameText = frame.text;
        const fallbackAgentId = currentAgentIdRef.current ?? findLatestOpenAgentId(messagesRef.current);
        if (fallbackAgentId) {
          currentAgentIdRef.current = fallbackAgentId;
        }
        setMessages((items) => {
          const existingId = currentAgentIdRef.current;
          if (existingId) {
            return items.map((item) =>
              item.kind === 'agent' && item.id === existingId
                ? { ...item, text: item.text + frameText, isWaiting: false, isStreaming: true }
                : item
            );
          }
          const id = `agent-${Date.now()}`;
          currentAgentIdRef.current = id;
          return [
            ...items,
            {
              kind: 'agent',
              id,
              text: frameText,
              isStreaming: true,
              isWaiting: false,
              isLost: false,
              provider: activeSessionProviderRef.current ?? 'agent'
            }
          ];
        });
        return;
      }
      if (frame.type === 'agent.result' && typeof frame.text === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        setConnectionError(undefined);
        setSessionAccessError(undefined);
        if (typeof frame.sessionId === 'string' && frame.sessionId === pendingCreatedSessionIdRef.current) {
          pendingCreatedSessionIdRef.current = null;
        }
        // Update usage stats (context % and rate limit)
        const resultContextWindow = typeof frame.contextWindow === 'number' ? frame.contextWindow : undefined;
        const resultUsage = frame.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
        if (resultContextWindow && resultUsage) {
          // Prefer contextInputTokens (last agentic iteration's input) over cumulative totals which can exceed contextWindow
          const totalTokens = typeof frame.contextInputTokens === 'number'
            ? frame.contextInputTokens
            : (resultUsage.input_tokens ?? 0) + (resultUsage.cache_read_input_tokens ?? 0) + (resultUsage.cache_creation_input_tokens ?? 0);
          const contextPct = Math.min(100, Math.round((totalTokens / resultContextWindow) * 100));
          const rateLimitInfo = frame.rateLimitInfo as {
            resetsAt?: number;
            rateLimitType?: string;
            primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
            secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
          } | undefined;
          const stats = {
            contextPct,
            rateLimitResetsAt: rateLimitInfo?.resetsAt,
            rateLimitType: rateLimitInfo?.rateLimitType,
            primary: rateLimitInfo?.primary,
            secondary: rateLimitInfo?.secondary
          };
          setUsageStats(stats);
        }
        const frameText = frame.text;
        const usage = typeof frame.usage === 'object' && frame.usage && !Array.isArray(frame.usage)
          ? frame.usage as Usage
          : undefined;
        const nextSuggestions = normalizeNextSuggestions(frame.nextSuggestions);
        const durationMs = Date.now() - inflightStartedAtRef.current;
        const existingOpenAgentId = currentAgentIdRef.current ?? findLatestOpenAgentId(messagesRef.current) ?? findLatestLostAgentId(messagesRef.current);
        const agentId = existingOpenAgentId ?? `agent-${Date.now()}`;
        const existingById = messagesRef.current.find((item) => item.kind === 'agent' && item.id === agentId);
        const duplicateIndex = messagesRef.current.findIndex(
          (item) => item.kind === 'agent' && item.text === frameText && !item.isWaiting
        );
        const existingText = existingById?.kind === 'agent' ? existingById.text : '';
        const shouldReveal =
          duplicateIndex < 0 &&
          frameText.length > 80 &&
          (!existingText || frameText.length - existingText.length > 80);
        const revealStartLength = shouldReveal ? existingText.length : 0;
        currentAgentIdRef.current = null;
        setMessages((items) => {
          if (duplicateIndex >= 0 && !existingById) {
            return items.map((item, index) =>
              index === duplicateIndex && item.kind === 'agent'
                ? { ...item, isStreaming: false, isWaiting: false, usage, durationMs, nextSuggestions }
                : item
            );
          }
          const replacement: MessageItem = {
            kind: 'agent',
            id: agentId,
            text: shouldReveal ? existingText : frameText,
            isStreaming: shouldReveal,
            isWaiting: false,
            isLost: false,
            provider: activeSessionProviderRef.current ?? 'agent',
            usage: shouldReveal ? undefined : usage,
            durationMs: shouldReveal ? undefined : durationMs,
            nextSuggestions: shouldReveal ? undefined : nextSuggestions
          };
          return items.some((item) => item.kind === 'agent' && item.id === agentId)
            ? items.map((item) => item.kind === 'agent' && item.id === agentId ? { ...item, ...replacement } : item)
            : [...items, replacement];
        });
        if (shouldReveal) {
          let cursor = revealStartLength;
          if (revealTimerRef.current !== undefined) {
            window.clearInterval(revealTimerRef.current);
          }
          revealTimerRef.current = window.setInterval(() => {
            cursor = Math.min(cursor + 18, frameText.length);
            setMessages((items) =>
              items.map((item) =>
                item.kind === 'agent' && item.id === agentId
                  ? {
                      ...item,
                      text: frameText.slice(0, cursor),
                      isStreaming: cursor < frameText.length,
                      usage: cursor >= frameText.length ? usage : item.usage,
                      durationMs: cursor >= frameText.length ? durationMs : item.durationMs,
                      nextSuggestions: cursor >= frameText.length ? nextSuggestions : item.nextSuggestions
                    }
                  : item
              )
            );
            if (cursor >= frameText.length && revealTimerRef.current !== undefined) {
              window.clearInterval(revealTimerRef.current);
              revealTimerRef.current = undefined;
            }
          }, 16);
        }
        setIsInflight(false);
        return;
      }
      if (frame.type === 'agent.tool' && typeof frame.name === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        const toolName = frame.name;
        setMessages((items) => [
          ...items,
          {
            kind: 'tool',
            id: `tool-${Date.now()}`,
            toolName,
            input: (frame.input as Record<string, unknown>) ?? {},
            result: typeof frame.result === 'string' ? frame.result : undefined,
            isError: Boolean(frame.isError),
            isInFlight: false
          }
        ]);
        return;
      }
      if (frame.type === 'agent.permission_request' && typeof frame.requestId === 'string' && typeof frame.toolName === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        const { requestId, toolName } = frame as { requestId: string; toolName: string; input?: Record<string, unknown> };
        setMessages((items) => [
          ...items,
          { kind: 'permission', id: `permission-${requestId}`, requestId, toolName }
        ]);
        return;
      }
      if (frame.type === 'error' && typeof frame.message === 'string') {
        if (typeof frame.sessionId === 'string' && frame.sessionId && frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        const frameMessage = frame.message;
        if (frame.code === 'session_not_found') {
          // Session not yet known to relay (race on reconnect). Clear subscription
          // state so the subscribe effect retries when sessions broadcast arrives.
          subscribedSessionIdRef.current = null;
          return;
        }
        if (frame.code === 'gateway_required') {
          setConnectionError(t.gatewaySelectorNoSelection);
          setIsInflight(false);
          currentAgentIdRef.current = null;
          return;
        }
        if (frame.code === 'gateway_unauthorized') {
          setConnectionError('Gateway 不属于当前账号');
          setIsInflight(false);
          currentAgentIdRef.current = null;
          return;
        }
        if (
          frame.code === 'gateway_unavailable' ||
          frame.code === 'forbidden' ||
          frame.code === 'wrong_ticket_scope'
        ) {
          if (frame.code === 'gateway_unavailable') {
            setGatewayReady(false);
            setHasGatewayStatusFrame(false);
            setRelayGatewayId(undefined);
          }
          if (frame.code === 'forbidden' && frameMessage === 'session is outside client scope') {
            setSessionAccessError(t.chatsSessionOutsideGateway);
          } else {
            setConnectionError(frame.code === 'gateway_unavailable' ? t.gatewayNotConnected : frameMessage);
          }
          setIsInflight(false);
          currentAgentIdRef.current = null;
          return;
        }
        if (frame.code === 'session_lost') {
          setMessages((items) =>
            items.map((item) =>
              item.kind === 'agent' && item.id === currentAgentIdRef.current
                ? { ...item, isStreaming: false, isWaiting: false, isLost: true }
                : item
            )
          );
          setIsInflight(false);
          if (typeof frame.sessionId === 'string' && frame.sessionId === pendingCreatedSessionIdRef.current) {
            pendingCreatedSessionIdRef.current = null;
          }
        } else {
          const agentId = currentAgentIdRef.current;
          currentAgentIdRef.current = null;
          setMessages((items) => {
            const nextItems = agentId
              ? items.map((item) =>
                  item.kind === 'agent' && item.id === agentId
                    ? { ...item, isStreaming: false, isWaiting: false, isLost: true }
                    : item
                )
              : items;
            return [...nextItems, { kind: 'system', id: `error-${Date.now()}`, text: frameMessage }];
          });
          setIsInflight(false);
        }
      }
  }, [gatewayReady, markGatewayReadyFallback, navigate, relayGatewayId, selectedGatewayId, t.chatsProviderFail, t.chatsSessionOutsideGateway, t.chatsSessionStarted, t.gatewayNotConnected, t.gatewaySelectorNoSelection]);

  const { wsReady, sendFrame, connectionEpoch } = useChatRelaySocket({
    accessToken: normalAuth?.accessToken,
    relayUrl,
    onFrame: handleRelayFrame,
    onClose: handleRelayClose
  });

  React.useEffect(() => {
    if (!wsReady || connectionEpoch <= 1 || connectionEpoch === lastCatchupConnectionEpochRef.current) {
      return;
    }
    lastCatchupConnectionEpochRef.current = connectionEpoch;
    onReconnectCatchup?.();
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) {
      return;
    }
    void Promise.all([
      loadActiveSessionMetadata(sessionId).catch(() => setActiveSessionMetadataReady(true)),
      loadActiveSessionHistory(sessionId, { protectNewerLocal: true }).catch(() => undefined)
    ]);
  }, [connectionEpoch, loadActiveSessionHistory, loadActiveSessionMetadata, onReconnectCatchup, wsReady]);

  React.useEffect(() => {
    if (!cwdPickerOpen || currentSessionId || !wsReady || !selectedGatewayId) {
      setCwdSuggestions([]);
      setCwdActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      sendFrame({ type: 'client.cwd-suggest', cwd, gatewayId: selectedGatewayId });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentSessionId, cwd, cwdPickerOpen, selectedGatewayId, sendFrame, wsReady]);

  React.useEffect(() => {
    if (currentSessionId || !selectedGatewayId) {
      return;
    }
    if (previousSelectedGatewayIdRef.current === selectedGatewayId) {
      return;
    }
    previousSelectedGatewayIdRef.current = selectedGatewayId;
    setCwd('~');
    setCwdSuggestions([]);
    setCwdActiveIndex(0);
    setProviderOptions(DEFAULT_PROVIDER_OPTIONS);
    setSelectedProvider(DEFAULT_PROVIDER_OPTIONS[0]!.provider);
    setSelectedModel(DEFAULT_PROVIDER_OPTIONS[0]!.models[0]!);
    if (wsReady) {
      providerRequestKeyRef.current = selectedGatewayId;
      sendFrame({ type: 'client.list-providers', gatewayId: selectedGatewayId });
      if (cwdPickerOpen) {
        sendFrame({ type: 'client.cwd-suggest', cwd: '~', gatewayId: selectedGatewayId });
      }
    }
  }, [currentSessionId, cwdPickerOpen, selectedGatewayId, sendFrame, wsReady]);

  React.useEffect(() => {
    if (currentSessionId || !wsReady || !selectedGatewayId || providerRequestKeyRef.current === selectedGatewayId) {
      return;
    }
    providerRequestKeyRef.current = selectedGatewayId;
    sendFrame({ type: 'client.list-providers', gatewayId: selectedGatewayId });
  }, [currentSessionId, selectedGatewayId, sendFrame, wsReady]);

  React.useEffect(() => {
    const models = providerOptions.find((provider) => provider.provider === selectedProvider)?.models ?? [];
    if (models.length > 0 && !models.includes(selectedModel)) {
      setSelectedModel(models[0]!);
    }
  }, [providerOptions, selectedModel, selectedProvider]);

  React.useEffect(() => {
    if (!wsReady) {
      return;
    }
    const previousSessionId = subscribedSessionIdRef.current;
    if (previousSessionId && previousSessionId !== currentSessionId) {
      sendFrame({ type: 'client.unsubscribe', sessionId: previousSessionId });
      subscribedSessionIdRef.current = null;
    }
    if (!currentSessionId || !activeSessionMetadataReady) {
      return;
    }
    if (subscribedSessionIdRef.current === currentSessionId) {
      return;
    }
    setSessionAccessError(undefined);
    sendFrame({ type: 'client.subscribe', sessionId: currentSessionId, mode: 'control' });
    subscribedSessionIdRef.current = currentSessionId;
  }, [activeSessionMetadataReady, currentSessionId, sendFrame, wsReady, subscribeRetryKey]);

  React.useEffect(() => {
    return () => {
      const sessionId = subscribedSessionIdRef.current;
      if (sessionId) {
        sendFrame({ type: 'client.unsubscribe', sessionId });
        subscribedSessionIdRef.current = null;
      }
    };
  }, [sendFrame]);

  const sendMessage = React.useCallback(() => {
    const text = inputText.trim();
    if (!text || isInflight || !wsReady || connectionError || sessionAccessError) return;
    const existingProviderModels = providerOptions.find((provider) => provider.provider === activeSessionProvider)?.models ?? [];
    const messageProvider = currentSessionId ? (activeSessionProvider ?? 'agent') : selectedProvider;
    const messageModel = currentSessionId ? (activeSessionModel ?? existingProviderModels[0]) : selectedModel;
    if (!currentSessionId && !selectedGatewayId) {
      setConnectionError(t.gatewaySelectorNoSelection);
      return;
    }
    if (!currentSessionId && selectedGatewayId && !onlineGatewayIds.has(selectedGatewayId)) {
      setConnectionError(t.gatewaySelectorOffline);
      return;
    }
    inflightStartedAtRef.current = Date.now();
    const pendingAgentId = `agent-${Date.now()}`;
    currentAgentIdRef.current = pendingAgentId;
    setMessages((items) => [
      ...items,
      { kind: 'user', id: `user-${Date.now()}`, content: text, ts: Date.now() },
      { kind: 'agent', id: pendingAgentId, text: '', isStreaming: false, isWaiting: true, isLost: false, provider: messageProvider }
    ]);
    setInputText('');
    setIsInflight(true);
    if (currentSessionId) {
      sendFrame({ type: 'client.chat', sessionId: currentSessionId, message: text, model: messageModel });
      return;
    }
    pendingSessionProviderRef.current = selectedProvider;
    pendingSessionModelRef.current = selectedModel;
    sendFrame({
      type: 'client.chat',
      sessionId: null,
      provider: selectedProvider,
      model: selectedModel,
      cwd,
      message: text,
      gatewayId: selectedGatewayId
    });
  }, [activeSessionModel, activeSessionProvider, connectionError, cwd, currentSessionId, inputText, isInflight, onlineGatewayIds, providerOptions, selectedGatewayId, selectedModel, selectedProvider, sendFrame, sessionAccessError, t.gatewaySelectorNoSelection, t.gatewaySelectorOffline, wsReady]);

  const sendPermissionResponse = React.useCallback((requestId: string, decision: 'allow' | 'deny') => {
    if (!wsReady || !currentSessionIdRef.current) return;
    setMessages((items) => items.map((item) =>
      item.kind === 'permission' && item.requestId === requestId ? { ...item, decided: decision } : item
    ));
    sendFrame({ type: 'client.permission_response', sessionId: currentSessionIdRef.current, requestId, decision });
  }, [sendFrame, wsReady]);

  const applyNextSuggestion = React.useCallback((description: string) => {
    setInputText(description);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = description.length;
      inputRef.current?.setSelectionRange(length, length);
    });
  }, []);

  const isNewSession = !currentSessionId && messages.length === 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent;
    const isComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();
      sendMessage();
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
  };

  const effectiveGatewayId = currentSessionId ? (activeSessionGatewayId ?? selectedGatewayId) : selectedGatewayId;
  const selectedGatewayOnline = effectiveGatewayId ? onlineGatewayIds.has(effectiveGatewayId) : false;
  const displayGatewayName = currentSessionId
    ? (activeSessionGatewayId ? gatewayNamesById[activeSessionGatewayId] : undefined)
    : selectedGatewayName;
  const gatewayInputMessage = !effectiveGatewayId
    ? t.gatewaySelectorNoSelection
    : selectedGatewayOnline
      ? undefined
      : t.gatewaySelectorOffline;

  const buildInputPlaceholder = (provider: string, model: string, gatewayName?: string) => {
    const parts: string[] = [];
    if (gatewayName) parts.push(gatewayName);
    if (provider) parts.push(provider.charAt(0).toUpperCase() + provider.slice(1));
    if (model) parts.push(model.charAt(0).toUpperCase() + model.slice(1));
    return `${t.chatsSendTo} ${parts.join(' · ')}…`;
  };
  const isGatewayInputBlocked = Boolean(gatewayInputMessage);
  const canSend = wsReady && !isInflight && !connectionError && !sessionAccessError && !isGatewayInputBlocked && inputText.trim().length > 0;
  const isInputDisabled = isInflight || !wsReady || Boolean(connectionError) || Boolean(sessionAccessError) || isGatewayInputBlocked;
  const relayStatusChip = (() => {
    if (wsReady) {
      return (
        <div className="chat-connection-chip chat-connection-chip--connected" role="status" aria-live="polite">
          <span />
          <strong>{t.chatsRelayConnected}</strong>
        </div>
      );
    }
    if (hasEverConnectedRef.current) {
      return (
        <div className="chat-connection-chip" role="status" aria-live="polite">
          <span />
          <strong>{t.chatsRelayDisconnected}</strong>
        </div>
      );
    }
    return (
      <div className="chat-connection-chip chat-connection-chip--connecting" role="status" aria-live="polite">
        <strong>{t.chatsRelayConnecting}</strong>
      </div>
    );
  })();

  const gatewayStatusChip = (() => {
    if (connectionError) {
      return (
        <div className="chat-connection-chip" role="status" aria-live="polite">
          <span />
          <strong>{connectionError}</strong>
        </div>
      );
    }
    if (wsReady && hasEverConnectedRef.current && !gatewayReady) {
      return (
        <div className="chat-connection-chip chat-connection-chip--connecting" role="status" aria-live="polite">
          <strong>{t.chatsGatewayConnecting}</strong>
        </div>
      );
    }
    if (wsReady && gatewayReady) {
      return (
        <div className="chat-connection-chip chat-connection-chip--connected" role="status" aria-live="polite">
          <span />
          <strong>{t.chatsGatewayConnected}</strong>
        </div>
      );
    }
    return (
      <div className="chat-connection-chip chat-connection-chip--connecting" role="status" aria-live="polite">
        <strong>{t.chatsGatewayConnecting}</strong>
      </div>
    );
  })();

  const connectionStatusChips = (
    wsReady && gatewayReady && !connectionError ? (
      <div className="chat-connection-mini" role="status" aria-live="polite" title={`${t.chatsGatewayConnected} / ${t.chatsRelayConnected}`}>
        <span className="chat-connection-mini-label">G</span>
        <span className="chat-connection-mini-dot" />
        <span className="chat-connection-mini-label">R</span>
        <span className="chat-connection-mini-dot" />
      </div>
    ) : (
      <>
        {gatewayStatusChip}
        {relayStatusChip}
      </>
    )
  );

  const gatewaySelector = (
    <GatewaySelector
      selectedGatewayId={currentSessionId ? activeSessionGatewayId : selectedGatewayId}
      onSelect={(id, name) => {
        if (currentSessionId) {
          return;
        }
        setSelectedGatewayId(id);
        setSelectedGatewayName(name);
        setCwd('~');
        setCwdSuggestions([]);
        setCwdActiveIndex(0);
        if (wsReady) {
          providerRequestKeyRef.current = id;
          sendFrame({ type: 'client.list-providers', gatewayId: id });
          if (cwdPickerOpen) {
            sendFrame({ type: 'client.cwd-suggest', cwd: '~', gatewayId: id });
          }
        }
        setConnectionError((current) =>
          current === t.gatewaySelectorNoSelection || current === t.gatewaySelectorOffline
            ? undefined
            : current
        );
      }}
      onGatewayName={(_, name) => {
        setSelectedGatewayName(name);
      }}
      onlineGatewayIds={onlineGatewayIds}
      readonly={Boolean(currentSessionId)}
    />
  );

  const sendButton = (
    <button
      onClick={sendMessage}
      disabled={!canSend}
      className={`chat-send-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
        canSend
          ? 'bg-brand text-black hover:opacity-90'
          : 'bg-muted text-muted-foreground cursor-not-allowed'
      }`}
    >
      {isInflight
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <ArrowUp className="h-4 w-4" />}
    </button>
  );

  const displayProvider = currentSessionId ? (activeSessionProvider ?? 'agent') : selectedProvider;
  const displayProviderModels = providerOptions.find((provider) => provider.provider === displayProvider)?.models ?? [];
  const displayModel = currentSessionId ? (activeSessionModel ?? displayProviderModels[0]) : selectedModel;
  const inputCard = (withControls: boolean) => (
    <div className="chat-input-card relative overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
      <Textarea
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        placeholder={gatewayInputMessage ?? buildInputPlaceholder(
          withControls ? selectedProvider : displayProvider,
          withControls ? selectedModel : displayModel,
          withControls && selectedGatewayOnline ? selectedGatewayName : undefined
        )}
        disabled={isInputDisabled}
        className="max-h-44 min-h-[88px] resize-none rounded-none border-0 bg-transparent px-4 pt-4 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
        onKeyDown={onKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
      <div className={`chat-input-toolbar ${withControls ? 'chat-input-toolbar-controls' : 'chat-input-toolbar-session'} relative flex items-center gap-2 border-t border-border/50 px-3 py-2.5`}>
        {withControls && (
          <>
            <Select
              value={selectedProvider}
              onValueChange={(value) => {
                setSelectedProvider(value);
                setSelectedModel(providerOptions.find((p) => p.provider === value)?.models[0] ?? '');
              }}
            >
              <SelectTrigger className="chat-provider-trigger chat-toolbar-trigger w-auto capitalize">
                <SelectValue placeholder={t.chatsSelectProvider} />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>{p.provider.charAt(0).toUpperCase() + p.provider.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="chat-model-trigger chat-toolbar-trigger w-auto capitalize">
                <SelectValue placeholder={t.chatsSelectModel} />
              </SelectTrigger>
              <SelectContent>
                {(providerOptions.find((p) => p.provider === selectedProvider)?.models ?? []).map((model) => (
                  <SelectItem key={model} value={model}>{model.charAt(0).toUpperCase() + model.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {gatewaySelector}
            <Popover
              open={cwdPickerOpen}
              onOpenChange={(open) => {
                setCwdPickerOpen(open);
                if (open && wsReady && selectedGatewayId) {
                  sendFrame({ type: 'client.cwd-suggest', cwd, gatewayId: selectedGatewayId });
                }
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={cwd}
                  className="chat-cwd-trigger flex h-7 max-w-[260px] min-w-[132px] items-center rounded-full bg-muted px-3 font-mono text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Folder className="chat-cwd-icon" />
                  <span className="chat-cwd-label">{t.chatsCwdShort}</span>
                  <span className="chat-cwd-value truncate">{cwd ? compactPathLabel(cwd) : t.chatsCwdSelect}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" sideOffset={10} className="chat-cwd-popover w-[520px] gap-2 p-2">
                <Input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setCwdActiveIndex((index) => Math.min(index + 1, Math.max(cwdSuggestions.length - 1, 0)));
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setCwdActiveIndex((index) => Math.max(index - 1, 0));
                      return;
                    }
                    if (event.key === 'Enter') {
                      const suggestion = cwdSuggestions[cwdActiveIndex];
                      if (suggestion) {
                        event.preventDefault();
                        setCwd(suggestion);
                        setCwdPickerOpen(false);
                      }
                      return;
                    }
                    if (event.key === 'Escape') {
                      setCwdPickerOpen(false);
                    }
                  }}
                  autoFocus
                  placeholder={t.chatsCwd}
                  className="h-9 rounded-lg bg-muted font-mono text-[12px]"
                />
                <div className="max-h-64 overflow-y-auto">
                  {cwdSuggestions.length > 0 ? (
                    cwdSuggestions.map((suggestion, index) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          setCwd(suggestion);
                          setCwdPickerOpen(false);
                        }}
                        onMouseEnter={() => setCwdActiveIndex(index)}
                        className={`block w-full truncate rounded-lg px-3 py-2 text-left font-mono text-[12px] text-popover-foreground ${
                          index === cwdActiveIndex ? 'bg-accent' : 'hover:bg-accent'
                        }`}
                      >
                        {suggestion}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                      {wsReady ? t.chatsCwd : t.gatewayNotConnected}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex-1" />
          </>
        )}
        {!withControls && (
          <>
            {displayProviderModels.length > 0 && displayModel && (
              <Select value={displayModel} onValueChange={setActiveSessionModel}>
                <SelectTrigger className="chat-model-trigger h-7 w-auto gap-1 rounded-full border-0 bg-muted px-3 text-[12px] font-medium shadow-none ring-0 focus:ring-0">
                  <SelectValue placeholder={t.chatsSelectModel} />
                </SelectTrigger>
                <SelectContent>
                  {displayProviderModels.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activeSessionProjectPath && (
              <span
                title={activeSessionProjectPath}
                className="chat-session-path-chip flex h-7 max-w-[260px] min-w-0 items-center rounded-full bg-muted px-3 font-mono text-[12px] font-medium text-muted-foreground"
              >
                <span className="truncate">{compactProjectPath(activeSessionProjectPath)}</span>
              </span>
            )}
            <div className="flex-1" />
            {usageStats && (
              <UsageStatsChip contextPct={usageStats.contextPct} rateLimitResetsAt={usageStats.rateLimitResetsAt} rateLimitType={usageStats.rateLimitType} />
            )}
          </>
        )}
        {sendButton}
      </div>
    </div>
  );

  if (isNewSession) {
    return (
      <div className="chat-surface chat-new-session-surface relative flex h-full flex-col items-center justify-center bg-background px-6">
        {onOpenDrawer && (
          <button
            onClick={onOpenDrawer}
            className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {onExpandSidebar && (
          <button
            onClick={onExpandSidebar}
            className="absolute left-3 top-3 hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" />
          </button>
        )}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <div className="chat-header-connection-status">
            {connectionStatusChips}
          </div>
          <NotificationBell />
        </div>
        <div className="chat-new-session-hero mb-10 flex flex-col items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-black shadow-md"
            style={{ background: 'var(--gradient-brand)' }}
          >
            T
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            {t.chatsWelcomeGreeting}
          </h1>
        </div>

        <div className="chat-new-session-composer w-full max-w-[680px]">
          {inputCard(true)}
          <div className="mt-3 flex items-center justify-center gap-1">
            <span className="text-[11px] text-muted-foreground/70">{t.chatsCwdNote}</span>
          </div>
        </div>
      </div>
    );
  }

  const lastAgentIndex = findLastAgentIndex(messages);

  return (
    <div className="chat-surface flex h-full flex-col bg-background">
      {/* Session header */}
      <div className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur-sm">
        {onOpenDrawer && (
          <button
            onClick={onOpenDrawer}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        {onExpandSidebar && (
          <button
            onClick={onExpandSidebar}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" />
          </button>
        )}
        <div className="flex-1" />
        <div className="chat-header-connection-status">
          {connectionStatusChips}
        </div>
        {sessionAccessError ? (
          <div className="chat-header-session-status">
            <div className="chat-connection-chip" role="status" aria-live="polite">
              <span />
              <strong>{sessionAccessError}</strong>
            </div>
          </div>
        ) : null}
        {agentSessionId && (
          <button
            onClick={() => {
              const cmd = providerResumeCommand(displayProvider, agentSessionId);
              void navigator.clipboard.writeText(cmd);
              setCopiedAgentId(true);
              setTimeout(() => setCopiedAgentId(false), 1500);
            }}
            title={t.chatsCopyProviderSessionId.replace('{provider}', displayProvider)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {copiedAgentId
              ? <Check className="h-3 w-3 text-brand" />
              : <Copy className="h-3 w-3" />}
            <span>{copiedAgentId ? t.chatCodeCopied : t.chatsCopyProviderSessionId.replace('{provider}', displayProvider)}</span>
          </button>
        )}
        <NotificationBell />
      </div>

      {/* Messages */}
      <div ref={messageScrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((message, index) => {
            if (message.kind === 'user') {
              return <ChatBubbleUser key={message.id} content={message.content} />;
            }
            if (message.kind === 'agent') {
              return (
                <ChatBubbleAgent
                  key={message.id}
                  text={message.text}
                  isStreaming={message.isStreaming}
                  isWaiting={message.isWaiting}
                  isLost={message.isLost}
                  provider={message.provider}
                  usage={message.usage}
                  durationMs={message.durationMs}
                  nextSuggestions={index === lastAgentIndex ? message.nextSuggestions : undefined}
                  onSuggestionClick={applyNextSuggestion}
                />
              );
            }
            if (message.kind === 'tool') {
              return (
                <ToolCard
                  key={message.id}
                  toolName={message.toolName}
                  input={message.input}
                  result={message.result}
                  isError={message.isError}
                  isInFlight={message.isInFlight}
                />
              );
            }
            if (message.kind === 'permission') {
              return (
                <PermissionPrompt
                  key={message.id}
                  toolName={message.toolName}
                  requestId={message.requestId}
                  onAllow={(id) => sendPermissionResponse(id, 'allow')}
                  onDeny={(id) => sendPermissionResponse(id, 'deny')}
                  decided={message.decided}
                />
              );
            }
            return <SystemMessage key={message.id} text={message.text} />;
          })}
          <div ref={messageEndRef} aria-hidden="true" />
        </div>
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl flex flex-col gap-1.5">
          {/* Info row — click to open session settings */}
          <div className="flex items-center gap-2 self-start min-w-0">
            <Popover open={sessionSettingsOpen} onOpenChange={setSessionSettingsOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={t.chatsSessionSettings}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-muted-foreground/55 transition-colors hover:text-muted-foreground"
                >
                  {displayGatewayName && (
                    <>
                      <span className="max-w-[80px] truncate font-medium text-brand">{displayGatewayName}</span>
                      <span className="opacity-40">·</span>
                    </>
                  )}
                  {displayModel && <span className="font-medium">{displayModel}</span>}
                  {activeSessionProjectPath && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="max-w-[200px] truncate font-mono">{compactPathLabel(activeSessionProjectPath)}</span>
                    </>
                  )}
                  {usageStats?.contextPct !== undefined && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="tabular-nums">ctx {usageStats.contextPct}%</span>
                    </>
                  )}
                  <Settings className="ml-1 h-3 w-3 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-3">
                <div className="flex flex-col gap-2.5">
                  {displayProviderModels.length > 0 && displayModel && (
                    <div className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-[12px] text-muted-foreground">{t.chatsLabelModel}</span>
                      <Select value={displayModel} onValueChange={setActiveSessionModel}>
                        <SelectTrigger className="h-7 flex-1 text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {displayProviderModels.map((model) => (
                            <SelectItem key={model} value={model}>{model}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {activeSessionProjectPath && (
                    <div className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-[12px] text-muted-foreground">{t.chatsCwdShort}</span>
                      <span
                        title={activeSessionProjectPath}
                        className="flex h-7 min-w-0 flex-1 items-center rounded-lg bg-muted px-3 font-mono text-[12px] font-medium text-muted-foreground"
                      >
                        <span className="truncate">{compactPathLabel(activeSessionProjectPath)}</span>
                      </span>
                    </div>
                  )}
                  {(usageStats?.contextPct !== undefined || usageStats?.rateLimitResetsAt || usageStats?.primary) && (
                    <UsageStatsRows
                      contextPct={usageStats?.contextPct}
                      rateLimitResetsAt={usageStats?.rateLimitResetsAt}
                      rateLimitType={usageStats?.rateLimitType}
                      primary={usageStats?.primary}
                      secondary={usageStats?.secondary}
                    />
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Compact input card */}
          <div className="chat-input-card relative overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
            <div className="flex items-end gap-2 px-3 py-2.5">
              <Textarea
                ref={inputRef}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder={buildInputPlaceholder(displayProvider, displayModel)}
                disabled={isInputDisabled}
                className="flex-1 max-h-44 min-h-[36px] resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
                onKeyDown={onKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
              />
              {sendButton}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
