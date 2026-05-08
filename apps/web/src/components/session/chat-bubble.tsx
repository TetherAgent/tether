import * as React from 'react';
import { Bot, Terminal, X } from 'lucide-react';

import { useI18n } from '../../hooks/use-i18n.js';

export type ChatBubbleStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export type ChatBubbleProps = {
  role: 'user' | 'assistant';
  /** When true, hides the avatar and tightens spacing (same author as previous group). */
  folded?: boolean;
  status?: ChatBubbleStatus;
  /** Provider id (codex / claude / ...) for picking the agent avatar variant. */
  provider?: string;
  /** Identifier or initial for the user avatar fallback. */
  userInitial?: string;
  /** Click handler for retry (only meaningful when status === 'failed'). */
  onRetry?: () => void;
  children: React.ReactNode;
};

function statusTick(status: ChatBubbleStatus | undefined): { glyph: string; tone: 'muted' | 'failed' } | null {
  switch (status) {
    case 'pending':
      return { glyph: '⋯', tone: 'muted' };
    case 'sent':
      return { glyph: '✓', tone: 'muted' };
    case 'failed':
      return { glyph: '!', tone: 'failed' };
    case 'delivered':
    case undefined:
    default:
      return null;
  }
}

function AgentAvatar({ provider }: { provider?: string }) {
  // Provider-specific glyph could be wired here; default to a neutral Bot icon.
  void provider;
  return (
    <div className="chat-avatar chat-avatar-agent" aria-hidden="true">
      <Bot />
    </div>
  );
}

function UserAvatar({ initial }: { initial?: string }) {
  if (initial) {
    return (
      <div className="chat-avatar chat-avatar-user" aria-hidden="true">
        {initial.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <div className="chat-avatar chat-avatar-user" aria-hidden="true">
      <Terminal />
    </div>
  );
}

export function ChatBubble({
  role,
  folded = false,
  status,
  provider,
  userInitial,
  onRetry,
  children
}: ChatBubbleProps) {
  const { t } = useI18n();
  const isUser = role === 'user';
  const tick = isUser ? statusTick(status) : null;
  const dataStatus = isUser ? status ?? 'delivered' : undefined;

  return (
    <div
      className={`chat-row chat-row-${isUser ? 'user' : 'agent'}${folded ? ' chat-row-folded' : ''}`}
      data-status={dataStatus}
    >
      {!isUser ? (
        folded ? (
          <span className="chat-avatar chat-avatar-spacer" aria-hidden="true" />
        ) : (
          <AgentAvatar provider={provider} />
        )
      ) : null}
      <div className="chat-row-bubbles">
        <div
          className={`chat-bubble chat-bubble-${isUser ? 'user' : 'agent'}${
            folded ? ' chat-bubble-folded' : ''
          }`}
          data-status={dataStatus}
        >
          <div className="chat-bubble-content">{children}</div>
        </div>
        {tick ? (
          <span className={`chat-bubble-tick chat-bubble-tick-${tick.tone}`} aria-hidden="true">
            {tick.glyph}
            {status === 'failed' && onRetry ? (
              <button type="button" className="chat-bubble-retry" onClick={onRetry}>
                {t.chatRetry}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {isUser ? (
        folded ? (
          <span className="chat-avatar chat-avatar-spacer" aria-hidden="true" />
        ) : (
          <UserAvatar initial={userInitial} />
        )
      ) : null}
    </div>
  );
}

export type ChatThinkingBubbleProps = {
  folded?: boolean;
  provider?: string;
  onCancel?: () => void;
  mode?: 'thinking' | 'processing' | 'waiting';
};

const CANCEL_VISIBLE_AFTER_S = 5;
const DEEP_THINKING_AFTER_S = 10;
const SHOW_TIMER_AFTER_S = 3;

export function ChatThinkingBubble({ folded = false, provider, onCancel, mode = 'thinking' }: ChatThinkingBubbleProps) {
  const { t } = useI18n();
  const [seconds, setSeconds] = React.useState(0);

  React.useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const text =
    mode === 'processing'
      ? t.chatProcessing
      : mode === 'waiting'
        ? t.chatWaitingStatus
        : seconds < DEEP_THINKING_AFTER_S
          ? t.chatThinking
          : t.chatThinkingDeep;
  const showCancel = mode === 'thinking' && seconds >= CANCEL_VISIBLE_AFTER_S && Boolean(onCancel);

  return (
    <div className={`chat-row chat-row-agent${folded ? ' chat-row-folded' : ''}`}>
      {folded ? (
        <span className="chat-avatar chat-avatar-spacer" aria-hidden="true" />
      ) : (
        <AgentAvatar provider={provider} />
      )}
      <div className="chat-row-bubbles">
        <div className="chat-bubble chat-bubble-agent chat-bubble-thinking">
          <div className="chat-bubble-content">
            <span className="chat-typing-dots" aria-label={t.agentTypingIndicator}>
              <span />
              <span />
              <span />
            </span>
            <span className="chat-thinking-text">{text}</span>
            {seconds >= SHOW_TIMER_AFTER_S ? (
              <span className="chat-thinking-timer">· {seconds}s</span>
            ) : null}
            {showCancel ? (
              <button type="button" className="chat-thinking-cancel" onClick={onCancel}>
                <X aria-hidden="true" />
                <span>{t.chatStopGen}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
