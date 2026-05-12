import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import { StreamingCursor } from './streaming-cursor.js';
import { ResultCard } from './result-card.js';
import { ModelAvatar } from './model-avatar.js';
import { ThinkingDots } from './thinking-dots.js';

export type ChatNextSuggestion = {
  description: string;
  title?: string;
};

function closeUnclosedFence(text: string): string {
  return ((text.match(/^```/gm) ?? []).length % 2 === 1) ? `${text}\n\`\`\`` : text;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
  const rawText = typeof children === 'string' ? children : String(children ?? '');

  const handleCopy = () => {
    void navigator.clipboard.writeText(rawText.replace(/\n$/, '')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">{lang || 'code'}</span>
        <button className="chat-code-copy" onClick={handleCopy} type="button">
          {copied
            ? <><Check className="h-3 w-3" /> 已复制</>
            : <><Copy className="h-3 w-3" /> 复制</>}
        </button>
      </div>
      <pre className={className}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const COMMAND_RE = /^[$\/][a-z][\w-]/;

function extractText(node: React.ReactNode): string {
  if (!node) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function makeLineClickable(children: React.ReactNode): boolean {
  return COMMAND_RE.test(extractText(children).trimStart());
}

function createMdComponents(onCommandClick?: (text: string) => void): Components {
  return {
    pre({ children }) {
      const code = React.Children.toArray(children).find(
        (c): c is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
          React.isValidElement(c) && (c as React.ReactElement).type === 'code'
      );
      if (!code) return <pre>{children}</pre>;
      return <CodeBlock className={code.props.className}>{code.props.children}</CodeBlock>;
    },
    p({ children }) {
      if (!onCommandClick) return <p>{children}</p>;
      // Split on <br> so each line in a paragraph is independently clickable
      const childArray = React.Children.toArray(children);
      const lines: React.ReactNode[][] = [[]];
      for (const child of childArray) {
        if (React.isValidElement(child) && child.type === 'br') {
          lines.push([]);
        } else {
          lines[lines.length - 1].push(child);
        }
      }
      if (!lines.some(makeLineClickable)) return <p>{children}</p>;
      return (
        <p>
          {lines.map((line, i) =>
            makeLineClickable(line) ? (
              <span
                key={i}
                className="block cursor-pointer rounded transition-colors hover:bg-accent/50"
                title="点击填入输入框"
                onClick={(e) => onCommandClick((e.currentTarget as HTMLElement).innerText.trim())}
              >
                {line}
              </span>
            ) : (
              <span key={i} className="block">{line}</span>
            )
          )}
        </p>
      );
    },
    li({ children }) {
      if (onCommandClick && makeLineClickable(children)) {
        return (
          <li
            className="cursor-pointer rounded transition-colors hover:bg-accent/50"
            title="点击填入输入框"
            onClick={(e) => {
              e.stopPropagation();
              onCommandClick((e.currentTarget as HTMLElement).innerText.trim());
            }}
          >
            {children}
          </li>
        );
      }
      return <li>{children}</li>;
    }
  };
}

export function ChatBubbleAgent({
  text,
  isStreaming,
  isWaiting,
  isLost,
  provider,
  usage,
  durationMs,
  nextSuggestions,
  onSuggestionClick,
  onCommandClick
}: {
  text: string;
  isStreaming: boolean;
  isWaiting?: boolean;
  isLost?: boolean;
  provider?: string;
  usage?: { input_tokens: number; output_tokens: number; cost_usd?: number };
  durationMs?: number;
  nextSuggestions?: ChatNextSuggestion[];
  onSuggestionClick?: (description: string) => void;
  onCommandClick?: (text: string) => void;
}) {
  const renderText = isStreaming ? closeUnclosedFence(text) : text;
  const components = React.useMemo(() => createMdComponents(onCommandClick), [onCommandClick]);
  return (
    <div className="flex min-w-0 max-w-full items-start gap-3 overflow-hidden">
      <ModelAvatar provider={provider} label={provider} />
      <div className="min-w-0 max-w-[calc(100%-44px)] pb-0.5 sm:max-w-[80%]">
        <div className="min-w-0 max-w-full overflow-hidden rounded-3xl rounded-bl-md bg-[var(--agent-bubble)] px-4 py-3 text-sm shadow-sm">
          {isWaiting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <ThinkingDots />
            </div>
          ) : (
            <div className="chat-markdown prose prose-sm dark:prose-invert min-w-0 max-w-full overflow-x-auto">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={components}
              >
                {renderText}
              </ReactMarkdown>
              {isStreaming ? <StreamingCursor /> : null}
            </div>
          )}
          {usage ? <ResultCard usage={usage} durationMs={durationMs} /> : null}
        </div>
        {isLost ? <div className="mt-2 text-xs text-destructive">Reply lost</div> : null}
        {!isStreaming && !isWaiting && nextSuggestions && nextSuggestions.length > 0 ? (
          <div className="mt-3 flex flex-col items-start gap-2">
            {nextSuggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.description}-${index}`}
                type="button"
                className="max-w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-left text-sm text-foreground shadow-sm transition-colors hover:border-muted-foreground/35 hover:bg-muted/50"
                onClick={() => onSuggestionClick?.(suggestion.description)}
              >
                {suggestion.description}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
