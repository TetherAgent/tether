import { Service } from 'egg';

import type { GatewayRecord } from './runtime';

export default class GatewayRepositoryService extends Service {
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

  private gatewayFromRow(row: Record<string, unknown>): GatewayRecord {
    return {
      id: String(row.id),
      accountId: String(row.account_id),
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      name: String(row.name),
      status: row.status === 'offline' ? 'offline' : 'online',
      lastSeenAt: this.sqlDateToMs(row.last_seen_at),
      createdAt: this.sqlDateToMs(row.created_at),
      updatedAt: this.sqlDateToMs(row.updated_at)
    };
  }

  public async saveGateway(gateway: GatewayRecord): Promise<string> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      ctx.service.runtime.runtimeStore().gateways.set(gateway.id, gateway);
      return gateway.id;
    }
    const result = await ctx.service.db.query(
      `INSERT INTO gateways (
        account_id, workspace_id, device_id, user_id, admin_user_id, name, status, last_seen_at, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, NULL, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
      ON DUPLICATE KEY UPDATE
        id = LAST_INSERT_ID(id),
        name = VALUES(name),
        status = VALUES(status),
        last_seen_at = VALUES(last_seen_at),
        updated_at = VALUES(updated_at)`,
      [gateway.accountId, gateway.workspaceId, gateway.userId, gateway.name, gateway.status, gateway.lastSeenAt, gateway.createdAt, gateway.updatedAt]
    );
    return String((result as { insertId: number }).insertId);
  }

  public async loadGatewayByUserId(userId: string): Promise<GatewayRecord | undefined> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return [...ctx.service.runtime.runtimeStore().gateways.values()].find(gateway => gateway.userId === userId);
    }
    const rows = await ctx.service.db.query('SELECT * FROM gateways WHERE user_id = ? ORDER BY created_at ASC LIMIT 1', [userId]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.gatewayFromRow(row) : undefined;
  }

  public async loadGatewayById(id: string): Promise<GatewayRecord | undefined> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return ctx.service.runtime.runtimeStore().gateways.get(id);
    }
    const rows = await ctx.service.db.query('SELECT * FROM gateways WHERE id = ? LIMIT 1', [id]);
    const row = (rows as Record<string, unknown>[])[0];
    return row ? this.gatewayFromRow(row) : undefined;
  }

  public async loadAllGateways(limit = 20, offset = 0): Promise<GatewayRecord[]> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return [...ctx.service.runtime.runtimeStore().gateways.values()].slice(offset, offset + limit);
    }
    const rows = await ctx.service.db.query(
      'SELECT * FROM gateways ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    return (rows as Record<string, unknown>[]).map(row => this.gatewayFromRow(row));
  }

  public async countGateways(): Promise<number> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      return ctx.service.runtime.runtimeStore().gateways.size;
    }
    const rows = await ctx.service.db.query('SELECT COUNT(*) AS count FROM gateways');
    return Number((rows as Record<string, unknown>[])[0]?.count ?? 0);
  }

  public async deleteGatewayById(id: string): Promise<void> {
    const { ctx } = this;
    if (!this.mysqlModeEnabled()) {
      ctx.service.runtime.runtimeStore().gateways.delete(id);
      return;
    }
    await ctx.service.db.query('DELETE FROM gateways WHERE id = ?', [id]);
  }
}
