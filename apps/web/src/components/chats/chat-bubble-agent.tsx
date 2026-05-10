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

const mdComponents: Components = {
  pre({ children }) {
    const code = React.Children.toArray(children).find(
      (c): c is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
        React.isValidElement(c) && (c as React.ReactElement).type === 'code'
    );
    if (!code) return <pre>{children}</pre>;
    return <CodeBlock className={code.props.className}>{code.props.children}</CodeBlock>;
  }
};

export function ChatBubbleAgent({
  text,
  isStreaming,
  isWaiting,
  isLost,
  provider,
  usage,
  durationMs
}: {
  text: string;
  isStreaming: boolean;
  isWaiting?: boolean;
  isLost?: boolean;
  provider?: string;
  usage?: { input_tokens: number; output_tokens: number; cost_usd?: number };
  durationMs?: number;
}) {
  const renderText = isStreaming ? closeUnclosedFence(text) : text;
  return (
    <div className="flex items-start gap-3">
      <ModelAvatar provider={provider} label={provider} />
      <div className="min-w-0 max-w-[80%]">
        <div className="rounded-3xl rounded-bl-md bg-[var(--agent-bubble)] px-4 py-3 text-sm shadow-sm">
          {isWaiting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <ThinkingDots />
            </div>
          ) : (
            <div className="chat-markdown prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={mdComponents}
              >
                {renderText}
              </ReactMarkdown>
              {isStreaming ? <StreamingCursor /> : null}
            </div>
          )}
        </div>
        {isLost ? <div className="mt-2 text-xs text-destructive">Reply lost</div> : null}
        {usage ? <ResultCard usage={usage} durationMs={durationMs} /> : null}
      </div>
    </div>
  );
}
