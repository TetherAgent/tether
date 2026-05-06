import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import type { AuthScopePayload, ProviderName } from '@tether/core';
import { JournalWatcher } from './journal-watcher.js';
import { maskSensitiveOutput } from './mask.js';
import { isValidTerminalSize } from './pty.js';
import { Store, type Session, type SessionEvent } from './store.js';

export const RUNNER_MAX_FRAME_BYTES = 1024 * 1024;
export const RUNNER_HEARTBEAT_INTERVAL_MS = 10_000;

export type RunnerRequest =
  | { id: string; type: 'ping' }
  | { id: string; type: 'write'; data: string; clientId: string }
  | { id: string; type: 'resize'; cols: number; rows: number; clientId: string }
  | { id: string; type: 'stop'; reason?: string }
  | { id: string; type: 'subscribeEvents'; after?: number }
  | { id: string; type: 'unsubscribeEvents' };

export type RunnerResponse =
  | { id: string; ok: true; result?: Record<string, unknown> }
  | { id: string; ok: false; error: RunnerErrorCode; message?: string };

export type RunnerEventFrame = {
  type: 'event';
  eventId: number;
  sessionId: string;
};

export type RunnerFrame = RunnerResponse | RunnerEventFrame;

export type RunnerErrorCode =
  | 'bad_frame'
  | 'frame_too_large'
  | 'unknown_request'
  | 'session_not_running'
  | 'invalid_resize'
  | 'write_failed'
  | 'subscribe_queue_full'
  | 'internal_error';

export type CreateSessionRunnerOptions = {
  id: string;
  provider: ProviderName;
  command: string;
  providerArgs?: string[];
  providerEnv?: Record<string, string>;
  projectPath: string;
  title?: string;
  cols: number;
  rows: number;
  socketDir?: string;
  owner?: Pick<AuthScopePayload, 'accountId' | 'workspaceId' | 'userId' | 'deviceId' | 'gatewayId'>;
};

type RunnerClientConnection = {
  socket: net.Socket;
  subscribed: boolean;
};

export class SessionRunner {
  private server?: net.Server;
  private term?: IPty;
  private heartbeat?: NodeJS.Timeout;
  private exited = false;
  private journalWatcher?: JournalWatcher;
  private readonly clients = new Set<RunnerClientConnection>();
  readonly socketPath: string;

  constructor(private readonly store: Store, private readonly options: CreateSessionRunnerOptions) {
    this.socketPath = runnerSocketPath(options.id, options.socketDir);
  }

  async start(): Promise<Session> {
    ensureSafeRunnerSocket(this.options.id, this.socketPath);
    const providerArgs = this.options.providerArgs ?? [];
    // Snapshot BEFORE spawn so the diff can detect the new session file (Codex/Copilot).
    const preSpawnSnapshot = snapshotAgentDir(this.options.provider, this.options.projectPath);
    const term = pty.spawn(this.options.command, providerArgs, {
      name: 'xterm-256color',
      cols: this.options.cols,
      rows: this.options.rows,
      cwd: this.options.projectPath,
      env: this.options.providerEnv ? { ...process.env, ...this.options.providerEnv } : process.env
    });
    this.term = term;
    const now = Date.now();
    const session: Session = {
      id: this.options.id,
      provider: this.options.provider,
      title: this.options.title ?? path.basename(this.options.projectPath),
      projectPath: this.options.projectPath,
      accountId: this.options.owner?.accountId,
      workspaceId: this.options.owner?.workspaceId,
      userId: this.options.owner?.userId,
      deviceId: this.options.owner?.deviceId,
      gatewayId: this.options.owner?.gatewayId,
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: this.options.command,
      pid: term.pid,
      runnerPid: process.pid,
      runnerSocketPath: this.socketPath,
      runnerStartedAt: now,
      runnerLastHeartbeatAt: now,
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    };
    this.store.insertSession(session);
    pollAgentSessionId(
      this.options.provider,
      this.options.projectPath,
      term.pid,
      preSpawnSnapshot,
      () => this.exited || Boolean(this.store.getSession(this.options.id)?.agentSessionId)
    )
      .then((agentSessionId) => {
        if (agentSessionId) {
          this.store.updateAgentSessionId(this.options.id, agentSessionId);
          this.journalWatcher = new JournalWatcher(
            this.options.id,
            this.options.provider,
            agentSessionId,
            this.options.projectPath,
            this.store,
            (event) => this.publishEvent(event)
          );
          this.journalWatcher.start();
        }
      })
      .catch(() => { /* detection failure is non-fatal */ });
    this.publishEvent(
      this.store.appendEvent(session.id, 'session.started', {
        provider: this.options.provider,
        command: this.options.command,
        providerArgs,
        projectPath: this.options.projectPath,
        pid: term.pid,
        cols: this.options.cols,
        rows: this.options.rows
      })
    );
    this.publishEvent(
      this.store.appendEvent(session.id, 'runner.started', {
        pid: process.pid,
        socketPath: this.socketPath
      })
    );

    term.onData((data) => {
      const event = this.store.appendEvent(session.id, 'terminal.output', {
        data: maskSensitiveOutput(data),
        encoding: 'utf8'
      });
      this.store.touchSession(session.id);
      this.publishEvent(event);
    });

    term.onExit(({ exitCode, signal }) => {
      this.handleTermExit(session.id, exitCode, signal);
    });

    this.server = net.createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
    this.heartbeat = setInterval(() => {
      const heartbeatAt = Date.now();
      this.store.touchRunnerHeartbeat(session.id, heartbeatAt);
      this.publishEvent(this.store.appendEvent(session.id, 'runner.heartbeat', { pid: process.pid }, heartbeatAt));
    }, RUNNER_HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
    return session;
  }

  async close(): Promise<void> {
    if (this.term && !this.exited) {
      this.term.kill();
    }
    await this.closeServer();
  }

  private handleConnection(socket: net.Socket): void {
    const client: RunnerClientConnection = { socket, subscribed: false };
    this.clients.add(client);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > RUNNER_MAX_FRAME_BYTES) {
        sendFrame(socket, { id: '', ok: false, error: 'frame_too_large', message: 'runner frame is too large' });
        socket.destroy();
        return;
      }
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const raw = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        this.handleRawRequest(client, raw);
        newlineIndex = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => {
      this.clients.delete(client);
    });
  }

  private handleRawRequest(client: RunnerClientConnection, raw: string): void {
    const request = parseRunnerRequest(raw);
    if (!request) {
      sendFrame(client.socket, { id: '', ok: false, error: 'bad_frame', message: 'invalid runner request' });
      return;
    }
    this.handleRequest(client, request);
  }

  private handleRequest(client: RunnerClientConnection, request: RunnerRequest): void {
    if (request.type === 'ping') {
      sendFrame(client.socket, {
        id: request.id,
        ok: true,
        result: { sessionId: this.options.id, pid: process.pid, providerPid: this.term?.pid ?? null }
      });
      return;
    }
    if (request.type === 'subscribeEvents') {
      client.subscribed = true;
      sendFrame(client.socket, { id: request.id, ok: true, result: { sessionId: this.options.id } });
      return;
    }
    if (request.type === 'unsubscribeEvents') {
      client.subscribed = false;
      sendFrame(client.socket, { id: request.id, ok: true, result: { sessionId: this.options.id } });
      return;
    }
    if (!this.term || this.exited) {
      sendFrame(client.socket, {
        id: request.id,
        ok: false,
        error: 'session_not_running',
        message: 'session runner no longer has a live PTY'
      });
      return;
    }
    if (request.type === 'write') {
      const event = this.store.appendEvent(this.options.id, 'user.input', {
        clientId: request.clientId,
        data: maskSensitiveOutput(request.data),
        encoding: 'utf8'
      });
      this.publishEvent(event);
      this.term.write(request.data);
      this.store.touchSession(this.options.id);
      sendFrame(client.socket, { id: request.id, ok: true, result: { sessionId: this.options.id } });
      return;
    }
    if (request.type === 'resize') {
      if (!isValidTerminalSize(request.cols, request.rows)) {
        sendFrame(client.socket, { id: request.id, ok: false, error: 'invalid_resize', message: 'invalid terminal size' });
        return;
      }
      this.term.resize(request.cols, request.rows);
      this.publishEvent(this.store.appendEvent(this.options.id, 'terminal.resize', {
        clientId: request.clientId,
        cols: request.cols,
        rows: request.rows
      }));
      sendFrame(client.socket, { id: request.id, ok: true, result: { sessionId: this.options.id } });
      return;
    }
    if (request.type === 'stop') {
      sendFrame(client.socket, { id: request.id, ok: true, result: { sessionId: this.options.id } });
      setImmediate(() => this.term?.kill());
      return;
    }
  }

  private handleTermExit(sessionId: string, exitCode: number, signal?: number): void {
    if (this.exited) {
      return;
    }
    this.exited = true;
    this.journalWatcher?.stop();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.store.updateSessionStatus(sessionId, exitCode === 0 ? 'completed' : 'failed');
    this.publishEvent(this.store.appendEvent(sessionId, 'session.exited', { exitCode, signal }));
    this.publishEvent(this.store.appendEvent(sessionId, 'runner.exited', { pid: process.pid, exitCode, signal }));
    this.closeServer().catch(() => undefined);
  }

  private async closeServer(): Promise<void> {
    this.journalWatcher?.stop();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    for (const client of this.clients) {
      client.socket.destroy();
    }
    this.clients.clear();
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    unlinkSocketIfPresent(this.socketPath);
  }

  private publishEvent(event: SessionEvent): void {
    const frame: RunnerEventFrame = { type: 'event', eventId: event.id, sessionId: event.sessionId };
    for (const client of this.clients) {
      if (client.subscribed && client.socket.writable) {
        sendFrame(client.socket, frame);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Agent session ID detection (spawn-before/after directory diff)
// ---------------------------------------------------------------------------

const DETECT_POLL_INTERVAL_MS = 500;
const DETECT_MAX_POLLS = 20; // 10 seconds total

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codexSessionsDir(home = os.homedir()): string {
  return path.join(home, '.codex', 'sessions');
}

function listCodexSessionFiles(home = os.homedir()): string[] {
  const base = codexSessionsDir(home);
  const files: string[] = [];
  try {
    for (const year of readdirSync(base)) {
      const yearDir = path.join(base, year);
      if (!statSync(yearDir).isDirectory()) continue;
      for (const month of readdirSync(yearDir)) {
        const monthDir = path.join(yearDir, month);
        if (!statSync(monthDir).isDirectory()) continue;
        for (const day of readdirSync(monthDir)) {
          const dayDir = path.join(monthDir, day);
          if (!statSync(dayDir).isDirectory()) continue;
          for (const file of readdirSync(dayDir)) {
            if (file.endsWith('.jsonl')) {
              files.push(path.join(dayDir, file));
            }
          }
        }
      }
    }
  } catch { /* Codex sessions dir may not exist yet */ }
  return files;
}

export function readCodexSessionId(filePath: string): string | undefined {
  try {
    const firstLine = readFileSync(filePath, 'utf8').split('\n').find((line) => line.trim());
    if (!firstLine) return undefined;
    const entry = JSON.parse(firstLine) as { type?: string; payload?: { id?: string } };
    if (entry.type === 'session_meta' && typeof entry.payload?.id === 'string') {
      return entry.payload.id;
    }
  } catch { /* Fall back to filename parsing below */ }

  const match = path.basename(filePath).match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1];
}

export function latestNewCodexSessionId(before: Set<string>, home = os.homedir()): string | undefined {
  const newFiles = listCodexSessionFiles(home)
    .filter((file) => !before.has(`codex-file:${file}`))
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const { file } of newFiles) {
    const id = readCodexSessionId(file);
    if (id) return id;
  }

  return undefined;
}

// Call this BEFORE pty.spawn() to capture a snapshot of existing session files.
function snapshotAgentDir(provider: ProviderName, projectPath: string): Set<string> {
  const home = os.homedir();
  try {
    if (provider === 'claude' || provider === 'claude-proxy') {
      const encoded = projectPath.replaceAll('/', '-');
      const dir = path.join(home, '.claude', 'projects', encoded);
      return new Set(readdirSync(dir).filter((f) => f.endsWith('.jsonl')));
    }
    if (provider === 'codex' || provider === 'codex-proxy') {
      const indexPath = path.join(home, '.codex', 'session_index.jsonl');
      const snapshot = new Set(listCodexSessionFiles(home).map((file) => `codex-file:${file}`));
      try {
        const lines = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
        snapshot.add(`codex-index-count:${lines.length}`);
      } catch { /* session_index.jsonl is legacy and may be stale or absent */ }
      return snapshot;
    }
    if (provider === 'copilot') {
      const dir = path.join(home, '.copilot', 'session-state');
      return new Set(readdirSync(dir));
    }
  } catch { /* dir/file may not exist yet */ }
  return new Set();
}

// Call this AFTER pty.spawn() with the snapshot taken before spawn.
async function pollAgentSessionId(
  provider: ProviderName,
  projectPath: string,
  pid: number,
  before: Set<string>,
  shouldStop?: () => boolean
): Promise<string | undefined> {
  const home = os.homedir();
  const shouldContinue = (attempt: number) =>
    shouldStop ? !shouldStop() : attempt < DETECT_MAX_POLLS;

  if (provider === 'claude' || provider === 'claude-proxy') {
    // Claude writes ~/.claude/sessions/<pid>.json on startup — much more reliable than JSONL files.
    const sessionFile = path.join(home, '.claude', 'sessions', `${pid}.json`);
    for (let i = 0; shouldContinue(i); i++) {
      await sleep(DETECT_POLL_INTERVAL_MS);
      try {
        const data = JSON.parse(readFileSync(sessionFile, 'utf8')) as { sessionId?: string };
        if (data.sessionId) return data.sessionId;
      } catch { /* file not yet written */ }
    }
    return undefined;
  }

  if (provider === 'codex' || provider === 'codex-proxy') {
    const indexPath = path.join(home, '.codex', 'session_index.jsonl');
    const beforeIndexEntry = [...before].find((entry) => entry.startsWith('codex-index-count:'));
    const beforeCount = Number(beforeIndexEntry?.slice('codex-index-count:'.length) ?? 0);
    for (let i = 0; shouldContinue(i); i++) {
      await sleep(DETECT_POLL_INTERVAL_MS);
      const sessionId = latestNewCodexSessionId(before, home);
      if (sessionId) {
        return sessionId;
      }
      try {
        const lines = readFileSync(indexPath, 'utf8').split('\n').filter(Boolean);
        if (lines.length > beforeCount) {
          const obj = JSON.parse(lines[lines.length - 1]) as { id?: string };
          if (obj.id) return obj.id;
        }
      } catch { /* file may not exist yet */ }
    }
    return undefined;
  }

  if (provider === 'copilot') {
    const dir = path.join(home, '.copilot', 'session-state');
    for (let i = 0; shouldContinue(i); i++) {
      await sleep(DETECT_POLL_INTERVAL_MS);
      try {
        for (const f of readdirSync(dir)) {
          if (!before.has(f)) return f;
        }
      } catch { /* dir may not exist yet */ }
    }
    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------

export function runnerSocketPath(sessionId: string, socketDir = defaultRunnerSocketDir()): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`invalid runner session id: ${sessionId}`);
  }
  return path.resolve(socketDir, `${sessionId}.sock`);
}

export function defaultRunnerSocketDir(): string {
  return path.join(os.homedir(), '.tether', 'sessions');
}

export function isSafeSessionId(sessionId: string): boolean {
  return /^tth_[A-Za-z0-9_-]+$/.test(sessionId);
}

function ensureSafeRunnerSocket(sessionId: string, socketPath: string): void {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`invalid runner session id: ${sessionId}`);
  }
  const dir = path.dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (path.resolve(socketPath) !== path.join(path.resolve(dir), `${sessionId}.sock`)) {
    throw new Error('runner socket path must be derived from session id');
  }
  unlinkSocketIfPresent(socketPath);
}

function unlinkSocketIfPresent(socketPath: string): void {
  try {
    const stat = lstatSync(socketPath);
    if (!stat.isSocket()) {
      throw new Error(`refusing to unlink non-socket runner path: ${socketPath}`);
    }
    unlinkSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function parseRunnerRequest(raw: string): RunnerRequest | undefined {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.id !== 'string' || value.id.length === 0 || typeof value.type !== 'string') {
      return undefined;
    }
    if (value.type === 'ping' || value.type === 'unsubscribeEvents') {
      return { id: value.id, type: value.type };
    }
    if (value.type === 'write' && typeof value.data === 'string' && typeof value.clientId === 'string') {
      return { id: value.id, type: 'write', data: value.data, clientId: value.clientId };
    }
    if (
      value.type === 'resize' &&
      typeof value.cols === 'number' &&
      typeof value.rows === 'number' &&
      typeof value.clientId === 'string'
    ) {
      return { id: value.id, type: 'resize', cols: value.cols, rows: value.rows, clientId: value.clientId };
    }
    if (value.type === 'stop') {
      return { id: value.id, type: 'stop', reason: typeof value.reason === 'string' ? value.reason : undefined };
    }
    if (value.type === 'subscribeEvents') {
      return { id: value.id, type: 'subscribeEvents', after: typeof value.after === 'number' ? value.after : undefined };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sendFrame(socket: net.Socket, frame: RunnerFrame): void {
  if (socket.writable) {
    socket.write(`${JSON.stringify(frame)}\n`);
  }
}
