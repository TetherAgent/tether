import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
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

const RELAY_URL_KEY = 'tether:relayUrl';
const DEFAULT_RELAY_URL = import.meta.env.VITE_TETHER_RELAY_URL ?? 'wss://tether.earntools.me';
const DEFAULT_PROVIDER_OPTIONS: ProviderOption[] = [
  { provider: 'claude', models: ['sonnet', 'opus'] }
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
  const [wsReady, setWsReady] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  const currentAgentIdRef = React.useRef<string | null>(null);
  const inflightStartedAtRef = React.useRef<number>(0);
  const skipNextHistoryLoadSessionIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setCurrentSessionId(activeSessionId);
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setIsInflight(false);
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
        setCurrentSessionId(frame.sessionId);
        navigate(`/chats/${frame.sessionId}`, { replace: true });
        setMessages((items) => [...items, { kind: 'system', id: `started-${frame.sessionId}`, text: t.chatsSessionStarted }]);
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

  return (
    <div className="chat-surface flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{currentSessionId ?? t.chatsStartTitle}</div>
          <div className="text-xs text-muted-foreground">{currentSessionId ? t.chatsSessionResumed : t.chatsStartBody}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
        <div className="w-40">
          <Select value={selectedProvider} onValueChange={(value) => {
            setSelectedProvider(value);
            setSelectedModel(providerOptions.find((provider) => provider.provider === value)?.models[0] ?? '');
          }}>
            <SelectTrigger><SelectValue placeholder={t.chatsSelectProvider} /></SelectTrigger>
            <SelectContent>
              {providerOptions.map((provider) => (
                <SelectItem key={provider.provider} value={provider.provider}>{provider.provider}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger><SelectValue placeholder={t.chatsSelectModel} /></SelectTrigger>
            <SelectContent>
              {(providerOptions.find((provider) => provider.provider === selectedProvider)?.models ?? []).map((model) => (
                <SelectItem key={model} value={model}>{model}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder={t.chatsCwd} className="min-w-60 flex-1" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="text-lg font-semibold">{t.chatsStartTitle}</div>
            <div className="max-w-sm text-sm text-muted-foreground">{t.chatsStartBody}</div>
          </div>
        ) : (
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
        )}
      </div>
      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 text-xs text-muted-foreground">{t.chatsCwdNote}</div>
        <div className="flex items-end gap-3">
          <Textarea
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder={t.chatsInputPlaceholder.replace('{model}', selectedModel || selectedProvider)}
            disabled={isInflight}
            className="min-h-20 max-h-30 resize-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <Button onClick={sendMessage} disabled={isInflight || inputText.trim().length === 0}>
            {isInflight ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {isInflight ? t.chatsSending : t.chatsSend}
          </Button>
        </div>
      </div>
    </div>
  );
}
