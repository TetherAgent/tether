import { Service } from 'egg';

export default class AdminSessionsService extends Service {
  private sqlDateToMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return 0;
  }

  private nullableString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  private parseJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  public async listAdminSessions(
    page: number,
    limit: number,
    filters: {
      userId?: string;
      gatewayId?: string;
      transport?: string;
      status?: string;
    } = {}
  ) {
    const { ctx } = this;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.userId) {
      conditions.push('gs.user_id = ?');
      params.push(filters.userId);
    }
    if (filters.gatewayId) {
      conditions.push('gs.gateway_id = ?');
      params.push(filters.gatewayId);
    }
    if (filters.transport) {
      conditions.push('gs.transport = ?');
      params.push(filters.transport);
    }
    if (filters.status) {
      conditions.push('gs.status = ?');
      params.push(filters.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await ctx.service.db.query(
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

    const countRows = await ctx.service.db.query(
      `SELECT COUNT(*) as total FROM gateway_sessions gs ${where}`,
      params
    );
    const total = Number((countRows as Array<{ total: unknown }>)[0]?.total ?? 0);

    const sessions = (rows as Record<string, unknown>[]).map(row => ({
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
      lastActiveAt: row.last_active_at ? this.sqlDateToMs(row.last_active_at) : null,
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at),
    }));

    return { sessions, total };
  }

  public async getAdminSession(sessionId: string) {
    const { ctx } = this;
    const rows = await ctx.service.db.query(
      `SELECT gs.id, gs.account_id, gs.gateway_id, gs.user_id, gs.provider,
              gs.title, gs.project_path, gs.agent_session_id, gs.status,
              gs.transport, gs.last_active_at, gs.created_at, gs.updated_at,
              u.email as user_email
       FROM gateway_sessions gs
       LEFT JOIN users u ON u.id = gs.user_id
       WHERE gs.id = ?
       LIMIT 1`,
      [sessionId]
    );
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
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
      lastActiveAt: row.last_active_at ? this.sqlDateToMs(row.last_active_at) : null,
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at),
    };
  }

  public async listAdminChatMessages(sessionId: string, page: number, limit: number) {
    const { ctx } = this;
    const offset = (page - 1) * limit;
    const rows = await ctx.service.db.query(
      `SELECT id, session_id, role, content, usage_json, created_at
       FROM gateway_chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await ctx.service.db.query(
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

  public async listAdminRuntimeEvents(sessionId: string, page: number, limit: number) {
    const { ctx } = this;
    const offset = (page - 1) * limit;
    const rows = await ctx.service.db.query(
      `SELECT event_id, session_id, event_type, payload_json, created_at
       FROM gateway_runtime_events
       WHERE session_id = ?
       ORDER BY event_id DESC
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await ctx.service.db.query(
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

  public async listAdminChatEvents(sessionId: string, page: number, limit: number) {
    const { ctx } = this;
    const offset = (page - 1) * limit;
    const rows = await ctx.service.db.query(
      `SELECT id, session_id, event_id, event_type, created_at
       FROM gateway_runtime_chats_events
       WHERE session_id = ?
       ORDER BY event_id DESC
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );
    const countRows = await ctx.service.db.query(
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
}
