import { createHash } from 'node:crypto';
import { Service } from 'egg';

type RuntimeSyncScope = {
  accountId: string;
  gatewayId: string;
  transport?: string;
};

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'blocked';
type ApprovalDecision = 'allow' | 'deny';
type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical';
type ApprovalSource = 'chat_permission' | 'provider_action' | 'diff' | 'handoff';

export type ApprovalRecord = {
  id: string;
  accountId: string;
  workspaceId?: string;
  gatewayId: string;
  sessionId: string;
  userId: string;
  requestId: string;
  source: ApprovalSource;
  status: ApprovalStatus;
  risk: ApprovalRisk;
  title: string;
  summary: string;
  reason?: string;
  toolName?: string;
  inputPreview?: Record<string, unknown>;
  inputHash?: string;
  eventId?: number;
  eventSeq?: number;
  turnId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  decidedBy?: string;
  decidedAt?: string;
};

const MASK = '[REDACTED]';
const MASK_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g
];
const MAX_PREVIEW_BYTES = 8192;

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function maskText(value: string): string {
  return MASK_PATTERNS.reduce((text, pattern) => text.replace(pattern, MASK), value);
}

function truncate(value: string, max = MAX_PREVIEW_BYTES): string {
  return value.length > max ? `${value.slice(0, max)}...[TRUNCATED]` : value;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeObject(parsed);
  } catch {
    return undefined;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export default class ApprovalRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  private approvalFromRow(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      workspaceId: typeof row.workspace_id === 'string' ? row.workspace_id : undefined,
      gatewayId: String(row.gateway_id),
      sessionId: String(row.session_id),
      userId: String(row.user_id),
      requestId: String(row.request_id),
      source: String(row.source) as ApprovalSource,
      status: String(row.status) as ApprovalStatus,
      risk: String(row.risk) as ApprovalRisk,
      title: String(row.title ?? ''),
      summary: String(row.summary ?? ''),
      reason: typeof row.reason === 'string' ? row.reason : undefined,
      toolName: typeof row.tool_name === 'string' ? row.tool_name : undefined,
      inputPreview: parseJsonObject(row.input_preview_json),
      inputHash: typeof row.input_hash === 'string' ? row.input_hash : undefined,
      eventId: typeof row.event_id === 'number' ? row.event_id : undefined,
      eventSeq: typeof row.event_seq === 'number' ? row.event_seq : undefined,
      turnId: typeof row.turn_id === 'string' ? row.turn_id : undefined,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      expiresAt: row.expires_at ? toIso(row.expires_at) : undefined,
      decidedBy: typeof row.decided_by === 'string' ? row.decided_by : undefined,
      decidedAt: row.decided_at ? toIso(row.decided_at) : undefined
    };
  }

  private async sessionUserId(sessionId: string, scope: RuntimeSyncScope, db = this.ctx.service.db): Promise<string | undefined> {
    const rows = await db.query(
      `SELECT user_id FROM gateway_sessions
       WHERE id = ? AND account_id = ? AND gateway_id = ? LIMIT 1`,
      [sessionId, scope.accountId, scope.gatewayId]
    ) as Array<Record<string, unknown>>;
    const userId = rows[0]?.user_id;
    return typeof userId === 'string' ? userId : undefined;
  }

  private riskForTool(toolName: string, input: Record<string, unknown>): ApprovalRisk {
    const text = `${toolName} ${stableJson(input)}`.toLowerCase();
    if (/\brm\s+-rf\b|delete|drop\s+table|sudo|chmod\s+777|production|prod\b/.test(text)) {
      return 'critical';
    }
    if (/write|edit|patch|apply|bash|shell|exec|install|deploy|push/.test(text)) {
      return 'high';
    }
    if (/read|list|grep|search|view/.test(text)) {
      return 'low';
    }
    return 'medium';
  }

  public async upsertFromRuntimeEvent(input: {
    gatewayId: string;
    event: Record<string, unknown>;
    scope: RuntimeSyncScope;
  }): Promise<ApprovalRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return undefined;
    }
    const event = input.event;
    if (event.type !== 'agent.permission_request') {
      return undefined;
    }
    const sessionId = String(event.sessionId ?? '');
    const payload = normalizeObject(event.payload);
    const requestId = String(payload.requestId ?? '');
    if (!sessionId || !requestId) {
      return undefined;
    }
    return await this.ctx.service.db.transaction(async connection => {
      const userId = await this.sessionUserId(sessionId, input.scope, connection);
      if (!userId) {
        return undefined;
      }
      const toolName = String(payload.toolName ?? 'tool');
      const inputPreview = normalizeObject(payload.input);
      const previewJson = truncate(maskText(stableJson(inputPreview)));
      const inputHash = createHash('sha256').update(previewJson).digest('hex');
      const id = createHash('sha256')
        .update(`${input.scope.accountId}:${input.scope.gatewayId}:${sessionId}:${requestId}`)
        .digest('hex')
        .slice(0, 32);
      const risk = this.riskForTool(toolName, inputPreview);
      const title = `${toolName} permission request`;
      const summary = `${toolName} requests permission in this chat session`;
      await connection.query(
        `INSERT INTO gateway_approvals (
           id, account_id, gateway_id, session_id, user_id, request_id, source, status,
           risk, title, summary, reason, tool_name, input_preview_json, input_hash,
           event_id, event_seq, turn_id
         ) VALUES (?, ?, ?, ?, ?, ?, 'chat_permission', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = IF(status = 'pending', status, status),
           risk = VALUES(risk),
           title = VALUES(title),
           summary = VALUES(summary),
           reason = VALUES(reason),
           tool_name = VALUES(tool_name),
           input_preview_json = VALUES(input_preview_json),
           input_hash = VALUES(input_hash),
           event_id = VALUES(event_id),
           event_seq = VALUES(event_seq),
           turn_id = VALUES(turn_id),
           updated_at = CURRENT_TIMESTAMP`,
        [
          id,
          input.scope.accountId,
          input.scope.gatewayId,
          sessionId,
          userId,
          requestId,
          risk,
          title,
          summary,
          risk === 'critical' ? 'Potentially destructive action requires review' : 'Agent requested a structured permission',
          toolName,
          previewJson,
          inputHash,
          typeof event.id === 'number' ? event.id : null,
          typeof event.eventSeq === 'number' ? event.eventSeq : null,
          typeof event.turnId === 'string' ? event.turnId : null
        ]
      );
      await connection.query(
        `INSERT INTO gateway_approval_audit (approval_id, account_id, gateway_id, session_id, actor_id, action, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'created', ?)
         ON DUPLICATE KEY UPDATE approval_id = approval_id`,
        [id, input.scope.accountId, input.scope.gatewayId, sessionId, userId, stableJson({ requestId, toolName, inputHash })]
      ).catch(() => undefined);
      const rows = await connection.query('SELECT * FROM gateway_approvals WHERE id = ? LIMIT 1', [id]) as Array<Record<string, unknown>>;
      return rows[0] ? this.approvalFromRow(rows[0]) : undefined;
    });
  }

  public async listForUser(accountId: string, userId: string, status = 'pending', limit = 100): Promise<ApprovalRecord[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const values: unknown[] = [accountId, userId];
    const statusFilter = status === 'all' ? '' : 'AND status = ?';
    if (status !== 'all') values.push(status);
    values.push(Math.min(Math.max(limit, 1), 200));
    const rows = await this.ctx.service.db.query(
      `SELECT * FROM gateway_approvals
       WHERE account_id = ? AND user_id = ? ${statusFilter}
       ORDER BY FIELD(status, 'pending', 'blocked', 'approved', 'rejected', 'expired'), created_at DESC
       LIMIT ?`,
      values
    ) as Array<Record<string, unknown>>;
    return rows.map(row => this.approvalFromRow(row));
  }

  public async decide(input: {
    approvalId: string;
    accountId: string;
    userId: string;
    decision: ApprovalDecision;
  }): Promise<ApprovalRecord> {
    if (!this.mysqlModeEnabled()) {
      this.ctx.throw(404, 'Approval not found');
    }
    return await this.ctx.service.db.transaction(async connection => {
      const rows = await connection.query(
        `SELECT * FROM gateway_approvals
         WHERE id = ? AND account_id = ? AND user_id = ? LIMIT 1`,
        [input.approvalId, input.accountId, input.userId]
      ) as Array<Record<string, unknown>>;
      const existing = rows[0];
      if (!existing) {
        this.ctx.throw(404, 'Approval not found or access denied');
      }
      const status = String(existing.status ?? '');
      if (status === 'pending') {
        const nextStatus = input.decision === 'allow' ? 'approved' : 'rejected';
        await connection.query(
          `UPDATE gateway_approvals
           SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`,
          [nextStatus, input.userId, input.approvalId]
        );
        await connection.query(
          `INSERT INTO gateway_approval_audit (approval_id, account_id, gateway_id, session_id, actor_id, action, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            input.approvalId,
            input.accountId,
            String(existing.gateway_id),
            String(existing.session_id),
            input.userId,
            nextStatus,
            stableJson({ decision: input.decision, requestId: existing.request_id })
          ]
        );
      }
      const latestRows = await connection.query('SELECT * FROM gateway_approvals WHERE id = ? LIMIT 1', [input.approvalId]) as Array<Record<string, unknown>>;
      return this.approvalFromRow(latestRows[0] ?? existing);
    });
  }

  public async decideByRequest(input: {
    sessionId: string;
    requestId: string;
    accountId: string;
    userId: string;
    decision: ApprovalDecision;
  }): Promise<ApprovalRecord | undefined> {
    if (!this.mysqlModeEnabled()) {
      return undefined;
    }
    const rows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_approvals
       WHERE session_id = ? AND request_id = ? AND account_id = ? AND user_id = ?
       LIMIT 1`,
      [input.sessionId, input.requestId, input.accountId, input.userId]
    ) as Array<Record<string, unknown>>;
    const approvalId = typeof rows[0]?.id === 'string' ? rows[0].id : undefined;
    if (!approvalId) {
      return undefined;
    }
    return await this.decide({
      approvalId,
      accountId: input.accountId,
      userId: input.userId,
      decision: input.decision
    });
  }
}
