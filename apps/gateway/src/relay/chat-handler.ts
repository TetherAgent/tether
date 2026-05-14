import type { RelayServerToGatewayFrame } from '@tether/protocol';
import type { IChatRunner } from '../chat/chat-session-runner.js';
import type { ChatSessionRegistry } from '../chat/chat-session-registry.js';
import { directorySuggestions, listChatProviders } from '../chat/provider-registry.js';
import type { RelaySender } from './relay-sender.js';
import type { SessionCatalog } from './session-catalog.js';
import type { SubscriptionManager } from './subscription-manager.js';

type ChatFrame = Extract<RelayServerToGatewayFrame, { type: 'client.chat' }>;
type PermissionResponseFrame = Extract<RelayServerToGatewayFrame, { type: 'client.permission_response' }>;

export type ChatHandlerOptions = {
  chatRegistry: ChatSessionRegistry;
  relaySender: RelaySender;
  sessionCatalog: SessionCatalog;
  subscriptions: SubscriptionManager;
  runnerForProvider: (provider: string) => IChatRunner | undefined;
  sendError: (clientId: string, sessionId: string, code: string, message: string) => void;
};

export class ChatHandler {
  constructor(private readonly options: ChatHandlerOptions) {}

  handleChat(frame: ChatFrame): void {
    if (frame.sessionId === null) {
      const runner = this.options.runnerForProvider(frame.provider);
      if (!runner) {
        this.options.relaySender.error(frame.clientId, '', 'provider_not_supported', `provider is not supported: ${frame.provider}`);
        return;
      }
      void runner.run({
        clientId: frame.clientId,
        sessionId: null,
        provider: frame.provider,
        model: frame.model,
        cwd: frame.cwd,
        message: frame.message,
        accountId: frame.accountId,
        userId: frame.userId,
        clientRequestId: frame.clientRequestId
      });
      return;
    }
    if (this.options.chatRegistry.isInFlight(frame.sessionId)) {
      this.options.sendError(frame.clientId, frame.sessionId, 'chat_in_progress', '当前会话正在回复中');
      return;
    }
    if (!frame.session) {
      this.options.relaySender.error(frame.clientId, frame.sessionId, 'missing_session_metadata', 'trusted session metadata is missing from relay frame');
      return;
    }
    this.options.chatRegistry.upsertFromMetadata(frame.session);
    const runner = this.options.runnerForProvider(frame.session.provider);
    if (!runner) {
      this.options.relaySender.error(frame.clientId, frame.sessionId, 'provider_not_supported', `provider is not supported: ${frame.session.provider}`);
      return;
    }
    this.options.chatRegistry.markInFlight(frame.sessionId);
    void runner.run({
      clientId: frame.clientId,
      sessionId: frame.sessionId,
      message: frame.message,
      model: frame.model,
      session: frame.session,
      clientRequestId: frame.clientRequestId
    }).catch((err: unknown) => {
      this.options.chatRegistry.releaseInFlight(frame.sessionId);
      this.options.sendError(frame.clientId, frame.sessionId, 'chat_runner_failed', String(err));
    });
  }

  async sendProviders(clientId: string): Promise<void> {
    this.sendChatEvent(0, '', 'gateway.providers', { clientId, providers: await listChatProviders() });
  }

  async sendCwdSuggestions(clientId: string, cwd: string): Promise<void> {
    this.sendChatEvent(0, '', 'gateway.cwd-suggestions', {
      clientId,
      cwd,
      suggestions: await directorySuggestions(cwd)
    });
  }

  handleSwitchModel(clientId: string, sessionId: string): void {
    this.options.relaySender.error(clientId, sessionId, 'switch_not_implemented', '模型切换功能将在后续版本中实现');
  }

  handlePermissionResponse(frame: PermissionResponseFrame): void {
    if (!this.options.subscriptions.get(frame.clientId, frame.sessionId)) {
      this.options.sendError(frame.clientId, frame.sessionId, 'not_subscribed', 'client is not subscribed to this session');
      return;
    }
    const session = this.options.sessionCatalog.get(frame.sessionId);
    if (!session) {
      this.options.sendError(frame.clientId, frame.sessionId, 'session_not_found', 'session not found');
      return;
    }
    this.options.runnerForProvider(session.provider)?.respondToPermission(frame.sessionId, frame.requestId, frame.decision);
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
