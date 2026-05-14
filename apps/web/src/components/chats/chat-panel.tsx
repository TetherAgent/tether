import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
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
import { getStoredNormalAccessToken } from '../../lib/api.js';
import { providerResumeCommand } from '../../lib/provider-resume-command.js';
import { fetchChatMessages, fetchChatSessions, type ChatSessionRecord, type ProviderOption } from './chat-data.js';
import { ChatHeader } from './chat-header.js';
import { ChatComposer } from './chat-composer.js';
import { ChatMessageList } from './chat-message-list.js';
import { NewChatSurface } from './new-chat-surface.js';
import { type RelayFrame, useRelayClient } from '../relay/use-relay-client.js';
import { ComposerSubmitButton } from '../workbench/composer-submit-button.js';
import { PathPicker } from '../workbench/path-picker.js';
import { WorkbenchCompactConnectionStatus } from '../workbench/workbench-status-pill.js';
import { GatewaySelector } from './gateway-selector.js';
import { SlashCommandMenu } from './slash-command-menu.js';
import { useSlashMenu } from './use-slash-menu.js';
import type { HistoryUsage, MessageItem, Usage, UsageStats } from './chat-types.js';
import {
  compactProjectPath,
  findLastAgentIndex,
  findLatestLostAgentId,
  findLatestOpenAgentId,
  historyMessagesToItems,
  historySnapshotLooksOlder,
  isProviderOption,
  normalizeNextSuggestions,
  usageStatsFromHistory
} from './chat-utils.js';

const DEFAULT_PROVIDER_OPTIONS: ProviderOption[] = [
  { provider: 'claude', models: ['sonnet', 'opus', 'haiku'] }
];

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
  const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
  const [selectedGatewayName, setSelectedGatewayName] = React.useState<string | undefined>(undefined);
  const [subscribeRetryKey, setSubscribeRetryKey] = React.useState(0);
  const [cwd, setCwd] = React.useState('~');
  const [cwdSuggestions, setCwdSuggestions] = React.useState<string[]>([]);
  const [cwdSuggestionsLoading, setCwdSuggestionsLoading] = React.useState(false);
  const [cwdPickerOpen, setCwdPickerOpen] = React.useState(false);
  const [cwdActiveIndex, setCwdActiveIndex] = React.useState(0);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(undefined);
  const [connectionError, setConnectionError] = React.useState<string | undefined>(undefined);
  const [sessionAccessError, setSessionAccessError] = React.useState<string | undefined>(undefined);
  const hasEverConnectedRef = React.useRef(false);
  const [usageStats, setUsageStats] = React.useState<UsageStats | undefined>(undefined);
  const [copiedAgentId, setCopiedAgentId] = React.useState(false);
  const [sessionSettingsOpen, setSessionSettingsOpen] = React.useState(false);
  const messageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const messageEndRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const newSessionInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const currentAgentIdRef = React.useRef<string | null>(null);
  const inflightStartedAtRef = React.useRef<number>(0);
  const revealTimerRef = React.useRef<number | undefined>(undefined);
  const messagesRef = React.useRef<MessageItem[]>([]);
  const activeSessionProviderRef = React.useRef(activeSessionProvider);
  const selectedProviderRef = React.useRef(selectedProvider);
  const currentSessionIdRef = React.useRef(currentSessionId);
  const selectedGatewayIdRef = React.useRef(selectedGatewayId);
  const activeSessionGatewayIdRef = React.useRef(activeSessionGatewayId);
  const subscribedSessionIdRef = React.useRef<string | null>(null);
  const releaseSessionSubscriptionRef = React.useRef<(() => void) | null>(null);
  const lastDeltaEventIdRef = React.useRef<number>(0);
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

  const relay = useRelayClient();
  const {
    acquireSessionSubscription,
    connectionEpoch,
    defaultGatewayId,
    gatewayConnected,
    gatewayIdsOnline,
    gatewayNamesById,
    relaySessions: providerRelaySessions,
    sendFrame,
    subscribeClose,
    subscribeFrame,
    wsReady
  } = relay;

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
    lastDeltaEventIdRef.current = 0;
    const { messages: historyMessages, lastEventId: historyLastEventId } = await fetchChatMessages(sessionId, token);
    lastDeltaEventIdRef.current = historyLastEventId;
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
    const session = providerRelaySessions.find((item) => item.id === currentSessionId);
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
  }, [currentSessionId, providerRelaySessions]);

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

  const handleRelayClose = React.useCallback(() => {
    subscribedSessionIdRef.current = null;
    setConnectionError(t.gatewayNotConnected);
    setIsInflight(false);
    currentAgentIdRef.current = null;
  }, [t.gatewayNotConnected]);

  const clearGatewayNotConnectedError = React.useCallback(() => {
    setConnectionError((current) => current === t.gatewayNotConnected ? undefined : current);
  }, [t.gatewayNotConnected]);

  const handleRelayFrame = React.useCallback((frame: RelayFrame, relay: { sendFrame: (frame: Record<string, unknown>) => boolean }) => {
      if (frame.type === 'client.auth.ok') {
        hasEverConnectedRef.current = true;
        setConnectionError(undefined);
        return;
      }
      if (frame.type === 'hello') {
        const gatewayId = typeof frame.gatewayId === 'string' ? frame.gatewayId : undefined;
        if (gatewayId) {
          setSelectedGatewayId((current) => current ?? gatewayId);
          clearGatewayNotConnectedError();
        }
        return;
      }
      if (frame.type === 'gateway.status' && typeof frame.gatewayId === 'string') {
        const gatewayId = frame.gatewayId;
        if (typeof frame.version === 'string' && frame.version) {
          rememberGatewayVersion(gatewayId, frame.version);
        }
        if (frame.status === 'connected') {
          setSelectedGatewayId((current) => current ?? gatewayId);
          clearGatewayNotConnectedError();
          relay.sendFrame({ type: 'client.list-providers', gatewayId });
          return;
        }
        if (frame.status === 'disconnected') {
          const effectiveGatewayId = currentSessionIdRef.current
            ? (activeSessionGatewayIdRef.current ?? selectedGatewayIdRef.current)
            : selectedGatewayIdRef.current;
          if (gatewayId === effectiveGatewayId) {
            subscribedSessionIdRef.current = null;
            setConnectionError(t.gatewayNotConnected);
          }
          return;
        }
      }
      if (frame.type === 'sessions' && Array.isArray(frame.sessions)) {
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
          clearGatewayNotConnectedError();
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
          setCwdSuggestionsLoading(false);
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
        if (typeof frame.lastEventId === 'number' && frame.lastEventId > lastDeltaEventIdRef.current) {
          lastDeltaEventIdRef.current = frame.lastEventId;
        }
        return;
      }
      if (frame.type === 'user.message' && typeof frame.text === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        setConnectionError(undefined);
        setSessionAccessError(undefined);
        const messageText = frame.text;
        const id = typeof frame.eventId === 'number' && frame.eventId > 0
          ? `user-remote-${frame.eventId}`
          : `user-remote-${Date.now()}`;
        setMessages((items) => {
          if (items.some((item) => item.kind === 'user' && item.id === id)) {
            return items;
          }
          return [...items, { kind: 'user', id, content: messageText, ts: Date.now() }];
        });
        return;
      }
      if (frame.type === 'agent.delta' && typeof frame.text === 'string') {
        if (frame.sessionId !== currentSessionIdRef.current) {
          return;
        }
        if (typeof frame.eventId === 'number' && frame.eventId > 0) {
          if (frame.eventId <= lastDeltaEventIdRef.current) {
            return;
          }
          lastDeltaEventIdRef.current = frame.eventId;
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
  }, [clearGatewayNotConnectedError, navigate, selectedGatewayId, t.chatsProviderFail, t.chatsSessionOutsideGateway, t.chatsSessionStarted, t.gatewayNotConnected, t.gatewaySelectorNoSelection]);

  React.useEffect(() => subscribeFrame(handleRelayFrame), [handleRelayFrame, subscribeFrame]);
  React.useEffect(() => subscribeClose(handleRelayClose), [handleRelayClose, subscribeClose]);

  React.useEffect(() => {
    const preferredGatewayId =
      selectedGatewayIdRef.current ??
      activeSessionGatewayIdRef.current ??
      defaultGatewayId;
    if (preferredGatewayId) {
      setSelectedGatewayId((current) => current ?? preferredGatewayId);
    }
    if (wsReady && gatewayConnected) {
      hasEverConnectedRef.current = true;
      clearGatewayNotConnectedError();
    }
  }, [clearGatewayNotConnectedError, defaultGatewayId, gatewayConnected, wsReady]);

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
      setCwdSuggestionsLoading(false);
      setCwdActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      setCwdSuggestionsLoading(true);
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
    setCwdSuggestionsLoading(false);
    setCwdActiveIndex(0);
    setProviderOptions(DEFAULT_PROVIDER_OPTIONS);
    setSelectedProvider(DEFAULT_PROVIDER_OPTIONS[0]!.provider);
    setSelectedModel(DEFAULT_PROVIDER_OPTIONS[0]!.models[0]!);
    if (wsReady) {
      providerRequestKeyRef.current = selectedGatewayId;
      sendFrame({ type: 'client.list-providers', gatewayId: selectedGatewayId });
      if (cwdPickerOpen) {
        setCwdSuggestionsLoading(true);
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
      releaseSessionSubscriptionRef.current?.();
      releaseSessionSubscriptionRef.current = null;
      subscribedSessionIdRef.current = null;
    }
    if (!currentSessionId || !activeSessionMetadataReady) {
      return;
    }
    if (subscribedSessionIdRef.current === currentSessionId) {
      return;
    }
    setSessionAccessError(undefined);
    releaseSessionSubscriptionRef.current = acquireSessionSubscription({
      owner: `chat:${currentSessionId}`,
      sessionId: currentSessionId,
      mode: 'control',
      after: lastDeltaEventIdRef.current
    });
    subscribedSessionIdRef.current = currentSessionId;
  }, [acquireSessionSubscription, activeSessionMetadataReady, currentSessionId, wsReady, subscribeRetryKey]);

  React.useEffect(() => {
    return () => {
      const sessionId = subscribedSessionIdRef.current;
      if (sessionId) {
        releaseSessionSubscriptionRef.current?.();
        releaseSessionSubscriptionRef.current = null;
        subscribedSessionIdRef.current = null;
      }
    };
  }, []);

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
    if (!currentSessionId && selectedGatewayId && !gatewayIdsOnline.has(selectedGatewayId)) {
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
  }, [activeSessionModel, activeSessionProvider, connectionError, cwd, currentSessionId, gatewayIdsOnline, inputText, isInflight, providerOptions, selectedGatewayId, selectedModel, selectedProvider, sendFrame, sessionAccessError, t.gatewaySelectorNoSelection, t.gatewaySelectorOffline, wsReady]);

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

  const appendNextSuggestion = React.useCallback((description: string) => {
    setInputText((current) => {
      const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : '';
      return `${prefix}${description}`;
    });
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    });
  }, []);

  const isNewSession = !currentSessionId && messages.length === 0;

  const slashMenu = useSlashMenu({
    inputText,
    onSelect: (name) => {
      setInputText(`/${name} `);
      window.requestAnimationFrame(() => {
        (inputRef.current ?? newSessionInputRef.current)?.focus();
      });
    }
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenu.handleKeyDown(event)) return;
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
  const selectedGatewayOnline = effectiveGatewayId ? gatewayIdsOnline.has(effectiveGatewayId) : false;
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
  const relayConnection = (() => {
    if (wsReady) {
      return { state: 'connected' as const, label: t.chatsRelayConnected };
    }
    if (hasEverConnectedRef.current) {
      return { state: 'error' as const, label: t.chatsRelayDisconnected };
    }
    return { state: 'connecting' as const, label: t.chatsRelayConnecting };
  })();

  const gatewayConnection = (() => {
    if (connectionError) {
      return { state: 'error' as const, label: connectionError };
    }
    if (wsReady && gatewayConnected) {
      return { state: 'connected' as const, label: t.chatsGatewayConnected };
    }
    if (wsReady) {
      return { state: 'connecting' as const, label: t.chatsGatewayWaiting };
    }
    return { state: 'unknown' as const, label: t.chatsGatewayUnknown };
  })();

  const connectionStatusChips = (
    <WorkbenchCompactConnectionStatus
      gateway={gatewayConnection}
      relay={relayConnection}
    />
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
        setCwdSuggestionsLoading(false);
        setCwdActiveIndex(0);
        if (wsReady) {
          providerRequestKeyRef.current = id;
          sendFrame({ type: 'client.list-providers', gatewayId: id });
          if (cwdPickerOpen) {
            setCwdSuggestionsLoading(true);
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
      onlineGatewayIds={gatewayIdsOnline}
      readonly={Boolean(currentSessionId)}
    />
  );

  const sendButton = (
    <ComposerSubmitButton
      onClick={sendMessage}
      disabled={!canSend}
      loading={isInflight}
      title={t.send}
    />
  );

  const displayProvider = currentSessionId ? (activeSessionProvider ?? 'agent') : selectedProvider;
  const displayProviderModels = providerOptions.find((provider) => provider.provider === displayProvider)?.models ?? [];
  const displayModel = currentSessionId ? (activeSessionModel ?? displayProviderModels[0]) : selectedModel;
  const slashMenuEl = (
    <SlashCommandMenu
      open={slashMenu.open}
      commands={slashMenu.filteredCommands}
      activeIndex={slashMenu.activeIndex}
      onSelect={slashMenu.handleSelect}
      onActiveIndexChange={slashMenu.setActiveIndex}
    />
  );

  const inputCard = (withControls: boolean) => (
    <div className="chat-input-card relative overflow-hidden rounded-2xl border border-border" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
      <Textarea
        ref={withControls ? newSessionInputRef : undefined}
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        placeholder={gatewayInputMessage ?? buildInputPlaceholder(
          withControls ? selectedProvider : displayProvider,
          withControls ? selectedModel : displayModel,
          withControls && selectedGatewayOnline ? selectedGatewayName : undefined
        )}
        disabled={isInputDisabled}
        className="max-h-44 min-h-[88px] resize-none rounded-none border-0 bg-transparent px-4 pt-4 text-[15px] leading-relaxed shadow-none focus-visible:bg-transparent focus-visible:ring-0 dark:bg-transparent dark:focus-visible:bg-transparent"
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
            <PathPicker
              activeIndex={cwdActiveIndex}
              emptyLabel={wsReady ? t.chatsCwd : t.gatewayNotConnected}
              inputPlaceholder={t.chatsCwd}
              loading={cwdSuggestionsLoading}
              loadingLabel={t.chatsCwdLoading}
              onActiveIndexChange={setCwdActiveIndex}
              onOpenChange={(open) => {
                setCwdPickerOpen(open);
                if (open && wsReady && selectedGatewayId) {
                  setCwdSuggestionsLoading(true);
                  sendFrame({ type: 'client.cwd-suggest', cwd, gatewayId: selectedGatewayId });
                }
                if (!open) {
                  setCwdSuggestionsLoading(false);
                }
              }}
              onValueChange={setCwd}
              open={cwdPickerOpen}
              selectLabel={t.chatsCwdSelect}
              suggestions={cwdSuggestions}
              triggerLabel={t.chatsCwdShort}
              value={cwd}
            />
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
      <NewChatSurface
        composer={(
          <div className="relative">
            {slashMenuEl}
            {inputCard(true)}
          </div>
        )}
        connectionStatusChips={connectionStatusChips}
        connectionReady={wsReady && gatewayConnected && !connectionError}
        gatewayNamesById={gatewayNamesById}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
        t={t}
      />
    );
  }

  const lastAgentIndex = findLastAgentIndex(messages);

  return (
    <div className="chat-surface flex h-full flex-col bg-background">
      <ChatHeader
        agentSessionId={agentSessionId}
        connectionStatusChips={connectionStatusChips}
        copiedAgentId={copiedAgentId}
        displayProvider={displayProvider}
        gatewayNamesById={gatewayNamesById}
        onCopyAgentSession={() => {
          if (!agentSessionId) return;
          const cmd = providerResumeCommand(displayProvider, agentSessionId);
          void navigator.clipboard.writeText(cmd);
          setCopiedAgentId(true);
          setTimeout(() => setCopiedAgentId(false), 1500);
        }}
        onExpandSidebar={onExpandSidebar}
        onOpenDrawer={onOpenDrawer}
        sessionAccessError={sessionAccessError}
        t={t}
      />

      <ChatMessageList
        lastAgentIndex={lastAgentIndex}
        messageEndRef={messageEndRef}
        messageScrollRef={messageScrollRef}
        messages={messages}
        onChoiceClick={appendNextSuggestion}
        onCommandClick={applyNextSuggestion}
        onPermissionResponse={sendPermissionResponse}
        onSuggestionClick={applyNextSuggestion}
      />

      <ChatComposer
        activeSessionProjectPath={activeSessionProjectPath}
        buildInputPlaceholder={buildInputPlaceholder}
        displayGatewayName={displayGatewayName}
        displayModel={displayModel}
        displayModelOptions={displayProviderModels}
        displayProvider={displayProvider}
        inputRef={inputRef}
        inputText={inputText}
        isInputDisabled={isInputDisabled}
        onCompositionEnd={handleCompositionEnd}
        onCompositionStart={handleCompositionStart}
        onInputChange={setInputText}
        onKeyDown={onKeyDown}
        sendButton={sendButton}
        sessionSettingsOpen={sessionSettingsOpen}
        setActiveSessionModel={setActiveSessionModel}
        setSessionSettingsOpen={setSessionSettingsOpen}
        slashMenuEl={slashMenuEl}
        t={t}
        usageStats={usageStats}
      />
    </div>
  );
}
