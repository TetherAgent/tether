import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Loader2, Send } from 'lucide-react';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@tether/design';
import { createHttpClient } from '@tether/http';
import { useAuth } from '../../hooks/use-auth.js';
import { useI18n } from '../../hooks/use-i18n.js';
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
type ChatSessionRecord = { id: string; agentSessionId?: string };

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

export function ChatPanel({ activeSessionId }: { activeSessionId?: string }) {
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
  const [cwd, setCwd] = React.useState('');
  const [agentSessionId, setAgentSessionId] = React.useState<string | undefined>(undefined);
  const [wsReady, setWsReady] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  const currentAgentIdRef = React.useRef<string | null>(null);
  const inflightStartedAtRef = React.useRef<number>(0);
  const skipNextHistoryLoadSessionIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setCurrentSessionId(activeSessionId);
    setAgentSessionId(undefined);
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
    const http = createHttpClient();
    void http
      .get<{ messages: HistoryMessage[] }>(
        `/api/server/chat-sessions/${activeSessionId}/messages`,
        undefined,
        { token: normalAuth?.accessToken }
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
                provider: selectedProvider,
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
            provider: selectedProvider
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
  }, [activeSessionId, normalAuth?.accessToken, selectedProvider, t.chatsHistoryFail]);

  React.useEffect(() => {
    if (!activeSessionId || !normalAuth?.accessToken) {
      return;
    }
    const http = createHttpClient();
    void http
      .get<{ sessions: ChatSessionRecord[] }>('/api/server/chat-sessions', undefined, {
        token: normalAuth.accessToken,
        suppressGlobalError: true
      })
      .then((data) => {
        const session = (data.sessions ?? []).find((item) => item.id === activeSessionId);
        setAgentSessionId(session?.agentSessionId);
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
      if (frame.type === 'gateway.session-created' && typeof frame.sessionId === 'string') {
        skipNextHistoryLoadSessionIdRef.current = frame.sessionId;
        setAgentSessionId(undefined);
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
            { kind: 'agent', id, text: frameText, isStreaming: true, isWaiting: false, isLost: false, provider: selectedProvider }
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
            provider: selectedProvider,
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
  }, [navigate, normalAuth?.accessToken, selectedProvider, t.chatsProviderFail, t.chatsSessionStarted]);

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
    inflightStartedAtRef.current = Date.now();
    const pendingAgentId = `agent-${Date.now()}`;
    currentAgentIdRef.current = pendingAgentId;
    setMessages((items) => [
      ...items,
      { kind: 'user', id: `user-${Date.now()}`, content: text, ts: Date.now() },
      { kind: 'agent', id: pendingAgentId, text: '', isStreaming: false, isWaiting: true, isLost: false, provider: selectedProvider }
    ]);
    setInputText('');
    setIsInflight(true);
    if (currentSessionId) {
      wsRef.current.send(JSON.stringify({ type: 'client.chat', sessionId: currentSessionId, message: text }));
      return;
    }
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
  }, [cwd, currentSessionId, inputText, isInflight, selectedModel, selectedProvider]);

  const isNewSession = !currentSessionId && messages.length === 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const sendButton = (
    <Button
      onClick={sendMessage}
      disabled={isInflight || inputText.trim().length === 0}
      size="icon"
      className="h-8 w-8 shrink-0 rounded-full"
    >
      {isInflight ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
    </Button>
  );

  if (isNewSession) {
    return (
      <div className="chat-surface flex h-full flex-col items-center justify-center bg-background px-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-bold text-white">
            T
          </div>
          <h1 className="text-2xl font-semibold">{t.chatsWelcomeGreeting}</h1>
        </div>

        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <Textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={t.chatsInputPlaceholder.replace('{model}', selectedModel || selectedProvider)}
            disabled={isInflight}
            className="max-h-40 min-h-[80px] resize-none rounded-none border-0 bg-transparent px-4 pt-4 text-base shadow-none focus-visible:ring-0"
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
            <Select
              value={selectedProvider}
              onValueChange={(value) => {
                setSelectedProvider(value);
                setSelectedModel(providerOptions.find((p) => p.provider === value)?.models[0] ?? '');
              }}
            >
              <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-0 bg-muted px-2 text-xs font-medium shadow-none">
                <SelectValue placeholder={t.chatsSelectProvider} />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>{p.provider}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="h-8 w-auto gap-1 rounded-lg border-0 bg-muted px-2 text-xs font-medium shadow-none">
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
              onChange={(event) => setCwd(event.target.value)}
              placeholder={t.chatsCwd}
              className="h-8 min-w-32 flex-1 rounded-lg border-0 bg-muted text-xs shadow-none"
            />
            {sendButton}
          </div>
        </div>

        {!wsReady && (
          <div className="mt-4 text-xs text-muted-foreground">{t.gatewayNotConnected}</div>
        )}
        <div className="mt-3 text-xs text-muted-foreground">{t.chatsCwdNote}</div>
      </div>
    );
  }

  return (
    <div className="chat-surface flex h-full flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="font-mono text-sm text-muted-foreground">{currentSessionId}</div>
        {currentSessionId && (
          <div className="text-xs text-muted-foreground">{t.chatsSessionResumed}</div>
        )}
        {agentSessionId ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t.chatsAgentSessionId}: <span className="font-mono">{agentSessionId}</span>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
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
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-end gap-3">
          <Textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={t.chatsInputPlaceholder.replace('{model}', selectedModel || selectedProvider)}
            disabled={isInflight}
            className="max-h-40 min-h-20 resize-none"
            onKeyDown={onKeyDown}
          />
          {sendButton}
        </div>
      </div>
    </div>
  );
}
