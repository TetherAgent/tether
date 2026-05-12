import path from 'node:path';
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import type { AuthScopePayload } from '@tether/core';
import { createSessionEvent } from './events.js';
import { maskSensitiveOutput } from './mask.js';
import type { Session, SessionEvent, SessionStatus } from './types.js';

export type CreatePtySessionOptions = {
  id: string;
  provider: string;
  command: string;
  providerArgs?: string[];
  projectPath: string;
  title?: string;
  cols: number;
  rows: number;
  owner?: Pick<AuthScopePayload, 'accountId' | 'userId' | 'deviceId' | 'gatewayId'>;
};

export type PtyInputOptions = {
  clientId: string;
  data: string;
};

type EventListener = (event: SessionEvent) => void;

export const MAX_TERMINAL_COLS = 500;
export const MAX_TERMINAL_ROWS = 200;

export function isValidTerminalSize(cols: unknown, rows: unknown): cols is number {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    Number(cols) > 0 &&
    Number(rows) > 0 &&
    Number(cols) <= MAX_TERMINAL_COLS &&
    Number(rows) <= MAX_TERMINAL_ROWS
  );
}

type LivePtySession = {
  session: Session;
  pty?: IPty;
  outputBuffer: string[];
  outputTimer?: NodeJS.Timeout;
};

export class PtySessionManager {
  private readonly sessions = new Map<string, LivePtySession>();
  private readonly restoredSessions = new Map<string, Session>();
  private readonly listeners = new Map<string, Set<EventListener>>();

  create(options: CreatePtySessionOptions): Session {
    const title = options.title ?? path.basename(options.projectPath);
    const providerArgs = options.providerArgs ?? [];
    const term = pty.spawn(options.command, providerArgs, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.projectPath,
      env: process.env
    });
    const now = Date.now();
    const session: Session = {
      id: options.id,
      provider: options.provider,
      title,
      projectPath: options.projectPath,
      accountId: options.owner?.accountId,
      userId: options.owner?.userId,
      deviceId: options.owner?.deviceId,
      gatewayId: options.owner?.gatewayId,
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: options.command,
      pid: term.pid,
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    };
    const live: LivePtySession = { session, pty: term, outputBuffer: [] };
    this.restoredSessions.delete(session.id);
    this.sessions.set(session.id, live);
    this.publishEvent(
      createSessionEvent(session.id, 'session.started', {
        provider: options.provider,
        command: options.command,
        providerArgs,
        projectPath: options.projectPath,
        pid: term.pid,
        cols: options.cols,
        rows: options.rows
      })
    );

    term.onData((data) => {
      this.bufferOutput(session.id, data);
    });

    term.onExit(({ exitCode, signal }) => {
      this.flushOutput(session.id);
      const status = exitCode === 0 ? 'completed' : 'failed';
      live.session.status = status;
      live.session.updatedAt = Date.now();
      live.session.lastActiveAt = live.session.updatedAt;
      live.pty = undefined;
      this.publishEvent(
        createSessionEvent(session.id, 'session.exited', {
          exitCode,
          signal
        })
      );
    });

    return session;
  }

  hasLiveSession(id: string): boolean {
    return this.sessions.get(id)?.pty !== undefined;
  }

  isRestoredSession(id: string): boolean {
    return this.restoredSessions.has(id) && !this.sessions.has(id);
  }

  liveSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  write(sessionId: string, options: PtyInputOptions): boolean {
    const live = this.sessions.get(sessionId);
    if (!live?.pty) {
      return false;
    }
    this.publishEvent(
      createSessionEvent(sessionId, 'user.input', {
        clientId: options.clientId,
        data: maskSensitiveOutput(options.data),
        encoding: 'utf8'
      })
    );
    live.pty.write(options.data);
    live.session.updatedAt = Date.now();
    live.session.lastActiveAt = live.session.updatedAt;
    return true;
  }

  resize(sessionId: string, clientId: string, cols: number, rows: number): boolean {
    if (!isValidTerminalSize(cols, rows)) {
      return false;
    }
    const live = this.sessions.get(sessionId);
    if (!live?.pty) {
      return false;
    }
    live.pty.resize(cols, rows);
    this.publishEvent(
      createSessionEvent(sessionId, 'terminal.resize', {
        clientId,
        cols,
        rows
      })
    );
    return true;
  }

  stop(sessionId: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live?.pty) {
      return false;
    }
    live.pty.kill();
    return true;
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    let listeners = this.listeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publishEvent(event: SessionEvent): void {
    this.publish(event);
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id)?.session ?? this.restoredSessions.get(id);
  }

  listSessions(): Session[] {
    const result = new Map<string, Session>();
    for (const [id, session] of this.restoredSessions) {
      result.set(id, session);
    }
    for (const [id, live] of this.sessions) {
      result.set(id, live.session);
    }
    return [...result.values()];
  }

  updateSessionStatus(id: string, status: SessionStatus): void {
    const live = this.sessions.get(id);
    if (live) {
      live.session.status = status;
      live.session.updatedAt = Date.now();
      return;
    }
    const restored = this.restoredSessions.get(id);
    if (!restored) {
      return;
    }
    restored.status = status;
    restored.updatedAt = Date.now();
  }

  restoreSession(
    session: Partial<Session> & Pick<Session, 'id' | 'provider' | 'title' | 'projectPath' | 'status' | 'transport' | 'lastActiveAt'>
  ): Session {
    const existing = this.sessions.get(session.id)?.session;
    if (existing) {
      return existing;
    }
    const lastActiveAt = session.lastActiveAt;
    const restored: Session = {
      id: session.id,
      provider: session.provider,
      title: session.title,
      projectPath: session.projectPath,
      accountId: session.accountId,
      userId: session.userId,
      deviceId: session.deviceId,
      gatewayId: session.gatewayId,
      status: session.status,
      attachState: session.attachState ?? 'detached',
      tmuxSessionName: session.tmuxSessionName ?? '',
      command: session.command ?? '',
      pid: session.pid,
      runnerSocketPath: session.runnerSocketPath,
      transport: session.transport,
      createdAt: session.createdAt ?? lastActiveAt,
      updatedAt: session.updatedAt ?? lastActiveAt,
      lastActiveAt
    };
    this.restoredSessions.set(restored.id, restored);
    return restored;
  }

  private publish(event: SessionEvent): void {
    const listeners = this.listeners.get(event.sessionId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }

  private bufferOutput(sessionId: string, data: string): void {
    const live = this.sessions.get(sessionId);
    if (!live) {
      return;
    }
    live.outputBuffer.push(data);
    if (live.outputBuffer.join('').length >= 16_384) {
      this.flushOutput(sessionId);
      return;
    }
    if (!live.outputTimer) {
      live.outputTimer = setTimeout(() => this.flushOutput(sessionId), 16);
      live.outputTimer.unref();
    }
  }

  private flushOutput(sessionId: string): void {
    const live = this.sessions.get(sessionId);
    if (!live || live.outputBuffer.length === 0) {
      return;
    }
    if (live.outputTimer) {
      clearTimeout(live.outputTimer);
      live.outputTimer = undefined;
    }
    const masked = maskSensitiveOutput(live.outputBuffer.join(''));
    live.outputBuffer = [];
    const event = createSessionEvent(sessionId, 'terminal.output', {
      data: masked,
      encoding: 'utf8'
    });
    this.publishEvent(event);
    live.session.updatedAt = Date.now();
    live.session.lastActiveAt = live.session.updatedAt;
  }
}
