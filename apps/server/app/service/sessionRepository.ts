import { Service } from 'egg';

type GatewaySessionRecord = {
  id: string;
  accountId: string;
  gatewayId: string;
  userId?: string;
  provider: string;
  title?: string;
  projectPath?: string;
  agentSessionId?: string;
  status: string;
  transport: string;
  lastActiveAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type AdminSessionRecord = GatewaySessionRecord & { userEmail?: string };

type AdminChatMessageRecord = {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  usageJson: Record<string, unknown>;
  createdAt: number;
};

type AdminRuntimeEventRecord = {
  eventId: number;
  sessionId: string;
  eventType: string;
  payloadJson: Record<string, unknown>;
  createdAt: number;
};

type AdminChatEventRecord = {
  id: number;
  sessionId: string;
  eventId: number;
  eventType: string;
  createdAt: number;
};

type RuntimeEventRecord = {
  id: number;
  sessionId: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
};

export default class SessionRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  private sqlDateToMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return Date.now();
  }

  private nullableString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private parseJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  private sessionFromRow(row: Record<string, unknown>): GatewaySessionRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      gatewayId: String(row.gateway_id),
      userId: this.nullableString(row.user_id),
      provider: String(row.provider),
      title: this.nullableString(row.title),
      projectPath: this.nullableString(row.project_path),
      agentSessionId: this.nullableString(row.agent_session_id),
      status: String(row.status),
      transport: String(row.transport ?? 'pty-event-stream'),
      lastActiveAt: row.last_active_at ? this.sqlDateToMs(row.last_active_at) : undefined,
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  private eventFromRow(row: Record<string, unknown>): RuntimeEventRecord {
    return {
      id: Number(row.event_id),
      sessionId: String(row.session_id),
      type: String(row.event_type),
      ts: this.sqlDateToMs(row.created_at),
      payload: this.parseJsonObject(row.payload_json)
    };
  }

  private async sessionWithinScope(
    sessionId: string,
    accountId: string,
    userId: string
  ): Promise<boolean> {
    const rows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND account_id = ? AND user_id = ? LIMIT 1`,
      [sessionId, accountId, userId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private hasAffectedRows(value: unknown): boolean {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'affectedRows' in value &&
      typeof (value as { affectedRows?: unknown }).affectedRows === 'number' &&
      (value as { affectedRows: number }).affectedRows > 0
    );
  }

  public async listSessions(
    accountId: string,
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<GatewaySessionRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const rows = await this.ctx.service.db.query(
      `SELECT * FROM gateway_sessions
       WHERE account_id = ? AND user_id = ? AND archived_at IS NULL
        ORDER BY last_active_at DESC, updated_at DESC
        LIMIT ? OFFSET ?`,
      [accountId, userId, limit, offset]
    );
    return (rows as Record<string, unknown>[]).map((row) => this.sessionFromRow(row));
  }

  public async renameSessionTitle(
    sessionId: string,
    accountId: string,
    userId: string,
    title: string
  ): Promise<void> {
    if (!this.mysqlModeEnabled()) return;
    const result = await this.ctx.service.db.query(
      `UPDATE gateway_sessions
       SET title = ?, title_source = 'user', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND account_id = ? AND user_id = ?`,
      [title, sessionId, accountId, userId]
    );
    if (!this.hasAffectedRows(result)) {
      this.ctx.throw(404, 'Session not found or access denied');
    }
  }

  public async archiveSession(
    sessionId: string,
    accountId: string,
    userId: string
  ): Promise<void> {
    if (!this.mysqlModeEnabled()) return;
    const rows = await this.ctx.service.db.query(
      `SELECT id, status, transport FROM gateway_sessions
       WHERE id = ? AND account_id = ? AND user_id = ? LIMIT 1`,
      [sessionId, accountId, userId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      this.ctx.throw(404, 'Session not found or access denied');
    }

    const session = rows[0] as { status?: unknown; transport?: unknown };
    const status = typeof session.status === 'string' ? session.status : '';
    const transport = typeof session.transport === 'string' ? session.transport : '';
    if (transport !== 'chat' && status === 'running') {
      this.ctx.throw(409, 'Running terminal sessions must be stopped before archive');
    }

    const result = await this.ctx.service.db.query(
      `UPDATE gateway_sessions
       SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND account_id = ? AND user_id = ?`,
      [sessionId, accountId, userId]
    );
    if (!this.hasAffectedRows(result)) {
      this.ctx.throw(404, 'Session not found or access denied');
    }
  }

  private mergeConsecutiveOutput(events: RuntimeEventRecord[]): RuntimeEventRecord[] {
    const merged: RuntimeEventRecord[] = [];
    for (const event of events) {
      const prev = merged[merged.length - 1];
      if (
        event.type === 'terminal.output' &&
        prev?.type === 'terminal.output' &&
        typeof event.payload.data === 'string' &&
        typeof prev.payload.data === 'string'
      ) {
        prev.id = event.id;
        prev.payload = { data: prev.payload.data + event.payload.data };
      } else {
        merged.push({ ...event });
      }
    }
    return merged;
  }

  public async listEvents(
    sessionId: string,
    accountId: string,
    userId: string,
    options: {
      limit?: number;
      before?: number;
      after?: number;
    } = {}
  ): Promise<RuntimeEventRecord[]> {
    if (!this.mysqlModeEnabled() || !await this.sessionWithinScope(sessionId, accountId, userId)) {
      return [];
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 5000);
    if (options.after !== undefined) {
      const rows = await this.ctx.service.db.query(
        `SELECT * FROM gateway_runtime_events
         WHERE session_id = ? AND event_id > ?
         ORDER BY event_id ASC
         LIMIT ?`,
        [sessionId, options.after, limit]
      );
      return this.mergeConsecutiveOutput((rows as Record<string, unknown>[]).map((row) => this.eventFromRow(row)));
    }
    if (options.before !== undefined) {
      const rows = await this.ctx.service.db.query(
        `SELECT * FROM gateway_runtime_events
         WHERE session_id = ? AND event_id < ?
         ORDER BY event_id DESC
         LIMIT ?`,
        [sessionId, options.before, limit]
      );
      return this.mergeConsecutiveOutput((rows as Record<string, unknown>[]).map((row) => this.eventFromRow(row)));
    }
    const rows = await this.ctx.service.db.query(
      `SELECT * FROM gateway_runtime_events
       WHERE session_id = ?
       ORDER BY event_id DESC
       LIMIT ?`,
      [sessionId, limit]
    );
    return this.mergeConsecutiveOutput((rows as Record<string, unknown>[]).map((row) => this.eventFromRow(row)));
  }

  public async adminListSessions(
    page: number,
    limit: number,
    filters: { userId?: string; gatewayId?: string; transport?: string; status?: string }
  ): Promise<{ sessions: AdminSessionRecord[]; total: number }> {
    if (!this.mysqlModeEnabled()) return { sessions: [], total: 0 };
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.userId) { conditions.push('gs.user_id = ?'); params.push(filters.userId); }
    if (filters.gatewayId) { conditions.push('gs.gateway_id = ?'); params.push(filters.gatewayId); }
    if (filters.transport) { conditions.push('gs.transport = ?'); params.push(filters.transport); }
    if (filters.status) { conditions.push('gs.status = ?'); params.push(filters.status); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.ctx.service.db.query(
      `SELECT gs.id, gs.account_id, gs.gateway_id, gs.user_id, gs.provider,
              gs.title, gs.project_path, gs.agent_session_id, gs.status,
              gs.transport, gs.last_active_at, gs.created_at, gs.updated_at,
              u.email as user_email
       FROM gateway_sessions gs
       LEFT JOIN users u ON u.id = gs.user_id
       ${where}
       ORDER BY gs.last_active_at DESC, gs.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const countRows = await this.ctx.service.db.query(
      `SELECT COUNT(*) as total FROM gateway_sessions gs ${where}`,
      params
    );
    const total = Number((countRows as Array<{ total: unknown }>)[0]?.total ?? 0);
    const sessions = (rows as Record<string, unknown>[]).map(row => this.adminSessionFromRow(row));
    return { sessions, total };
  }

  public async adminGetSession(sessionId: string): Promise<AdminSessionRecord | null> {
    if (!this.mysqlModeEnabled()) return null;
    const rows = await this.ctx.service.db.query(
      `SELECT gs.id, gs.account_id, gs.gateway_id, gs.user_id, gs.provider,
              gs.title, gs.project_path, gs.agent_session_id, gs.status,
              gs.transport, gs.last_active_at, gs.created_at, gs.updated_at,
              u.email as user_email
       FROM gateway_sessions gs
       LEFT JOIN users u ON u.id = gs.user_id
       WHERE gs.id = ? LIMIT 1`,
      [sessionId]
    );
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.adminSessionFromRow(row) : null;
  }

  public async adminListChatMessages(
    sessionId: string, page: number, limit: number
  ): Promise<{ messages: AdminChatMessageRecord[]; total: number }> {
    if (!this.mysqlModeEnabled()) return { messages: [], total: 0 };
    const offset = (page - 1) * limit;
    const rows = await this.ctx.service.db.query(
      `SELECT id, session_id, role, content, usage_json, created_at
       FROM gateway_chat_messages WHERE session_id = ?
       ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await this.ctx.service.db.query(
      'SELECT COUNT(*) as total FROM gateway_chat_messages WHERE session_id = ?',
      [sessionId]
    );
    const total = Number((countRows as Array<{ total: unknown }>)[0]?.total ?? 0);
    const messages = (rows as Record<string, unknown>[]).map(row => ({
      id: Number(row.id ?? 0),
      sessionId: String(row.session_id ?? ''),
      role: row.role === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
      content: String(row.content ?? ''),
      usageJson: this.parseJsonObject(row.usage_json),
      createdAt: this.sqlDateToMs(row.created_at),
    }));
    return { messages, total };
  }

  public async adminListRuntimeEvents(
    sessionId: string, page: number, limit: number
  ): Promise<{ events: AdminRuntimeEventRecord[]; total: number }> {
    if (!this.mysqlModeEnabled()) return { events: [], total: 0 };
    const offset = (page - 1) * limit;
    const rows = await this.ctx.service.db.query(
      `SELECT event_id, session_id, event_type, payload_json, created_at
       FROM gateway_runtime_events WHERE session_id = ?
       ORDER BY event_id DESC LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await this.ctx.service.db.query(
      'SELECT COUNT(*) as total FROM gateway_runtime_events WHERE session_id = ?',
      [sessionId]
    );
    const total = Number((countRows as Array<{ total: unknown }>)[0]?.total ?? 0);
    const events = (rows as Record<string, unknown>[]).map(row => ({
      eventId: Number(row.event_id ?? 0),
      sessionId: String(row.session_id ?? ''),
      eventType: String(row.event_type ?? ''),
      payloadJson: this.parseJsonObject(row.payload_json),
      createdAt: this.sqlDateToMs(row.created_at),
    }));
    return { events, total };
  }

  public async adminListChatEvents(
    sessionId: string, page: number, limit: number
  ): Promise<{ events: AdminChatEventRecord[]; total: number }> {
    if (!this.mysqlModeEnabled()) return { events: [], total: 0 };
    const offset = (page - 1) * limit;
    const rows = await this.ctx.service.db.query(
      `SELECT id, session_id, event_id, event_type, created_at
       FROM gateway_runtime_chats_events WHERE session_id = ?
       ORDER BY event_id DESC LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await this.ctx.service.db.query(
      'SELECT COUNT(*) as total FROM gateway_runtime_chats_events WHERE session_id = ?',
      [sessionId]
    );
    const total = Number((countRows as Array<{ total: unknown }>)[0]?.total ?? 0);
    const events = (rows as Record<string, unknown>[]).map(row => ({
      id: Number(row.id ?? 0),
      sessionId: String(row.session_id ?? ''),
      eventId: Number(row.event_id ?? 0),
      eventType: String(row.event_type ?? ''),
      createdAt: this.sqlDateToMs(row.created_at),
    }));
    return { events, total };
  }

  private adminSessionFromRow(row: Record<string, unknown>): AdminSessionRecord {
    return {
      id: String(row.id ?? ''),
      accountId: String(row.account_id ?? ''),
      gatewayId: String(row.gateway_id ?? ''),
      userId: this.nullableString(row.user_id),
      userEmail: this.nullableString(row.user_email),
      provider: String(row.provider ?? ''),
      title: this.nullableString(row.title),
      projectPath: this.nullableString(row.project_path),
      agentSessionId: this.nullableString(row.agent_session_id),
      status: String(row.status ?? ''),
      transport: String(row.transport ?? ''),
      lastActiveAt: row.last_active_at ? this.sqlDateToMs(row.last_active_at) : undefined,
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at),
    };
  }
}
