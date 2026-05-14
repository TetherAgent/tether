import type { ChatHistoryMessage } from './chat-data.js';
import type { Usage } from './chat-types.js';

export type ChatEventSeq = number;
export type ChatTurnId = string;
export type ChatClientRequestId = string;

export type ChatReducerSnapshot = {
  messages: ChatHistoryMessage[];
  sessionId: string;
  snapshotEventSeq: ChatEventSeq;
};

export type ChatStreamEvent =
  | {
      type: 'user.message';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      clientRequestId?: ChatClientRequestId;
      content: string;
      ts?: number;
    }
  | {
      type: 'agent.delta';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      text: string;
      provider: string;
    }
  | {
      type: 'agent.result';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      text: string;
      provider: string;
      usage?: Usage;
    }
  | {
      type: 'session.error';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      message: string;
      provider: string;
    }
  | {
      type: 'agent.tool';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      name: string;
      input: Record<string, unknown>;
      result?: string;
      isError: boolean;
    }
  | {
      type: 'agent.permission_request';
      eventSeq: ChatEventSeq;
      turnId: ChatTurnId;
      requestId: string;
      toolName: string;
    };

export type LegacyChatCatchup = {
  lastEventId?: number;
  sessionId: string;
  text: string;
};

export type ChatClientFailure = {
  clientRequestId?: string;
  code: string;
  message: string;
  sessionId?: string;
};

export type ChatRestoreAttempt = {
  attemptId: string;
  sessionId: string;
  startedAt: number;
};
