import { Service } from 'egg';

import type { AuditEventRecord } from './runtime';

type AuditInsert = Omit<AuditEventRecord, 'id' | 'createdAt'> & {
  createdAt?: number;
};

export default class AuditRepositoryService extends Service {
  private mysqlModeEnabled() {
    const { ctx } = this;
    return ctx.service.db.mysqlModeEnabled();
  }

  private sqlDateToMs(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return Date.now();
  }

  private nullableString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private nullableId(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value);
  }

  private actorTypeOf(input: AuditInsert): string {
    if (input.adminUserId) return 'admin_user';
    if (input.userId) return 'user';
    if (input.gatewayId) return 'gateway';
    return 'system';
  }

  private actorIdOf(input: AuditInsert): string | undefined {
    return input.adminUserId ?? input.userId ?? input.gatewayId;
  }

  private auditEventFromRow(row: Record<string, unknown>): AuditEventRecord {
    const payload = row.payload_json && typeof row.payload_json === 'string'
      ? JSON.parse(String(row.payload_json)) as Record<string, unknown>
      : (row.payload_json as Record<string, unknown> | null) ?? {};
    return {
      id: Number(row.id),
      accountId: String(row.account_id),
      userId: this.nullableId(row.user_id),
      adminUserId: this.nullableId(row.admin_user_id),
      deviceId: this.nullableId(row.device_id),
      gatewayId: this.nullableId(row.gateway_id),
      sessionId: this.nullableString(row.session_id),
      action: String(row.event_type),
      tokenClass: this.nullableString(row.token_class),
      failureReason: undefined,
      payload,
      createdAt: this.sqlDateToMs(row.created_at)
    };
  }

  public async insertAuditEvent(input: AuditInsert): Promise<AuditEventRecord> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      const store = ctx.service.runtime.runtimeStore();
      const event: AuditEventRecord = {
        id: store.nextAuditId++,
        createdAt: input.createdAt ?? Date.now(),
        ...input
      };
      store.auditEvents.push(event);
      return event;
    }
    const createdAt = input.createdAt ?? Date.now();
    const result = await ctx.service.db.query(
      `INSERT INTO audit_events (
        account_id, user_id, admin_user_id, device_id, gateway_id, session_id,
        token_class, jti, event_type, actor_type, actor_id, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))`,
      [
        input.accountId,
        input.userId ?? null,
        input.adminUserId ?? null,
        input.deviceId ?? null,
        input.gatewayId ?? null,
        input.sessionId ?? null,
        input.tokenClass ?? null,
        typeof input.payload.jti === 'string' ? input.payload.jti : null,
        input.action,
        this.actorTypeOf(input),
        this.actorIdOf(input) ?? null,
        JSON.stringify(input.payload),
        createdAt,
        createdAt
      ]
    );
    return {
      id: Number((result as { insertId: number }).insertId),
      createdAt,
      accountId: input.accountId,
      userId: input.userId,
      adminUserId: input.adminUserId,
      deviceId: input.deviceId,
      gatewayId: input.gatewayId,
      sessionId: input.sessionId,
      action: input.action,
      tokenClass: input.tokenClass,
      failureReason: input.failureReason,
      ip: input.ip,
      userAgent: input.userAgent,
      payload: input.payload
    };
  }

  public async loadAuditEvents(): Promise<AuditEventRecord[]> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return ctx.service.runtime.runtimeStore().auditEvents;
    }
    const rows = await ctx.service.db.query('SELECT * FROM audit_events ORDER BY id ASC');
    return (rows as Record<string, unknown>[]).map(row => this.auditEventFromRow(row));
  }

  public async countAuditEventsLast7Days(): Promise<number> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return ctx.service.runtime.runtimeStore().auditEvents.filter(event => event.createdAt >= cutoff).length;
    }
    const rows = await ctx.service.db.query(
      'SELECT COUNT(*) AS count FROM audit_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
    );
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async loadAuditEventsFiltered(params: {
    userId?: string;
    eventType?: string;
    deviceId?: string;
    gatewayId?: string;
    fromMs?: number;
    toMs?: number;
    limit: number;
    offset: number;
  }): Promise<AuditEventRecord[]> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return this.filterRuntimeAuditEvents(params).slice(params.offset, params.offset + params.limit);
    }
    const { where, values } = this.buildAuditFilter(params);
    const sql = `SELECT * FROM audit_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rows = await ctx.service.db.query(sql, [...values, params.limit, params.offset]);
    return (rows as Record<string, unknown>[]).map(row => this.auditEventFromRow(row));
  }

  public async countAuditEventsFiltered(params: {
    userId?: string;
    eventType?: string;
    deviceId?: string;
    gatewayId?: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return this.filterRuntimeAuditEvents(params).length;
    }
    const { where, values } = this.buildAuditFilter(params);
    const rows = await ctx.service.db.query(`SELECT COUNT(*) AS count FROM audit_events ${where}`, values);
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  private buildAuditFilter(params: {
    userId?: string;
    eventType?: string;
    deviceId?: string;
    gatewayId?: string;
    fromMs?: number;
    toMs?: number;
  }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (params.userId) { conditions.push('user_id = ?'); values.push(params.userId); }
    if (params.eventType) { conditions.push('event_type = ?'); values.push(params.eventType); }
    if (params.deviceId) { conditions.push('device_id = ?'); values.push(params.deviceId); }
    if (params.gatewayId) { conditions.push('gateway_id = ?'); values.push(params.gatewayId); }
    if (params.fromMs) { conditions.push('created_at >= FROM_UNIXTIME(? / 1000)'); values.push(params.fromMs); }
    if (params.toMs) { conditions.push('created_at <= FROM_UNIXTIME(? / 1000)'); values.push(params.toMs); }
    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values
    };
  }

  private filterRuntimeAuditEvents(params: {
    userId?: string;
    eventType?: string;
    deviceId?: string;
    gatewayId?: string;
    fromMs?: number;
    toMs?: number;
  }) {
    const { ctx } = this;
    let events = ctx.service.runtime.runtimeStore().auditEvents;
    if (params.userId) events = events.filter(e => e.userId === params.userId);
    if (params.eventType) events = events.filter(e => e.action === params.eventType);
    if (params.deviceId) events = events.filter(e => e.deviceId === params.deviceId);
    if (params.gatewayId) events = events.filter(e => e.gatewayId === params.gatewayId);
    if (params.fromMs !== undefined) events = events.filter(e => e.createdAt >= params.fromMs!);
    if (params.toMs !== undefined) events = events.filter(e => e.createdAt <= params.toMs!);
    return events;
  }
}
