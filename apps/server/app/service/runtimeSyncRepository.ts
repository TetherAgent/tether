import { Service } from 'egg';

const RUNTIME_EVENT_WHITELIST = new Set([
  'terminal.output',
  'terminal.input',
  'user.message',
  'session.error',
  'session.exited',
  'agent.status',
  'agent.result',
  'agent.tool'
]);

const MASK = '[REDACTED]';
const MASK_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g
];
const MAX_PAYLOAD_BYTES = 65536;

function maskPayload(payload: unknown): string {
  const value = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return MASK_PATTERNS.reduce((text, pattern) => text.replace(pattern, MASK), value);
}

function truncatePayload(value: string): string {
  if (value.length <= MAX_PAYLOAD_BYTES) {
    return value;
  }
  return `${value.slice(0, MAX_PAYLOAD_BYTES)}...[TRUNCATED]`;
}

type RuntimeSyncScope = {
  accountId: string;
  gatewayId: string;
};

type Queryable = {
  query: (sql: string, values?: any[]) => Promise<unknown>;
};

export default class RuntimeSyncRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  private async sessionWithinScope(sessionId: string, scope: RuntimeSyncScope, db: Queryable = this.ctx.service.db): Promise<boolean> {
    const rows = await db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND gateway_id = ? AND account_id = ? LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async sessionScopeConflict(sessionId: string, scope: RuntimeSyncScope, db: Queryable = this.ctx.service.db): Promise<boolean> {
    const rows = await db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND (gateway_id <> ? OR account_id <> ?) LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async sessionDeleted(
    sessionId: string,
    scope: RuntimeSyncScope,
    userId?: string,
    db: Queryable = this.ctx.service.db
  ): Promise<boolean> {
    const rows = await db.query(
      `SELECT session_id FROM gateway_deleted_sessions
       WHERE session_id = ?
         AND account_id = ?
         AND (? IS NULL OR user_id = ?)
         AND (gateway_id IS NULL OR gateway_id = ?)
       LIMIT 1`,
      [sessionId, scope.accountId, userId ?? null, userId ?? null, scope.gatewayId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  public async upsertGatewaySession(
    session: {
      id: string;
      provider: string;
      title?: string;
      projectPath?: string;
      agentSessionId?: string;
      status: string;
      transport?: string;
      lastActiveAt?: number;
      userId?: string;
    },
    scope: RuntimeSyncScope
  ): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      return;
    }
    await this.ctx.service.db.transaction(async connection => {
      if (await this.sessionDeleted(session.id, scope, session.userId, connection)) {
        await connection.query('DELETE FROM gateway_chat_messages WHERE session_id = ?', [session.id]);
        await connection.query('DELETE FROM gateway_runtime_events WHERE session_id = ?', [session.id]);
        await connection.query('DELETE FROM gateway_sync_cursors WHERE session_id = ?', [session.id]);
        await connection.query(
          `DELETE FROM gateway_sessions
           WHERE id = ? AND account_id = ? AND gateway_id = ?`,
          [session.id, scope.accountId, scope.gatewayId]
        );
        return;
      }
      await connection.query(
        `INSERT INTO gateway_sessions (
           id, account_id, gateway_id, user_id, provider, title, project_path,
           agent_session_id, status, transport, last_active_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           account_id = VALUES(account_id),
           gateway_id = VALUES(gateway_id),
           user_id = VALUES(user_id),
           provider = VALUES(provider),
           title = VALUES(title),
           project_path = VALUES(project_path),
           agent_session_id = VALUES(agent_session_id),
           status = VALUES(status),
           transport = VALUES(transport),
           last_active_at = VALUES(last_active_at),
           updated_at = CURRENT_TIMESTAMP`,
        [
          session.id,
          scope.accountId,
          scope.gatewayId,
          session.userId ?? null,
          session.provider,
          session.title ?? null,
          session.projectPath ?? null,
          session.agentSessionId ?? null,
          session.status,
          session.transport ?? 'pty-event-stream',
          session.lastActiveAt ? new Date(session.lastActiveAt) : null
        ]
      );
    });
  }

  public async upsertRuntimeEvent(
    sessionId: string,
    eventId: number,
    eventType: string,
    payload: unknown,
    scope: RuntimeSyncScope,
    createdAt?: unknown
  ): Promise<void> {
    if (!this.mysqlModeEnabled() || !RUNTIME_EVENT_WHITELIST.has(eventType)) {
      return;
    }
    await this.ctx.service.db.transaction(async connection => {
      const sessionRows = await connection.query(
        `SELECT user_id FROM gateway_sessions
         WHERE id = ? AND gateway_id = ? AND account_id = ? LIMIT 1`,
        [sessionId, scope.gatewayId, scope.accountId]
      );
      const userId = Array.isArray(sessionRows) && sessionRows.length > 0
        ? String((sessionRows[0] as { user_id?: unknown }).user_id ?? '')
        : undefined;
      if (await this.sessionDeleted(sessionId, scope, userId, connection)) {
        return;
      }
      if (await this.sessionScopeConflict(sessionId, scope, connection)) {
        console.warn(`[server] upsertRuntimeEvent scope mismatch: ${sessionId}`);
        return;
      }
      const payloadJson = truncatePayload(maskPayload(payload));
      await connection.query(
        `INSERT INTO gateway_runtime_events (session_id, event_id, event_type, payload_json)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           event_type = VALUES(event_type),
           payload_json = VALUES(payload_json),
           updated_at = CURRENT_TIMESTAMP`,
        [sessionId, eventId, eventType, payloadJson]
      );
      await this.insertDerivedChatMessage(connection, sessionId, eventId, eventType, payload, createdAt);
      await this.upsertSyncCursorWithConnection(connection, sessionId, eventId, null, scope);
    });
  }

  public async upsertSyncCursor(
    sessionId: string,
    lastEventId: number | null,
    lastTurnIndex: number | null,
    scope: RuntimeSyncScope
  ): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      return;
    }
    await this.upsertSyncCursorWithConnection(this.ctx.service.db, sessionId, lastEventId, lastTurnIndex, scope);
  }

  private async upsertSyncCursorWithConnection(
    db: Queryable,
    sessionId: string,
    lastEventId: number | null,
    lastTurnIndex: number | null,
    scope: RuntimeSyncScope
  ): Promise<void> {
    await db.query(
      `INSERT INTO gateway_sync_cursors (gateway_id, session_id, last_event_id, last_turn_index, last_synced_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         last_event_id = VALUES(last_event_id),
         last_turn_index = VALUES(last_turn_index),
         last_synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [scope.gatewayId, sessionId, lastEventId, lastTurnIndex]
    );
  }

  private async insertDerivedChatMessage(
    db: Queryable,
    sessionId: string,
    sourceEventId: number,
    eventType: string,
    payloadInput: unknown,
    createdAt?: unknown
  ): Promise<void> {
    if (!Number.isFinite(sourceEventId) || sourceEventId <= 0) {
      return;
    }
    const payload = this.normalizePayload(payloadInput);
    const message = this.chatMessageFromEvent(eventType, payload);
    if (!message) {
      return;
    }
    const usageJson = message.usage == null ? null : truncatePayload(maskPayload(message.usage));
    await db.query(
      `INSERT INTO gateway_chat_messages (session_id, source_event_id, role, content, usage_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         content = VALUES(content),
         usage_json = VALUES(usage_json),
         created_at = VALUES(created_at)`,
      [
        sessionId,
        sourceEventId,
        message.role,
        message.content,
        usageJson,
        this.toDate(createdAt)
      ]
    );
  }

  private chatMessageFromEvent(
    eventType: string,
    payload: Record<string, unknown>
  ): { role: 'user' | 'assistant'; content: string; usage: unknown } | undefined {
    if (eventType === 'user.message' && typeof payload.message === 'string') {
      return { role: 'user', content: payload.message, usage: null };
    }
    if (eventType === 'agent.result' && typeof payload.text === 'string') {
      return { role: 'assistant', content: payload.text, usage: payload.usage ?? null };
    }
    return undefined;
  }

  private normalizePayload(payload: unknown): Record<string, unknown> {
    if (typeof payload === 'string') {
      return this.parseJsonObject(payload);
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return {};
  }

  private parseJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value) {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  private toDate(value: unknown): Date {
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value);
    }
    if (typeof value === 'string' && value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    return new Date();
  }
}
