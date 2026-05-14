import * as React from 'react';
import type { MessageItem } from '../model/chat-types.js';
import { ChatBubbleAgent } from '../messages/chat-bubble-agent.js';
import { ChatBubbleUser } from '../messages/chat-bubble-user.js';
import { PermissionPrompt } from '../messages/permission-prompt.js';
import { SystemMessage } from '../messages/system-message.js';
import { ToolCard } from '../messages/tool-card.js';

export function ChatMessageList({
  lastAgentIndex,
  messageEndRef,
  messageScrollRef,
  messages,
  onChoiceClick,
  onCommandClick,
  onPermissionResponse,
  onSuggestionClick
}: {
  lastAgentIndex: number;
  messageEndRef: React.RefObject<HTMLDivElement | null>;
  messageScrollRef: React.RefObject<HTMLDivElement | null>;
  messages: MessageItem[];
  onChoiceClick: (text: string) => void;
  onCommandClick: (text: string) => void;
  onPermissionResponse: (requestId: string, decision: 'allow' | 'deny') => void;
  onSuggestionClick: (text: string) => void;
}) {
  return (
    <div ref={messageScrollRef} className="flex-1 overflow-y-auto px-4 py-5">
      <div className="mx-auto w-full max-w-5xl space-y-4 2xl:max-w-6xl">
        {messages.map((message, index) => {
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
                nextSuggestions={index === lastAgentIndex ? message.nextSuggestions : undefined}
                onSuggestionClick={onSuggestionClick}
                onCommandClick={onCommandClick}
                onChoiceClick={onChoiceClick}
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
            return (
              <PermissionPrompt
                key={message.id}
                toolName={message.toolName}
                requestId={message.requestId}
                onAllow={(id) => onPermissionResponse(id, 'allow')}
                onDeny={(id) => onPermissionResponse(id, 'deny')}
                decided={message.decided}
              />
            );
          }
          return <SystemMessage key={message.id} text={message.text} />;
        })}
        <div ref={messageEndRef} aria-hidden="true" />
      </div>
    </div>
  );
}
