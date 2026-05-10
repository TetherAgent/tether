import { Service } from 'egg';

export type ChatSessionRecord = {
  id: string;
  gatewayId: string;
  provider: string;
  projectPath: string;
  title?: string;
  agentSessionId?: string;
  status: string;
  transport: string;
  lastActiveAt?: number;
  createdAt: number;
};

export type ChatMessageRecord = {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  usageJson?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    contextWindow?: number;
    contextInputTokens?: number;
    rateLimitInfo?: {
      resetsAt?: number;
      rateLimitType?: string;
      primary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
      secondary?: { usedPercent: number; windowMinutes?: number; resetsAt?: number };
    };
  };
  createdAt: string;
};

export default class ChatRepositoryService extends Service {
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

  public async listChatSessions(accountId: string, userId: string): Promise<ChatSessionRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const rows = await this.ctx.service.db.query(
      `SELECT id, gateway_id, provider, project_path, title, agent_session_id, status, transport, last_active_at, created_at
       FROM gateway_sessions
       WHERE account_id = ? AND user_id = ? AND transport = 'chat'
       ORDER BY last_active_at DESC, created_at DESC
       LIMIT 50`,
      [accountId, userId]
    );
    return (rows as Record<string, unknown>[]).map((row) => this.sessionFromRow(row));
  }

  public async renameSession(sessionId: string, accountId: string, userId: string, title: string): Promise<void> {
    if (!this.mysqlModeEnabled()) return;
    await this.ctx.service.db.query(
      `UPDATE gateway_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND account_id = ? AND user_id = ?`,
      [title, sessionId, accountId, userId]
    );
  }

  public async deleteSession(sessionId: string, accountId: string, userId: string): Promise<void> {
    if (!this.mysqlModeEnabled()) return;
    const rows = await this.ctx.service.db.query(
      `SELECT id, gateway_id FROM gateway_sessions WHERE id = ? AND account_id = ? AND user_id = ? AND transport = 'chat' LIMIT 1`,
      [sessionId, accountId, userId]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      this.ctx.throw(403, 'Session not found or access denied');
    }
    const row = rows[0] as { gateway_id?: unknown };
    await this.ctx.service.db.query(
      `INSERT INTO gateway_deleted_sessions (session_id, account_id, user_id, gateway_id, deleted_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         gateway_id = VALUES(gateway_id),
         deleted_at = CURRENT_TIMESTAMP`,
      [sessionId, accountId, userId, typeof row.gateway_id === 'string' ? row.gateway_id : null]
    );
    await this.ctx.service.db.query('DELETE FROM gateway_chat_messages WHERE session_id = ?', [sessionId]);
    await this.ctx.service.db.query('DELETE FROM gateway_runtime_events WHERE session_id = ?', [sessionId]);
    await this.ctx.service.db.query('DELETE FROM gateway_sync_cursors WHERE session_id = ?', [sessionId]);
    await this.ctx.service.db.query('DELETE FROM gateway_sessions WHERE id = ?', [sessionId]);
  }

  public async listMessages(
    sessionId: string,
    accountId: string,
    userId: string
  ): Promise<ChatMessageRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const sessionRows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND account_id = ? AND user_id = ? AND transport = 'chat'
       LIMIT 1`,
      [sessionId, accountId, userId]
    );
    if (!Array.isArray(sessionRows) || sessionRows.length === 0) {
      this.ctx.throw(403, 'Session not found or access denied');
    }
    const rows = await this.ctx.service.db.query(
      `SELECT id, session_id, role, content, usage_json, created_at
       FROM gateway_chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`,
      [sessionId]
    );
    return (rows as Record<string, unknown>[]).map((row) => this.messageFromRow(row));
  }

  public async updateAgentSessionId(sessionId: string, agentSessionId: string): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      return;
    }
    await this.ctx.service.db.query(
      'UPDATE gateway_sessions SET agent_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [agentSessionId, sessionId]
    );
  }

  private sessionFromRow(row: Record<string, unknown>): ChatSessionRecord {
    return {
      id: String(row.id ?? ''),
      gatewayId: String(row.gateway_id ?? ''),
      provider: String(row.provider ?? ''),
      projectPath: String(row.project_path ?? ''),
      title: this.nullableString(row.title),
      agentSessionId: this.nullableString(row.agent_session_id),
      status: String(row.status ?? ''),
      transport: String(row.transport ?? ''),
      lastActiveAt: row.last_active_at ? this.sqlDateToMs(row.last_active_at) : undefined,
      createdAt: this.sqlDateToMs(row.created_at)
    };
  }

  private messageFromRow(row: Record<string, unknown>): ChatMessageRecord {
    let usageJson: ChatMessageRecord['usageJson'];
    if (typeof row.usage_json === 'string' && row.usage_json) {
      try {
        usageJson = JSON.parse(row.usage_json) as ChatMessageRecord['usageJson'];
      } catch {
        usageJson = undefined;
      }
    }
    return {
      id: Number(row.id ?? 0),
      sessionId: String(row.session_id ?? ''),
      role: row.role === 'user' ? 'user' : 'assistant',
      content: String(row.content ?? ''),
      usageJson,
      createdAt: String(row.created_at ?? '')
    };
  }
}
