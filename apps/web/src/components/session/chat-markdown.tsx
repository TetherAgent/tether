import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

import { useI18n } from '../../hooks/use-i18n.js';

type ChatMarkdownProps = {
  content: string;
};

const REHYPE_HIGHLIGHT_OPTIONS = {
  detect: true,
  ignoreMissing: true,
  subset: [
    'typescript',
    'tsx',
    'javascript',
    'jsx',
    'json',
    'bash',
    'shell',
    'sh',
    'python',
    'go',
    'rust',
    'java',
    'kotlin',
    'swift',
    'ruby',
    'php',
    'css',
    'scss',
    'html',
    'xml',
    'yaml',
    'toml',
    'sql',
    'markdown',
    'diff',
    'dockerfile',
    'plaintext'
  ]
};

function getCodeText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(getCodeText).join('');
  if (
    node &&
    typeof node === 'object' &&
    'props' in node &&
    (node as { props?: { children?: unknown } }).props
  ) {
    return getCodeText((node as { props: { children: unknown } }).props.children);
  }
  return '';
}

function ChatCodeBlock({ language, children }: { language: string | null; children: React.ReactNode }) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const preRef = React.useRef<HTMLPreElement>(null);
  const handleCopy = React.useCallback(() => {
    const text = preRef.current?.innerText ?? getCodeText(children);
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [children]);
  return (
    <div className="chat-md-codeblock">
      {language ? (
        <div className="chat-md-codeblock-head">
          <span className="chat-md-codeblock-lang">{language}</span>
          <button
            type="button"
            className={`chat-md-codeblock-copy${copied ? ' chat-md-codeblock-copy-ok' : ''}`}
            onClick={handleCopy}
            title={copied ? t.chatCodeCopied : t.chatCodeCopy}
            aria-label={copied ? t.chatCodeCopied : t.chatCodeCopy}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>{copied ? t.chatCodeCopied : t.chatCodeCopy}</span>
          </button>
        </div>
      ) : null}
      <pre ref={preRef} className={`chat-md-pre${language ? ` language-${language}` : ''}`}>
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  a({ href, children, ...props }) {
    const isExternal = typeof href === 'string' && /^https?:/i.test(href);
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="chat-md-link"
        {...props}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...rest }) {
    const match = /language-([\w-]+)/.exec(className ?? '');
    if (!match) {
      return (
        <code className="chat-md-inline" {...rest}>
          {children}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
  pre({ children }) {
    if (
      React.isValidElement(children) &&
      children.type === 'code'
    ) {
      const codeProps = children.props as { className?: string; children?: React.ReactNode };
      const match = /language-([\w-]+)/.exec(codeProps.className ?? '');
      const language = match ? match[1] : null;
      return <ChatCodeBlock language={language}>{children}</ChatCodeBlock>;
    }
    return <pre className="chat-md-pre">{children}</pre>;
  },
  table({ children, ...props }) {
    return (
      <div className="chat-md-table-wrap">
        <table className="chat-md-table" {...props}>
          {children}
        </table>
      </div>
    );
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote className="chat-md-quote" {...props}>
        {children}
      </blockquote>
    );
  },
  img({ src, alt, ...props }) {
    return <img className="chat-md-img" src={src} alt={alt ?? ''} loading="lazy" {...props} />;
  }
};

function ChatMarkdownInner({ content }: ChatMarkdownProps) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, REHYPE_HIGHLIGHT_OPTIONS]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMarkdown = React.memo(ChatMarkdownInner);
