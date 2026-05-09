import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ProviderName } from '@tether/core';

export type SessionStatus = 'running' | 'stopped' | 'completed' | 'failed' | 'lost';
export type AttachState = 'attached' | 'detached';
export type SessionTransport = 'tmux' | 'pty-event-stream';

export type Session = {
  id: string;
  provider: ProviderName;
  title: string;
  projectPath: string;
  accountId?: string;
  workspaceId?: string;
  userId?: string;
  deviceId?: string;
  gatewayId?: string;
  status: SessionStatus;
  attachState: AttachState;
  tmuxSessionName: string;
  command: string;
  pid?: number;
  runnerPid?: number;
  runnerSocketPath?: string;
  runnerStartedAt?: number;
  runnerLastHeartbeatAt?: number;
  transport: SessionTransport;
  agentSessionId?: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
};

export type SessionEventType =
  | 'session.started'
  | 'session.exited'
  | 'session.error'
  | 'terminal.output'
  | 'terminal.theme.detected'
  | 'user.input'
  | 'client.attached'
  | 'client.detached'
  | 'terminal.resize'
  | 'runner.started'
  | 'runner.heartbeat'
  | 'runner.exited'
  | 'client.control_changed'
  | 'approval.requested'
  | 'diff.detected'
  | 'agent.handoff'
  | 'agent.typing'
  | 'agent.status'
  | 'agent.turn'
  | 'agent.select';

export type SessionEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  id: number;
  sessionId: string;
  type: SessionEventType;
  ts: number;
  payload: TPayload;
};

export type AgentTurn = {
  id: number;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string;
  tools: unknown[];
  createdAt: number;
};

type SessionRow = {
  id: string;
  provider: ProviderName;
  title: string;
  project_path: string;
  account_id?: string | null;
  workspace_id?: string | null;
  user_id?: string | null;
  device_id?: string | null;
  gateway_id?: string | null;
  status: SessionStatus;
  attach_state?: AttachState;
  tmux_session_name: string;
  command: string;
  pid?: number | null;
  runner_pid?: number | null;
  runner_socket_path?: string | null;
  runner_started_at?: number | null;
  runner_last_heartbeat_at?: number | null;
  transport?: SessionTransport;
  agent_session_id?: string | null;
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
  private readonly db: DatabaseSync;

  constructor(readonly dbPath = defaultDbPath()) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        title TEXT,
        project_path TEXT,
        account_id TEXT,
        workspace_id TEXT,
        user_id TEXT,
        device_id TEXT,
        gateway_id TEXT,
        status TEXT NOT NULL,
        tmux_session_name TEXT NOT NULL,
        command TEXT NOT NULL,
        runner_pid INTEGER,
        runner_socket_path TEXT,
        runner_started_at INTEGER,
        runner_last_heartbeat_at INTEGER,
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
          id, provider, title, project_path, account_id, workspace_id, user_id, device_id, gateway_id, status, attach_state, tmux_session_name,
          command, pid, runner_pid, runner_socket_path, runner_started_at, runner_last_heartbeat_at, transport,
          created_at, updated_at, last_active_at
        ) VALUES (
          @id, @provider, @title, @project_path, @account_id, @workspace_id, @user_id, @device_id, @gateway_id, @status, @attach_state, @tmux_session_name,
          @command, @pid, @runner_pid, @runner_socket_path, @runner_started_at, @runner_last_heartbeat_at, @transport,
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

  updateRunnerMetadata(
    id: string,
    metadata: {
      runnerPid?: number;
      runnerSocketPath?: string;
      runnerStartedAt?: number;
      runnerLastHeartbeatAt?: number;
    },
    now = Date.now()
  ): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET runner_pid = ?,
             runner_socket_path = ?,
             runner_started_at = ?,
             runner_last_heartbeat_at = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        metadata.runnerPid ?? null,
        metadata.runnerSocketPath ?? null,
        metadata.runnerStartedAt ?? null,
        metadata.runnerLastHeartbeatAt ?? null,
        now,
        id
      );
  }

  touchRunnerHeartbeat(id: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE sessions SET runner_last_heartbeat_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, id);
  }

  markRunningPtySessionsLost(liveSessionIds: Iterable<string>, now = Date.now()): string[] {
    const live = new Set(liveSessionIds);
    const sessions = this.listSessions().filter(
      (session) => session.transport === 'pty-event-stream' && session.status === 'running' && !live.has(session.id)
    );
    const update = this.db.prepare('UPDATE sessions SET status = ?, attach_state = ?, updated_at = ? WHERE id = ?');
    for (const session of sessions) {
      update.run('lost', 'detached', now, session.id);
    }
    return sessions.map((session) => session.id);
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
    let normalizedPayload = payload;
    if (
      type === 'agent.turn' &&
      typeof payload.turnIndex === 'number' &&
      payload.turnIndex === 0
    ) {
      normalizedPayload = {
        ...payload,
        turnIndex: Number(result.lastInsertRowid)
      };
      this.db
        .prepare('UPDATE session_events SET payload_json = ? WHERE id = ?')
        .run(JSON.stringify(normalizedPayload), Number(result.lastInsertRowid));
    }
    return {
      id: Number(result.lastInsertRowid),
      sessionId,
      type,
      ts,
      payload: normalizedPayload
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
    return rows.map(eventFromRow).filter((event): event is SessionEvent => event !== null);
  }

  listAgentTurns(sessionId: string): AgentTurn[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM session_events
         WHERE session_id = ? AND type = 'agent.turn'
         ORDER BY id ASC`
      )
      .all(sessionId) as SessionEventRow[];
    return rows.flatMap((row) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        return [];
      }
      const role = payload.role;
      const content = payload.content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return [];
      }
      return [{
        id: row.id,
        sessionId: row.session_id,
        turnIndex: typeof payload.turnIndex === 'number' ? payload.turnIndex : row.id,
        role,
        content,
        tools: Array.isArray(payload.tools) ? payload.tools : [],
        createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : row.ts
      }];
    });
  }

  listRecentEvents(sessionId: string, limit = 500): SessionEvent[] {
    const safeLimit = Math.min(Math.max(limit, 1), 5000);
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM session_events
           WHERE session_id = ?
           ORDER BY id DESC
           LIMIT ?
         )
         ORDER BY id ASC`
      )
      .all(sessionId, safeLimit) as SessionEventRow[];
    return rows.map(eventFromRow).filter((event): event is SessionEvent => event !== null);
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
    if (!columns.has('account_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN account_id TEXT');
    }
    if (!columns.has('workspace_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN workspace_id TEXT');
    }
    if (!columns.has('user_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT');
    }
    if (!columns.has('device_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN device_id TEXT');
    }
    if (!columns.has('gateway_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN gateway_id TEXT');
    }
    if (!columns.has('runner_pid')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN runner_pid INTEGER');
    }
    if (!columns.has('runner_socket_path')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN runner_socket_path TEXT');
    }
    if (!columns.has('runner_started_at')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN runner_started_at INTEGER');
    }
    if (!columns.has('runner_last_heartbeat_at')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN runner_last_heartbeat_at INTEGER');
    }
    if (!columns.has('agent_session_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN agent_session_id TEXT');
    }
  }

  updateAgentSessionId(id: string, agentSessionId: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE sessions SET agent_session_id = ?, updated_at = ? WHERE id = ?')
      .run(agentSessionId, now, id);
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
    accountId: row.account_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    userId: row.user_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    gatewayId: row.gateway_id ?? undefined,
    status: row.status,
    attachState: row.attach_state ?? 'detached',
    tmuxSessionName: row.tmux_session_name,
    command: row.command,
    pid: row.pid ?? undefined,
    runnerPid: row.runner_pid ?? undefined,
    runnerSocketPath: row.runner_socket_path ?? undefined,
    runnerStartedAt: row.runner_started_at ?? undefined,
    runnerLastHeartbeatAt: row.runner_last_heartbeat_at ?? undefined,
    transport: row.transport ?? 'tmux',
    agentSessionId: row.agent_session_id ?? undefined,
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
    account_id: session.accountId ?? null,
    workspace_id: session.workspaceId ?? null,
    user_id: session.userId ?? null,
    device_id: session.deviceId ?? null,
    gateway_id: session.gatewayId ?? null,
    status: session.status,
    attach_state: session.attachState,
    tmux_session_name: session.tmuxSessionName,
    command: session.command,
    pid: session.pid ?? null,
    runner_pid: session.runnerPid ?? null,
    runner_socket_path: session.runnerSocketPath ?? null,
    runner_started_at: session.runnerStartedAt ?? null,
    runner_last_heartbeat_at: session.runnerLastHeartbeatAt ?? null,
    transport: session.transport,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_active_at: session.lastActiveAt
  };
}

function eventFromRow(row: SessionEventRow): SessionEvent | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    ts: row.ts,
    payload
  };
}
