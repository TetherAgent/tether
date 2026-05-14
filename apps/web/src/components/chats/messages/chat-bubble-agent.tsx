import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import { StreamingCursor } from './streaming-cursor.js';
import { ResultCard } from '../result-card.js';
import { ModelAvatar } from '../model-avatar.js';
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

type GsdChoice = {
  key: string;
  title: string;
  body: string;
};

type GsdQuestion = {
  number: string;
  title: string;
  description: string;
  body: string;
  choices: GsdChoice[];
};

type GsdDiscussion = {
  intro: string;
  questions: GsdQuestion[];
};

const GSD_QUESTION_RE = /^\*\*\[(\d+)\]\s+(.+?)\*\*\s*(?:[—-]\s*(.*))?$/;
const GSD_CHOICE_RE = /^([A-Z])\.\s+\*\*(.+?)\*\*\s*(.*)$/;

function parseGsdDiscussion(text: string): GsdDiscussion | null {
  if (!text.includes('/gsd-discuss-phase') && !text.includes('Phase 19') && !text.includes('需要讨论的')) {
    return null;
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const firstQuestionIndex = lines.findIndex((line) => GSD_QUESTION_RE.test(line.trim()));
  if (firstQuestionIndex < 0) {
    return null;
  }

  const intro = lines.slice(0, firstQuestionIndex).join('\n').trim();
  const questions: GsdQuestion[] = [];
  let index = firstQuestionIndex;

  while (index < lines.length) {
    const header = lines[index].trim();
    const match = GSD_QUESTION_RE.exec(header);
    if (!match) {
      index += 1;
      continue;
    }

    const [, number, title, description = ''] = match;
    index += 1;
    const block: string[] = [];
    while (index < lines.length && !GSD_QUESTION_RE.test(lines[index].trim())) {
      const line = lines[index];
      if (line.trim() !== '---') {
        block.push(line);
      }
      index += 1;
    }

    const bodyLines: string[] = [];
    const choices: GsdChoice[] = [];
    let activeChoice: GsdChoice | null = null;

    for (const line of block) {
      const choiceMatch = GSD_CHOICE_RE.exec(line.trim());
      if (choiceMatch) {
        const [, key, choiceTitle, rest = ''] = choiceMatch;
        activeChoice = {
          key,
          title: choiceTitle,
          body: rest.trim()
        };
        choices.push(activeChoice);
        continue;
      }
      if (activeChoice) {
        activeChoice.body = `${activeChoice.body}${activeChoice.body && line.trim() ? '\n' : ''}${line}`.trim();
      } else {
        bodyLines.push(line);
      }
    }

    questions.push({
      number,
      title: title.trim(),
      description: description.trim(),
      body: bodyLines.join('\n').trim(),
      choices
    });
  }

  return questions.length > 0 ? { intro, questions } : null;
}

function GsdDiscussionView({
  discussion,
  components,
  onChoiceClick
}: {
  discussion: GsdDiscussion;
  components: Components;
  onChoiceClick?: (text: string) => void;
}) {
  const makeChoiceText = React.useCallback((question: GsdQuestion, choice: GsdChoice) => {
    const body = choice.body.trim();
    return `${question.number}:${choice.key}${choice.title}${body ? `\n${body}` : ''}`;
  }, []);

  return (
    <div className="gsd-discussion">
      {discussion.intro ? (
        <div className="gsd-discussion-intro">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={components}
          >
            {discussion.intro}
          </ReactMarkdown>
        </div>
      ) : null}
      <div className="gsd-question-list">
        {discussion.questions.map((question) => (
          <section className="gsd-question-card" key={question.number}>
            <div className="gsd-question-head">
              <span className="gsd-question-index">[{question.number}]</span>
              <div className="gsd-question-title">
                <h3>{question.title}</h3>
                {question.description ? <p>{question.description}</p> : null}
              </div>
            </div>
            {question.body ? (
              <div className="gsd-question-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={components}
                >
                  {question.body}
                </ReactMarkdown>
              </div>
            ) : null}
            {question.choices.length > 0 ? (
              <div className="gsd-choice-grid">
                {question.choices.map((choice) => (
                  <button
                    className="gsd-choice-card"
                    key={choice.key}
                    type="button"
                    title="点击填入输入框"
                    onClick={() => onChoiceClick?.(makeChoiceText(question, choice))}
                  >
                    <div className="gsd-choice-label">{choice.key}</div>
                    <div className="gsd-choice-content">
                      <strong>{choice.title}</strong>
                      {choice.body ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeHighlight]}
                          components={components}
                        >
                          {choice.body}
                        </ReactMarkdown>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
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
  onCommandClick,
  onChoiceClick
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
  onChoiceClick?: (text: string) => void;
}) {
  const renderText = isStreaming ? closeUnclosedFence(text) : text;
  const components = React.useMemo(() => createMdComponents(onCommandClick), [onCommandClick]);
  const gsdDiscussion = React.useMemo(() => (isStreaming ? null : parseGsdDiscussion(text)), [isStreaming, text]);
  return (
    <div className="flex min-w-0 max-w-full items-start gap-3 overflow-hidden">
      <ModelAvatar provider={provider} label={provider} />
      <div className="min-w-0 max-w-[calc(100%-44px)] pb-0.5 lg:max-w-[92%] 2xl:max-w-[88%]">
        <div className="min-w-0 max-w-full overflow-hidden rounded-3xl rounded-bl-md bg-[var(--agent-bubble)] px-4 py-3 text-sm shadow-sm">
          {isWaiting ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <ThinkingDots />
            </div>
          ) : (
            <div className="chat-markdown prose prose-sm dark:prose-invert min-w-0 max-w-full overflow-x-auto">
              {gsdDiscussion ? (
                <GsdDiscussionView
                  discussion={gsdDiscussion}
                  components={components}
                  onChoiceClick={onChoiceClick}
                />
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={components}
                >
                  {renderText}
                </ReactMarkdown>
              )}
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
