import type { RelayServerToGatewayFrame } from '@tether/protocol';
import { logger } from '../utils/logger.js';
import { isValidTerminalSize, type PtySessionManager } from '../pty/manager.js';
import type { SessionRunnerClient } from '../pty/session-runner-client.js';
import type { Session } from '../types.js';
import type { RelaySender } from './relay-sender.js';
import type { SessionCatalog } from './session-catalog.js';
import type { SubscriptionManager } from './subscription-manager.js';

export type NewPtySessionHandler = (params: {
  clientId: string;
  provider: string;
  cwd: string;
  cols: number;
  rows: number;
  title?: string;
  providerArgs?: string[];
}) => Promise<{ sessionId: string }>;

type NewPtySessionFrame = Extract<RelayServerToGatewayFrame, { type: 'client.new-pty-session' }>;

export type PtyHandlerOptions = {
  relaySender: RelaySender;
  sessionCatalog: SessionCatalog;
  subscriptions: SubscriptionManager;
  ptySessions?: PtySessionManager;
  runnerClientForSession?: (session: Session) => SessionRunnerClient | undefined;
  onNewPtySession?: NewPtySessionHandler;
  sendSessions: () => void | Promise<void>;
  sendError: (clientId: string, sessionId: string, code: string, message: string) => void;
};

export class PtyHandler {
  constructor(private readonly options: PtyHandlerOptions) {}

  async writeInput(clientId: string, sessionId: string, data: string): Promise<void> {
    const control = this.options.subscriptions.requireControlSession(clientId, sessionId, id => this.options.sessionCatalog.get(id));
    if (!control.ok) {
      this.options.sendError(clientId, sessionId, control.error.code, control.error.message);
      return;
    }
    const runnerClient = this.options.runnerClientForSession?.(control.session);
    if (runnerClient) {
      await runnerClient.write(data, clientId).catch(() => {
        this.markLostAndSendError(clientId, sessionId);
      });
      return;
    }
    const ok = this.options.ptySessions?.write(sessionId, { clientId, data }) ?? false;
    if (!ok) {
      this.markLostAndSendError(clientId, sessionId);
    }
  }

  async resizePty(clientId: string, sessionId: string, cols: number, rows: number): Promise<void> {
    const control = this.options.subscriptions.requireControlSession(clientId, sessionId, id => this.options.sessionCatalog.get(id));
    if (!control.ok) {
      this.options.sendError(clientId, sessionId, control.error.code, control.error.message);
      return;
    }
    if (!isValidTerminalSize(cols, rows)) {
      this.options.sendError(clientId, sessionId, 'bad_resize', 'resize requires positive terminal dimensions');
      return;
    }
    const runnerClient = this.options.runnerClientForSession?.(control.session);
    if (runnerClient) {
      await runnerClient.resize(cols, rows, clientId).catch(() => {
        this.markLostAndSendError(clientId, sessionId);
      });
      return;
    }
    const ok = this.options.ptySessions?.resize(sessionId, clientId, cols, rows) ?? false;
    if (!ok) {
      this.markLostAndSendError(clientId, sessionId);
    }
  }

  async stopPty(clientId: string, sessionId: string): Promise<void> {
    const control = this.options.subscriptions.requireControlSession(clientId, sessionId, id => this.options.sessionCatalog.get(id));
    if (!control.ok) {
      this.options.sendError(clientId, sessionId, control.error.code, control.error.message);
      return;
    }
    const runnerClient = this.options.runnerClientForSession?.(control.session);
    if (runnerClient) {
      await runnerClient.stop('relay-stop').catch(() => {
        this.markLostAndSendError(clientId, sessionId);
      });
      return;
    }
    const ok = this.options.ptySessions?.stop(sessionId) ?? false;
    if (!ok) {
      this.options.sessionCatalog.markSessionLost(sessionId);
      this.options.sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
    }
  }

  handleNewSession(frame: NewPtySessionFrame): void {
    if (!this.options.onNewPtySession) {
      this.options.relaySender.error(frame.clientId, '', 'session_create_not_supported', 'gateway cannot create PTY sessions over relay');
      return;
    }
    void this.options.onNewPtySession({
      clientId: frame.clientId,
      provider: frame.provider,
      cwd: frame.cwd,
      cols: frame.cols,
      rows: frame.rows,
      title: frame.title,
      providerArgs: frame.providerArgs
    }).then(({ sessionId }) => {
      this.options.relaySender.sessionCreated(frame.clientId, sessionId);
      void this.options.sendSessions();
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('pty', 'session create failed', { error: message });
      this.options.relaySender.error(frame.clientId, '', 'session_create_failed', message);
    });
  }

  private markLostAndSendError(clientId: string, sessionId: string): void {
    logger.warn('pty', 'session marked lost', { sessionId });
    this.options.sessionCatalog.markSessionLost(sessionId);
    this.options.sendError(clientId, sessionId, 'session_lost', 'PTY session is no longer running');
  }
}
