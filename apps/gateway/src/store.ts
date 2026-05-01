import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { ProviderName } from '@tether/core';

export type SessionStatus = 'running' | 'detached' | 'stopped' | 'completed' | 'failed';

export type Session = {
  id: string;
  provider: ProviderName;
  title: string;
  projectPath: string;
  status: SessionStatus;
  tmuxSessionName: string;
  command: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
};

type SessionRow = {
  id: string;
  provider: ProviderName;
  title: string;
  project_path: string;
  status: SessionStatus;
  tmux_session_name: string;
  command: string;
  created_at: number;
  updated_at: number;
  last_active_at: number;
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
    `);
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
          id, provider, title, project_path, status, tmux_session_name, command,
          created_at, updated_at, last_active_at
        ) VALUES (
          @id, @provider, @title, @project_path, @status, @tmux_session_name, @command,
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
    tmuxSessionName: row.tmux_session_name,
    command: row.command,
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
    tmux_session_name: session.tmuxSessionName,
    command: session.command,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_active_at: session.lastActiveAt
  };
}
