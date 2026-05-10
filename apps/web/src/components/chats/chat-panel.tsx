import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Check, Copy, Loader2, PanelLeftOpen } from 'lucide-react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@tether/design';
import { createHttpClient } from '@tether/http';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { getStoredNormalAccessToken } from '../../lib/api.js';
import { ChatBubbleAgent } from './chat-bubble-agent.js';
import { ChatBubbleUser } from './chat-bubble-user.js';
import { SystemMessage } from './system-message.js';
import { ToolCard } from './tool-card.js';
import { PermissionPrompt } from './permission-prompt.js';

type Usage = { input_tokens: number; output_tokens: number; cost_usd?: number };
type MessageItem =
  | { kind: 'user'; id: string; content: string; ts: number }
  | { kind: 'agent'; id: string; text: string; isStreaming: boolean; isWaiting: boolean; isLost: boolean; provider: string; usage?: Usage; durationMs?: number }
  | { kind: 'tool'; id: string; toolName: string; input: Record<string, unknown>; result?: string; isError: boolean; isInFlight: boolean }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'permission'; id: string; toolName: string };
type HistoryMessage = { role: string; content: string; usageJson?: Usage; createdAt: string };
type ProviderOption = { provider: string; models: string[] };
type ChatSessionRecord = { id: string; provider?: string; agentSessionId?: string };

const RELAY_URL_KEY = 'tether:relayUrl';
const DEFAULT_RELAY_URL = import.meta.env.VITE_TETHER_RELAY_URL ?? 'wss://tether.earntools.me';
const DEFAULT_PROVIDER_OPTIONS: ProviderOption[] = [
  { provider: 'claude', models: ['sonnet', 'opus', 'haiku'] }
];

function buildRelayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws/client`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function frameFromRaw(raw: MessageEvent['data']): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.type === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

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

export function ChatPanel({ activeSessionId, onExpandSidebar }: { activeSessionId?: string; onExpandSidebar?: () => void }) {
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
  const [cwd, setCwd] = React.useState('');
  const [cwdSuggestions, setCwdSuggestions] = React.useState<string[]>([]);
  const [cwdSuggestionsOpen, setCwdSuggestionsOpen] = React.useState(false);
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(undefined);
  const [wsReady, setWsReady] = React.useState(false);
  const [copiedAgentId, setCopiedAgentId] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  const currentAgentIdRef = React.useRef<string | null>(null);
  const inflightStartedAtRef = React.useRef<number>(0);
  const cwdRef = React.useRef(cwd);
  const skipNextHistoryLoadSessionIdRef = React.useRef<string | null>(null);
  const pendingSessionProviderRef = React.useRef<string | undefined>(undefined);
  const pendingSessionModelRef = React.useRef<string | undefined>(undefined);
  const createdSessionIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  React.useEffect(() => {
    setCurrentSessionId(activeSessionId);
    setAgentSessionId(undefined);
    if (activeSessionId && activeSessionId === createdSessionIdRef.current) {
      setActiveSessionProvider(pendingSessionProviderRef.current);
      setActiveSessionModel(pendingSessionModelRef.current);
      createdSessionIdRef.current = null;
    } else {
      setActiveSessionProvider(undefined);
      setActiveSessionModel(undefined);
    }
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setIsInflight(false);
      setAgentSessionId(undefined);
      return;
    }
    if (skipNextHistoryLoadSessionIdRef.current === activeSessionId) {
      skipNextHistoryLoadSessionIdRef.current = null;
      return;
    }
    const token = normalAuth?.accessToken ?? getStoredNormalAccessToken();
    const http = createHttpClient();
    void http
      .get<{ messages: HistoryMessage[] }>(
        `/api/server/chat-sessions/${activeSessionId}/messages`,
        undefined,
        { token }
      )
      .then((data: { messages: HistoryMessage[] }) => {
        const items: MessageItem[] = (data.messages ?? []).map((message: HistoryMessage, index: number) =>
          message.role === 'user'
            ? { kind: 'user', id: `history-user-${index}`, content: message.content, ts: Date.parse(message.createdAt) }
            : {
                kind: 'agent',
                id: `history-agent-${index}`,
                text: message.content,
                isStreaming: false,
                isWaiting: false,
                isLost: false,
                provider: activeSessionProvider ?? 'agent',
                usage: message.usageJson
              }
        );
        if (items.at(-1)?.kind === 'user') {
          items.push({
            kind: 'agent',
            id: 'history-waiting',
            text: '',
            isStreaming: false,
            isWaiting: true,
            isLost: false,
            provider: activeSessionProvider ?? 'agent'
          });
          currentAgentIdRef.current = 'history-waiting';
          setIsInflight(true);
        } else {
          currentAgentIdRef.current = null;
          setIsInflight(false);
        }
        setMessages(items);
      })
      .catch(() => {
        setMessages([{ kind: 'system', id: 'history-error', text: t.chatsHistoryFail }]);
      });
  }, [activeSessionId, activeSessionProvider, normalAuth?.accessToken, t.chatsHistoryFail]);

  React.useEffect(() => {
    const token = normalAuth?.accessToken ?? getStoredNormalAccessToken();
    if (!activeSessionId || !token) {
      return;
    }
    const http = createHttpClient();
    void http
      .get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, {
        token,
        suppressGlobalError: true
      })
      .then((data) => {
        const session = (data.sessions ?? []).find((item) => item.id === activeSessionId);
        setAgentSessionId(session?.agentSessionId);
        setActiveSessionProvider(session?.provider);
        setActiveSessionModel(undefined);
      })
      .catch(() => undefined);
  }, [activeSessionId, normalAuth?.accessToken]);

  React.useEffect(() => {
    if (!normalAuth?.accessToken) {
      return;
    }
    const relayUrl = window.localStorage.getItem(RELAY_URL_KEY) ?? DEFAULT_RELAY_URL;
    const ws = new WebSocket(buildRelayUrl(relayUrl));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: normalAuth.accessToken }));
    };
    ws.onmessage = (event) => {
      const frame = frameFromRaw(event.data);
      if (!frame) return;
      if (frame.type === 'client.auth.ok') {
        setWsReady(true);
        ws.send(JSON.stringify({ type: 'client.list-providers' }));
        return;
      }
      if (frame.type === 'gateway.providers') {
        const nextProviders = Array.isArray(frame.providers)
          ? frame.providers.filter((provider: unknown): provider is ProviderOption => isProviderOption(provider))
          : [];
        if (nextProviders.length > 0) {
          setProviderOptions(nextProviders);
          setSelectedProvider((currentProvider) =>
            nextProviders.some((provider: ProviderOption) => provider.provider === currentProvider)
              ? currentProvider
              : nextProviders[0]!.provider
          );
          setSelectedModel((currentModel) => {
            const provider = nextProviders.find((item: ProviderOption) => item.provider === selectedProvider) ?? nextProviders[0]!;
            return provider.models.includes(currentModel) ? currentModel : provider.models[0]!;
          });
        } else {
          setMessages((items) => [...items, { kind: 'system', id: `providers-${Date.now()}`, text: t.chatsProviderFail }]);
        }
        return;
      }
      if (frame.type === 'gateway.cwd-suggestions') {
        if (typeof frame.cwd === 'string' && frame.cwd === cwdRef.current) {
          const suggestions = Array.isArray(frame.suggestions)
            ? frame.suggestions.filter((item: unknown): item is string => typeof item === 'string')
            : [];
          setCwdSuggestions(suggestions);
          setCwdSuggestionsOpen(suggestions.length > 0);
        }
        return;
      }
      if (frame.type === 'gateway.session-created' && typeof frame.sessionId === 'string') {
        skipNextHistoryLoadSessionIdRef.current = frame.sessionId;
        createdSessionIdRef.current = frame.sessionId;
        setAgentSessionId(undefined);
        setActiveSessionProvider(pendingSessionProviderRef.current);
        setActiveSessionModel(pendingSessionModelRef.current);
        setCurrentSessionId(frame.sessionId);
        navigate(`/chats/${frame.sessionId}`, { replace: true });
        setMessages((items) => [...items, { kind: 'system', id: `started-${frame.sessionId}`, text: t.chatsSessionStarted }]);
        return;
      }
      if (frame.type === 'event' && typeof frame.event === 'object' && frame.event) {
        const relayEvent = frame.event as { sessionId?: unknown; type?: unknown; payload?: unknown };
        if (
          relayEvent.type === 'session.agent-id-updated' &&
          relayEvent.sessionId === currentSessionId &&
          relayEvent.payload &&
          typeof relayEvent.payload === 'object' &&
          typeof (relayEvent.payload as { agentSessionId?: unknown }).agentSessionId === 'string'
        ) {
          setAgentSessionId((relayEvent.payload as { agentSessionId: string }).agentSessionId);
        }
        return;
      }
      if (frame.type === 'gateway.chat-catchup' && typeof frame.text === 'string') {
        const frameText = frame.text;
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
        const frameText = frame.text;
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
            { kind: 'agent', id, text: frameText, isStreaming: true, isWaiting: false, isLost: false, provider: activeSessionProvider ?? 'agent' }
          ];
        });
        return;
      }
      if (frame.type === 'agent.result' && typeof frame.text === 'string') {
        const frameText = frame.text;
        const usage = typeof frame.usage === 'object' && frame.usage && !Array.isArray(frame.usage)
          ? frame.usage as Usage
          : undefined;
        setMessages((items) => {
          const agentId = currentAgentIdRef.current ?? `agent-${Date.now()}`;
          currentAgentIdRef.current = null;
          const replacement: MessageItem = {
            kind: 'agent',
            id: agentId,
            text: frameText,
            isStreaming: false,
            isWaiting: false,
            isLost: false,
            provider: activeSessionProvider ?? 'agent',
            usage,
            durationMs: Date.now() - inflightStartedAtRef.current
          };
          const next: MessageItem[] = items.some((item) => item.kind === 'agent' && item.id === agentId)
            ? items.map((item) =>
                item.kind === 'agent' && item.id === agentId
                  ? { ...item, ...replacement }
                  : item
              )
            : [...items, replacement];
          return next;
        });
        setIsInflight(false);
        return;
      }
      if (frame.type === 'agent.tool' && typeof frame.name === 'string') {
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
      if (frame.type === 'error' && typeof frame.message === 'string') {
        const frameMessage = frame.message;
        if (frame.code === 'session_lost') {
          setMessages((items) =>
            items.map((item) =>
              item.kind === 'agent' && item.id === currentAgentIdRef.current
                ? { ...item, isStreaming: false, isWaiting: false, isLost: true }
                : item
            )
          );
          setIsInflight(false);
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
    };
    ws.onclose = () => {
      setWsReady(false);
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [activeSessionProvider, navigate, normalAuth?.accessToken, selectedProvider, t.chatsProviderFail, t.chatsSessionStarted]);

  React.useEffect(() => {
    if (currentSessionId || !wsReady || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setCwdSuggestions([]);
      setCwdSuggestionsOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      wsRef.current?.send(JSON.stringify({ type: 'client.cwd-suggest', cwd }));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [currentSessionId, cwd, wsReady]);

  React.useEffect(() => {
    const models = providerOptions.find((provider) => provider.provider === selectedProvider)?.models ?? [];
    if (models.length > 0 && !models.includes(selectedModel)) {
      setSelectedModel(models[0]!);
    }
  }, [providerOptions, selectedModel, selectedProvider]);

  React.useEffect(() => {
    if (wsReady && currentSessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'client.subscribe', sessionId: currentSessionId, mode: 'control' }));
    }
  }, [currentSessionId, wsReady]);

  const sendMessage = React.useCallback(() => {
    const text = inputText.trim();
    if (!text || isInflight || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const existingProviderModels = providerOptions.find((provider) => provider.provider === activeSessionProvider)?.models ?? [];
    const messageProvider = currentSessionId ? (activeSessionProvider ?? 'agent') : selectedProvider;
    const messageModel = currentSessionId ? (activeSessionModel ?? existingProviderModels[0]) : selectedModel;
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
      wsRef.current.send(JSON.stringify({ type: 'client.chat', sessionId: currentSessionId, message: text, model: messageModel }));
      return;
    }
    pendingSessionProviderRef.current = selectedProvider;
    pendingSessionModelRef.current = selectedModel;
    wsRef.current.send(
      JSON.stringify({
        type: 'client.chat',
        sessionId: null,
        provider: selectedProvider,
        model: selectedModel,
        cwd,
        message: text
      })
    );
  }, [activeSessionModel, activeSessionProvider, cwd, currentSessionId, inputText, isInflight, providerOptions, selectedModel, selectedProvider]);

  const isNewSession = !currentSessionId && messages.length === 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const canSend = !isInflight && inputText.trim().length > 0;

  const sendButton = (
    <button
      onClick={sendMessage}
      disabled={!canSend}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
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
    <div className="overflow-hidden rounded-2xl border border-border bg-card" style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
      <Textarea
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        placeholder={t.chatsInputPlaceholder.replace('{model}', (withControls ? selectedModel : displayModel) || displayProvider)}
        disabled={isInflight}
        className="max-h-44 min-h-[88px] resize-none rounded-none border-0 bg-transparent px-4 pt-4 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
        onKeyDown={onKeyDown}
      />
      <div className="relative flex items-center gap-2 border-t border-border/50 px-3 py-2.5">
        {withControls && (
          <>
            <Select
              value={selectedProvider}
              onValueChange={(value) => {
                setSelectedProvider(value);
                setSelectedModel(providerOptions.find((p) => p.provider === value)?.models[0] ?? '');
              }}
            >
              <SelectTrigger className="h-7 w-auto gap-1 rounded-full border-0 bg-muted px-3 text-[12px] font-medium shadow-none ring-0 focus:ring-0">
                <SelectValue placeholder={t.chatsSelectProvider} />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>{p.provider}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-7 w-auto gap-1 rounded-full border-0 bg-muted px-3 text-[12px] font-medium shadow-none ring-0 focus:ring-0">
                <SelectValue placeholder={t.chatsSelectModel} />
              </SelectTrigger>
              <SelectContent>
                {(providerOptions.find((p) => p.provider === selectedProvider)?.models ?? []).map((model) => (
                  <SelectItem key={model} value={model}>{model}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={cwd}
              onChange={(event) => {
                setCwd(event.target.value);
                setCwdSuggestionsOpen(true);
              }}
              onFocus={() => {
                setCwdSuggestionsOpen(cwdSuggestions.length > 0);
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'client.cwd-suggest', cwd }));
                }
              }}
              onBlur={() => window.setTimeout(() => setCwdSuggestionsOpen(false), 120)}
              placeholder={t.chatsCwd}
              className="h-7 w-36 rounded-full border-0 bg-muted px-3 text-[12px] shadow-none focus-visible:ring-0"
            />
            {cwdSuggestionsOpen && cwdSuggestions.length > 0 && (
              <div className="absolute left-3 right-12 top-[calc(100%-6px)] z-20 max-h-52 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                {cwdSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCwd(suggestion);
                      setCwdSuggestionsOpen(false);
                    }}
                    className="block w-full truncate rounded-lg px-3 py-1.5 text-left font-mono text-[11px] text-popover-foreground hover:bg-accent"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1" />
          </>
        )}
        {!withControls && (
          <>
            <span className="flex h-7 items-center rounded-full bg-muted px-3 text-[12px] font-medium text-muted-foreground">
              {displayProvider}
            </span>
            {displayProviderModels.length > 0 && displayModel && (
              <Select value={displayModel} onValueChange={setActiveSessionModel}>
                <SelectTrigger className="h-7 w-auto gap-1 rounded-full border-0 bg-muted px-3 text-[12px] font-medium shadow-none ring-0 focus:ring-0">
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
          </>
        )}
        {sendButton}
      </div>
    </div>
  );

  if (isNewSession) {
    return (
      <div className="chat-surface relative flex h-full flex-col items-center justify-center bg-background px-6">
        {onExpandSidebar && (
          <button
            onClick={onExpandSidebar}
            className="absolute left-3 top-3 hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" />
          </button>
        )}
        <div className="mb-10 flex flex-col items-center gap-4">
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

        <div className="w-full max-w-[680px]">
          {inputCard(true)}
          <div className="mt-3 flex items-center justify-center gap-1">
            {!wsReady && (
              <span className="text-[11px] text-muted-foreground/70">{t.gatewayNotConnected} · </span>
            )}
            <span className="text-[11px] text-muted-foreground/70">{t.chatsCwdNote}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-surface flex h-full flex-col bg-background">
      {/* Session header */}
      <div className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur-sm">
        {onExpandSidebar && (
          <button
            onClick={onExpandSidebar}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-[15px] w-[15px]" />
          </button>
        )}
        <div className="flex-1" />
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {displayProvider}
        </span>
        {agentSessionId && (
          <>
            <span className="max-w-[200px] truncate font-mono text-[11px] text-muted-foreground/50">
              {agentSessionId}
            </span>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(agentSessionId);
                setCopiedAgentId(true);
                setTimeout(() => setCopiedAgentId(false), 1500);
              }}
              title={t.copyAgentSessionId}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            >
              {copiedAgentId
                ? <Check className="h-3 w-3 text-brand" />
                : <Copy className="h-3 w-3" />}
            </button>
          </>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.map((message) => {
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
              return <PermissionPrompt key={message.id} toolName={message.toolName} />;
            }
            return <SystemMessage key={message.id} text={message.text} />;
          })}
        </div>
      </div>

      {/* Input */}
      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto max-w-3xl">
          {inputCard(false)}
        </div>
      </div>
    </div>
  );
}
