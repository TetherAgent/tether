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
       WHERE account_id = ? AND user_id = ?
        ORDER BY last_active_at DESC, updated_at DESC
        LIMIT ? OFFSET ?`,
      [accountId, userId, limit, offset]
    );
    return (rows as Record<string, unknown>[]).map((row) => this.sessionFromRow(row));
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
}
