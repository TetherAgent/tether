import type { RelaySession } from '@tether/protocol';
import { createSessionEvent } from '../utils/events.js';
import type { PtySessionManager } from '../pty/manager.js';
import type { SessionRunnerClient } from '../pty/session-runner-client.js';
import type { Session, SessionEvent } from '../types.js';
import type { ChatSessionRegistry } from '../chat/chat-session-registry.js';

export type SessionCatalogOptions = {
  chatRegistry: ChatSessionRegistry;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
  emitEvent: (event: SessionEvent) => void;
  isPidAlive: (pid: number) => boolean;
};

export class SessionCatalog {
  constructor(private readonly options: SessionCatalogOptions) {}

  get(sessionId: string): Session | undefined {
    return this.options.ptySessions?.getSession(sessionId) ?? this.options.chatRegistry.get(sessionId);
  }

  async listRelaySessions(): Promise<Session[]> {
    const ptyList = (this.options.ptySessions?.listSessions() ?? []).filter(s => !this.options.chatRegistry.has(s.id));
    const sessions = [...this.options.chatRegistry.list(), ...ptyList];
    const result: Session[] = [];
    for (const session of sessions) {
      if (session.status === 'lost') {
        continue;
      }
      if (session.transport === 'chat') {
        result.push(session);
        continue;
      }
      if (this.options.ptySessions?.isRestoredSession(session.id)) {
        result.push(session);
        continue;
      }
      if (session.status !== 'running' || session.transport !== 'pty-event-stream') {
        continue;
      }
      const alive = await this.isLiveSession(session);
      if (alive) {
        result.push(session);
        continue;
      }
      this.markSessionLost(session.id);
      const updated = this.get(session.id);
      result.push(updated ?? { ...session, status: 'lost' });
    }
    return result;
  }

  restoreRelaySessions(sessions: RelaySession[]): void {
    for (const relaySession of sessions) {
      const pid = 'pid' in relaySession && typeof relaySession.pid === 'number' ? relaySession.pid : undefined;
      const status = pid ? (this.options.isPidAlive(pid) ? 'running' : 'lost') : relaySession.status;
      this.options.ptySessions?.restoreSession({
        ...relaySession,
        status
      });
    }
  }

  async isLiveSession(session: Session): Promise<boolean> {
    const runnerClient = this.options.runnerClientForSession?.(session);
    if (runnerClient?.ping) {
      try {
        const pong = await runnerClient.ping();
        return pong?.sessionId === session.id;
      } catch {
        return false;
      }
    }
    if (this.options.ptySessions) {
      return this.options.ptySessions.hasLiveSession(session.id);
    }
    return true;
  }

  markSessionLost(sessionId: string): void {
    const session = this.get(sessionId);
    if (session?.status !== 'running') {
      return;
    }
    this.options.ptySessions?.updateSessionStatus(sessionId, 'lost');
    this.options.emitEvent(createSessionEvent(sessionId, 'session.error', {
      code: 'session_lost',
      message: 'Gateway relay client lost the session runner'
    }));
  }
}

export function toRelaySession(session: Session): RelaySession {
  return {
    id: session.id,
    provider: session.provider,
    title: session.title,
    projectPath: session.projectPath,
    accountId: session.accountId,
    gatewayId: undefined,
    userId: session.userId,
    agentSessionId: session.agentSessionId,
    status: session.status,
    transport: session.transport,
    lastActiveAt: session.lastActiveAt
  };
}
