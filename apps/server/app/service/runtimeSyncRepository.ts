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
  workspaceId: string;
  gatewayId: string;
};

export default class RuntimeSyncRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  private async sessionWithinScope(sessionId: string, scope: RuntimeSyncScope): Promise<boolean> {
    const rows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND gateway_id = ? AND account_id = ? AND workspace_id = ? LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId, scope.workspaceId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async sessionScopeConflict(sessionId: string, scope: RuntimeSyncScope): Promise<boolean> {
    const rows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND (gateway_id <> ? OR account_id <> ? OR workspace_id <> ?) LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId, scope.workspaceId]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async sessionDeleted(
    sessionId: string,
    scope: RuntimeSyncScope,
    userId?: string
  ): Promise<boolean> {
    const rows = await this.ctx.service.db.query(
      `SELECT session_id FROM gateway_deleted_sessions
       WHERE session_id = ?
         AND account_id = ?
         AND workspace_id = ?
         AND user_id = ?
         AND (gateway_id IS NULL OR gateway_id = ?)
       LIMIT 1`,
      [sessionId, scope.accountId, scope.workspaceId, userId ?? '', scope.gatewayId]
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
    if (await this.sessionDeleted(session.id, scope, session.userId)) {
      await this.ctx.service.db.query('DELETE FROM gateway_chat_messages WHERE session_id = ?', [session.id]);
      await this.ctx.service.db.query('DELETE FROM gateway_runtime_events WHERE session_id = ?', [session.id]);
      await this.ctx.service.db.query('DELETE FROM gateway_sync_cursors WHERE session_id = ?', [session.id]);
      await this.ctx.service.db.query(
        `DELETE FROM gateway_sessions
         WHERE id = ? AND account_id = ? AND workspace_id = ? AND gateway_id = ?`,
        [session.id, scope.accountId, scope.workspaceId, scope.gatewayId]
      );
      return;
    }
    await this.ctx.service.db.query(
      `INSERT INTO gateway_sessions (
         id, account_id, workspace_id, gateway_id, user_id, provider, title, project_path,
         agent_session_id, status, transport, last_active_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         account_id = VALUES(account_id),
         workspace_id = VALUES(workspace_id),
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
        scope.workspaceId,
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
  }

  public async upsertRuntimeEvent(
    sessionId: string,
    eventId: number,
    eventType: string,
    payload: unknown,
    scope: RuntimeSyncScope
  ): Promise<void> {
    if (!this.mysqlModeEnabled() || !RUNTIME_EVENT_WHITELIST.has(eventType)) {
      return;
    }
    const sessionRows = await this.ctx.service.db.query(
      `SELECT user_id FROM gateway_sessions
       WHERE id = ? AND gateway_id = ? AND account_id = ? AND workspace_id = ? LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId, scope.workspaceId]
    );
    const userId = Array.isArray(sessionRows) && sessionRows.length > 0
      ? String((sessionRows[0] as { user_id?: unknown }).user_id ?? '')
      : '';
    if (await this.sessionDeleted(sessionId, scope, userId)) {
      return;
    }
    if (!await this.sessionWithinScope(sessionId, scope)) {
      console.warn(`[server] upsertRuntimeEvent scope mismatch: ${sessionId}`);
      return;
    }
    const payloadJson = truncatePayload(maskPayload(payload));
    await this.ctx.service.db.query(
      `INSERT INTO gateway_runtime_events (session_id, event_id, event_type, payload_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         event_type = VALUES(event_type),
         payload_json = VALUES(payload_json),
         updated_at = CURRENT_TIMESTAMP`,
      [sessionId, eventId, eventType, payloadJson]
    );
  }

  public async upsertChatMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    usage: unknown,
    scope: RuntimeSyncScope,
    createdAt?: unknown
  ): Promise<void> {
    if (!this.mysqlModeEnabled()) {
      return;
    }
    const sessionRows = await this.ctx.service.db.query(
      `SELECT user_id FROM gateway_sessions
       WHERE id = ? AND gateway_id = ? AND account_id = ? AND workspace_id = ? LIMIT 1`,
      [sessionId, scope.gatewayId, scope.accountId, scope.workspaceId]
    );
    const userId = Array.isArray(sessionRows) && sessionRows.length > 0
      ? String((sessionRows[0] as { user_id?: unknown }).user_id ?? '')
      : '';
    if (await this.sessionDeleted(sessionId, scope, userId)) {
      return;
    }
    if (await this.sessionScopeConflict(sessionId, scope)) {
      console.warn(`[server] upsertChatMessage scope mismatch: ${sessionId}`);
      return;
    }
    const usageJson = usage == null ? null : truncatePayload(maskPayload(usage));
    const createdAtDate = typeof createdAt === 'number' && Number.isFinite(createdAt) ? new Date(createdAt) : new Date();
    await this.ctx.service.db.query(
      `INSERT INTO gateway_chat_messages (session_id, role, content, usage_json, created_at)
       SELECT ?, ?, ?, ?, ?
       FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM gateway_chat_messages
         WHERE session_id = ?
           AND role = ?
           AND content = ?
           AND ((usage_json IS NULL AND ? IS NULL) OR usage_json = ?)
         LIMIT 1
       )`,
      [
        sessionId,
        role,
        content,
        usageJson,
        createdAtDate,
        sessionId,
        role,
        content,
        usageJson,
        usageJson
      ]
    );
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
    await this.ctx.service.db.query(
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
}
