import type { ChatSessionRegistry } from './chat-session-registry.js';
import {
  ChatSessionRunner,
  CodexChatRunner,
  CopilotChatRunner,
  type ChatRunnerOptions,
  type IChatRunner
} from './chat-session-runner.js';
import type { RelaySender } from '../relay/relay-sender.js';

export type ChatRuntimeOptions = {
  gatewayId: () => string;
  chatRegistry: ChatSessionRegistry;
  relaySender: RelaySender;
  sendSessions: () => void | Promise<void>;
};

export class ChatRuntime {
  private readonly chatRunner: ChatSessionRunner;
  private readonly codexChatRunner: CodexChatRunner;
  private readonly copilotChatRunner: CopilotChatRunner;

  constructor(private readonly options: ChatRuntimeOptions) {
    const runnerOptions: ChatRunnerOptions = {
      gatewayId: options.gatewayId,
      onSessionCreated: (clientId, sessionId) => {
        options.relaySender.sessionCreated(clientId, sessionId);
        void options.sendSessions();
      },
      onChatSessionCreated: (clientId, metadata) => {
        options.chatRegistry.upsertFromMetadata(metadata);
        options.relaySender.chatSessionCreated(clientId, metadata);
      },
      onUserMessage: ({ clientId, sessionId, event }) => {
        this.sendChatEvent(event.id, sessionId, 'user.message', {
          clientId,
          message: event.payload.message
        });
      },
      onDelta: ({ clientId, sessionId, text, deltaEventId }) => {
        this.sendChatEvent(deltaEventId, sessionId, 'agent.delta', { clientId, text });
      },
      onResult: ({ clientId, sessionId, event, text, usage, stopReason, contextWindow, rateLimitInfo, contextInputTokens, nextSuggestions }) => {
        options.chatRegistry.releaseInFlight(sessionId);
        this.sendChatEvent(event.id, sessionId, 'agent.result', {
          clientId,
          text,
          usage,
          ...(stopReason ? { stop_reason: stopReason } : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(rateLimitInfo ? { rateLimitInfo } : {}),
          ...(contextInputTokens !== undefined ? { contextInputTokens } : {}),
          ...(nextSuggestions && nextSuggestions.length > 0 ? { nextSuggestions } : {})
        });
      },
      onPermissionRequest: ({ clientId, sessionId, requestId, toolName, input }) => {
        this.sendChatEvent(Date.now(), sessionId, 'agent.permission_request', {
          clientId,
          requestId,
          toolName,
          input
        });
      },
      onTool: ({ clientId, sessionId, event, name, input, result, isError }) => {
        this.sendChatEvent(event.id, sessionId, 'agent.tool', {
          clientId,
          name,
          input,
          ...(result ? { result } : {}),
          ...(isError !== undefined ? { isError } : {})
        });
      },
      onError: ({ clientId, sessionId, code, message, event }) => {
        options.chatRegistry.releaseInFlight(sessionId);
        if (event) {
          this.sendChatEvent(event.id, sessionId, 'session.error', {
            clientId,
            code,
            message
          });
        }
        options.relaySender.error(clientId, sessionId, code, message);
      },
      onAgentIdUpdate: (sessionId, agentSessionId) => {
        options.chatRegistry.updateAgentSessionId(sessionId, agentSessionId);
        this.sendChatEvent(Date.now(), sessionId, 'session.agent-id-updated', { sessionId, agentSessionId });
      }
    };
    this.chatRunner = new ChatSessionRunner(runnerOptions);
    this.codexChatRunner = new CodexChatRunner(runnerOptions);
    this.copilotChatRunner = new CopilotChatRunner(runnerOptions);
  }

  runnerForProvider(provider: string): IChatRunner | undefined {
    switch (provider) {
      case 'claude':
        return this.chatRunner;
      case 'codex':
        return this.codexChatRunner;
      case 'copilot':
        return this.copilotChatRunner;
      default:
        return undefined;
    }
  }

  private sendChatEvent(id: number, sessionId: string, type: string, payload: Record<string, unknown>): void {
    this.options.relaySender.event({
      id,
      sessionId,
      type,
      ts: Date.now(),
      payload
    });
  }
}
