import type { ChatSessionRegistry } from './chat-session-registry.js';
import {
  ChatSessionRunner,
  CodexChatRunner,
  CopilotChatRunner,
  type ChatRunnerOptions,
  type IChatRunner
} from './chat-session-runner.js';
import type { RelaySender } from '../relay/relay-sender.js';
import type { ClaudeHudMetricsStore } from './claude-hud-metrics.js';

export type ChatRuntimeOptions = {
  gatewayId: () => string;
  chatRegistry: ChatSessionRegistry;
  relaySender: RelaySender;
  sendSessions: () => void | Promise<void>;
  claudeHudMetrics?: ClaudeHudMetricsStore;
};

export class ChatRuntime {
  private readonly chatRunner: ChatSessionRunner;
  private readonly codexChatRunner: CodexChatRunner;
  private readonly copilotChatRunner: CopilotChatRunner;

  constructor(private readonly options: ChatRuntimeOptions) {
    const runnerOptions: ChatRunnerOptions = {
      gatewayId: options.gatewayId,
      claudeHudMetrics: options.claudeHudMetrics,
      onSessionCreated: (clientId, sessionId) => {
        options.relaySender.sessionCreated(clientId, sessionId);
        void options.sendSessions();
      },
      onChatSessionCreated: (clientId, metadata) => {
        options.chatRegistry.upsertFromMetadata(metadata);
        options.relaySender.chatSessionCreated(clientId, metadata);
      },
      onUserMessage: ({ clientId, sessionId, event }) => {
        this.sendChatEvent(event, {
          clientId,
          message: event.payload.message,
          ...(event.clientRequestId ? { clientRequestId: event.clientRequestId } : {})
        });
      },
      onDelta: ({ clientId, event, text, providerRaw }) => {
        this.sendChatEvent(event, {
          clientId,
          text,
          ...(providerRaw !== undefined ? { providerRaw } : {})
        });
      },
      onResult: ({ clientId, sessionId, event, text, usage, stopReason, contextWindow, rateLimitInfo, contextInputTokens, contextUsedPercentage, nextSuggestions, providerRaw }) => {
        options.chatRegistry.releaseInFlight(sessionId);
        this.sendChatEvent(event, {
          clientId,
          text,
          usage,
          ...(stopReason ? { stop_reason: stopReason } : {}),
          ...(contextWindow !== undefined ? { contextWindow } : {}),
          ...(rateLimitInfo ? { rateLimitInfo } : {}),
          ...(contextInputTokens !== undefined ? { contextInputTokens } : {}),
          ...(contextUsedPercentage !== undefined ? { contextUsedPercentage } : {}),
          ...(nextSuggestions && nextSuggestions.length > 0 ? { nextSuggestions } : {}),
          ...(providerRaw !== undefined ? { providerRaw } : {})
        });
      },
      onPermissionRequest: ({ clientId, sessionId, requestId, toolName, input }) => {
        this.sendLegacyGatewayEvent(Date.now(), sessionId, 'agent.permission_request', {
          clientId,
          requestId,
          toolName,
          input
        });
      },
      onTool: ({ clientId, sessionId, event, name, input, result, isError, providerRaw }) => {
        this.sendChatEvent(event, {
          clientId,
          name,
          input,
          ...(result ? { result } : {}),
          ...(isError !== undefined ? { isError } : {}),
          ...(providerRaw !== undefined ? { providerRaw } : {})
        });
      },
      onError: ({ clientId, sessionId, code, message, event }) => {
        options.chatRegistry.releaseInFlight(sessionId);
        if (event) {
          this.sendChatEvent(event, {
            clientId,
            code,
            message
          });
        }
        options.relaySender.error(clientId, sessionId, code, message);
      },
      onAgentIdUpdate: (sessionId, agentSessionId) => {
        options.chatRegistry.updateAgentSessionId(sessionId, agentSessionId);
        this.sendLegacyGatewayEvent(Date.now(), sessionId, 'session.agent-id-updated', { sessionId, agentSessionId });
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

  private sendChatEvent(event: { id: number; eventSeq?: number; turnId?: string; clientRequestId?: string; sessionId: string; type: string; ts: number }, payload: Record<string, unknown>): void {
    this.options.relaySender.event({
      id: event.eventSeq ?? event.id,
      eventSeq: event.eventSeq ?? event.id,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      ...(event.clientRequestId ? { clientRequestId: event.clientRequestId } : {}),
      sessionId: event.sessionId,
      type: event.type,
      ts: event.ts,
      payload
    });
  }

  private sendLegacyGatewayEvent(id: number, sessionId: string, type: string, payload: Record<string, unknown>): void {
    this.options.relaySender.event({
      id,
      sessionId,
      type,
      ts: Date.now(),
      payload
    });
  }
}
