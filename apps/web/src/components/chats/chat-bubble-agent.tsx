import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { StreamingCursor } from './streaming-cursor.js';
import { ResultCard } from './result-card.js';
import { ModelAvatar } from './model-avatar.js';
import { ThinkingDots } from './thinking-dots.js';

function closeUnclosedFence(text: string): string {
  return ((text.match(/^```/gm) ?? []).length % 2 === 1) ? `${text}\n\`\`\`` : text;
}

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
      <div className="max-w-[80%]">
        <div className="rounded-3xl rounded-bl-md bg-[var(--agent-bubble)] px-4 py-3 text-sm shadow-sm">
          {isWaiting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <ThinkingDots />
            </div>
          ) : (
            <div className="chat-markdown prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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
