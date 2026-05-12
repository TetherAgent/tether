import type { TrustedChatSessionMetadata } from '@tether/protocol';
import type { Session } from '../types.js';

export class ChatSessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private readonly inFlight = new Set<string>();

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  upsertFromMetadata(metadata: TrustedChatSessionMetadata): Session {
    const now = Date.now();
    const existing = this.sessions.get(metadata.id);
    const session: Session = {
      id: metadata.id,
      provider: metadata.provider,
      title: metadata.title ?? metadata.provider,
      projectPath: metadata.projectPath,
      accountId: metadata.accountId,
      userId: metadata.userId,
      gatewayId: metadata.gatewayId,
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: metadata.provider,
      transport: 'chat',
      agentSessionId: metadata.agentSessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastActiveAt: now
    };
    this.sessions.set(metadata.id, session);
    return session;
  }

  isInFlight(sessionId: string): boolean {
    return this.inFlight.has(sessionId);
  }

  markInFlight(sessionId: string): void {
    this.inFlight.add(sessionId);
  }

  releaseInFlight(sessionId: string): void {
    this.inFlight.delete(sessionId);
  }

  updateAgentSessionId(sessionId: string, agentSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.agentSessionId = agentSessionId;
    session.updatedAt = Date.now();
    session.lastActiveAt = session.updatedAt;
  }
}
