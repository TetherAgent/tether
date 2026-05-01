import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { ProviderName } from '@tether/core';

export type SessionStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'lost';
export type AttachState = 'attached' | 'detached';
export type SessionTransport = 'tmux' | 'pty-event-stream';

export type Session = {
  id: string;
  provider: ProviderName;
  title: string;
  projectPath: string;
  status: SessionStatus;
  attachState: AttachState;
  tmuxSessionName: string;
  command: string;
  pid?: number;
  transport: SessionTransport;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
};

export type SessionEventType =
  | 'session.started'
  | 'session.exited'
  | 'session.error'
  | 'terminal.output'
  | 'user.input'
  | 'client.attached'
  | 'client.detached'
  | 'terminal.resize'
  | 'client.control_changed'
  | 'approval.requested'
  | 'diff.detected'
  | 'agent.handoff';

export type SessionEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: number;
  sessionId: string;
  type: SessionEventType;
  ts: number;
  payload: TPayload;
};

type SessionRow = {
  id: string;
  provider: ProviderName;
  title: string;
  project_path: string;
  status: SessionStatus;
  attach_state?: AttachState;
  tmux_session_name: string;
  command: string;
  pid?: number | null;
  transport?: SessionTransport;
  created_at: number;
  updated_at: number;
  last_active_at: number;
};

type SessionEventRow = {
  id: number;
  session_id: string;
  type: SessionEventType;
  ts: number;
  payload_json: string;
};

export class Store {
  private readonly db: Database.Database;

  constructor(dbPath = defaultDbPath()) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        title TEXT,
        project_path TEXT,
        status TEXT NOT NULL,
        tmux_session_name TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_cursor
      ON session_events(session_id, id);
    `);
    this.migrate();
  }

  listSessions(): Session[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY last_active_at DESC')
      .all() as SessionRow[];
    return rows.map(fromRow);
  }

  getSession(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? fromRow(row) : undefined;
  }

  insertSession(session: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, provider, title, project_path, status, attach_state, tmux_session_name,
          command, pid, transport,
          created_at, updated_at, last_active_at
        ) VALUES (
          @id, @provider, @title, @project_path, @status, @attach_state, @tmux_session_name,
          @command, @pid, @transport,
          @created_at, @updated_at, @last_active_at
        )`
      )
      .run(toRow(session));
  }

  touchSession(id: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE sessions SET updated_at = ?, last_active_at = ? WHERE id = ?')
      .run(now, now, id);
  }

  updateSessionStatus(id: string, status: SessionStatus, now = Date.now()): void {
    this.db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }

  updateAttachState(id: string, attachState: AttachState, now = Date.now()): void {
    this.db.prepare('UPDATE sessions SET attach_state = ?, updated_at = ? WHERE id = ?').run(attachState, now, id);
  }

  appendEvent<TPayload extends Record<string, unknown>>(
    sessionId: string,
    type: SessionEventType,
    payload: TPayload,
    ts = Date.now()
  ): SessionEvent<TPayload> {
    const result = this.db
      .prepare(
        `INSERT INTO session_events (session_id, type, ts, payload_json)
         VALUES (?, ?, ?, ?)`
      )
      .run(sessionId, type, ts, JSON.stringify(payload));
    return {
      id: Number(result.lastInsertRowid),
      sessionId,
      type,
      ts,
      payload
    };
  }

  listEvents(sessionId: string, after = 0, limit = 1000): SessionEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), 5000);
    const rows = this.db
      .prepare(
        `SELECT * FROM session_events
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(sessionId, after, safeLimit) as SessionEventRow[];
    return rows.map(eventFromRow);
  }

  latestEventId(sessionId: string): number {
    const row = this.db
      .prepare('SELECT id FROM session_events WHERE session_id = ? ORDER BY id DESC LIMIT 1')
      .get(sessionId) as { id: number } | undefined;
    return row?.id ?? 0;
  }

  transcript(sessionId: string, limit = 1000): string {
    const rows = this.db
      .prepare(
        `SELECT payload_json FROM session_events
         WHERE session_id = ? AND type = 'terminal.output'
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(sessionId, Math.min(Math.max(limit, 1), 5000)) as Array<{ payload_json: string }>;
    return rows
      .reverse()
      .map((row) => {
        const payload = JSON.parse(row.payload_json) as { data?: unknown };
        return typeof payload.data === 'string' ? payload.data : '';
      })
      .join('');
  }

  private migrate(): void {
    const columns = new Set(
      (this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((column) => column.name)
    );
    if (!columns.has('attach_state')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN attach_state TEXT NOT NULL DEFAULT 'detached'");
    }
    if (!columns.has('pid')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN pid INTEGER');
    }
    if (!columns.has('transport')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN transport TEXT NOT NULL DEFAULT 'tmux'");
    }
  }
}

export function defaultDbPath(): string {
  return path.join(os.homedir(), '.tether', 'tether.db');
}

function fromRow(row: SessionRow): Session {
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    projectPath: row.project_path,
    status: row.status,
    attachState: row.attach_state ?? 'detached',
    tmuxSessionName: row.tmux_session_name,
    command: row.command,
    pid: row.pid ?? undefined,
    transport: row.transport ?? 'tmux',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at
  };
}

function toRow(session: Session): SessionRow {
  return {
    id: session.id,
    provider: session.provider,
    title: session.title,
    project_path: session.projectPath,
    status: session.status,
    attach_state: session.attachState,
    tmux_session_name: session.tmuxSessionName,
    command: session.command,
    pid: session.pid ?? null,
    transport: session.transport,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_active_at: session.lastActiveAt
  };
}

function eventFromRow(row: SessionEventRow): SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    ts: row.ts,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>
  };
}
