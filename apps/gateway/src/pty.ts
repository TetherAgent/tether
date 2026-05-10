import path from 'node:path';
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import type { AuthScopePayload } from '@tether/core';
import { maskSensitiveOutput } from './mask.js';
import type { Session, SessionEvent } from './store.js';
import { Store } from './store.js';

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
  pty: IPty;
  outputBuffer: string[];
  outputTimer?: NodeJS.Timeout;
};

export class PtySessionManager {
  private readonly sessions = new Map<string, LivePtySession>();
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(private readonly store: Store) {}

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
    this.store.insertSession(session);
    const live: LivePtySession = { session, pty: term, outputBuffer: [] };
    this.sessions.set(session.id, live);
    this.publish(
      this.store.appendEvent(session.id, 'session.started', {
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
      this.store.updateSessionStatus(session.id, status);
      this.publish(
        this.store.appendEvent(session.id, 'session.exited', {
          exitCode,
          signal
        })
      );
      this.sessions.delete(session.id);
    });

    return session;
  }

  hasLiveSession(id: string): boolean {
    return this.sessions.has(id);
  }

  liveSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  write(sessionId: string, options: PtyInputOptions): boolean {
    const live = this.sessions.get(sessionId);
    if (!live) {
      return false;
    }
    this.publish(
      this.store.appendEvent(sessionId, 'user.input', {
        clientId: options.clientId,
        data: maskSensitiveOutput(options.data),
        encoding: 'utf8'
      })
    );
    live.pty.write(options.data);
    this.store.touchSession(sessionId);
    return true;
  }

  resize(sessionId: string, clientId: string, cols: number, rows: number): boolean {
    if (!isValidTerminalSize(cols, rows)) {
      return false;
    }
    const live = this.sessions.get(sessionId);
    if (!live) {
      return false;
    }
    live.pty.resize(cols, rows);
    this.publish(
      this.store.appendEvent(sessionId, 'terminal.resize', {
        clientId,
        cols,
        rows
      })
    );
    return true;
  }

  stop(sessionId: string): boolean {
    const live = this.sessions.get(sessionId);
    if (!live) {
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
    const event = this.store.appendEvent(sessionId, 'terminal.output', {
      data: masked,
      encoding: 'utf8'
    });
    this.publish(event);
    this.store.touchSession(sessionId);
  }
}
