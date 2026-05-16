import { Service } from 'egg';

export type ChatRuntimeEventRow = {
  eventId: number;
  eventSeq: number;
  turnId?: string;
  clientRequestId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  rawJson: string;
};

export default class ChatEventsRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  public async listEventsAfter(sessionId: string, after: number): Promise<ChatRuntimeEventRow[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const rows = await this.ctx.service.db.query(
      `SELECT event_id, event_type, raw_json, created_at
       FROM gateway_runtime_chats_events
       WHERE session_id = ? AND event_id > ?
       ORDER BY event_id ASC`,
      [sessionId, after]
    );
    return (rows as Record<string, unknown>[]).map((row) => {
      const rawJson = String(row.raw_json ?? '{}');
      const parsed = this.parseRawEvent(rawJson);
      const eventId = Number(row.event_id ?? 0);
      return {
        eventId,
        eventSeq: typeof parsed.eventSeq === 'number' ? parsed.eventSeq : eventId,
        turnId: typeof parsed.turnId === 'string' ? parsed.turnId : undefined,
        clientRequestId: typeof parsed.clientRequestId === 'string' ? parsed.clientRequestId : undefined,
        type: String(row.event_type ?? parsed.type ?? ''),
        payload: parsed.payload,
        createdAt: String(row.created_at ?? ''),
        rawJson
      };
    }).sort((left, right) => left.eventSeq - right.eventSeq || left.eventId - right.eventId);
  }

  public async listDeltaEventsAfter(sessionId: string, after: number): Promise<ChatRuntimeEventRow[]> {
    return this.listEventsAfter(sessionId, after);
  }

  public async listClientEventsAfter(
    sessionId: string,
    after: number,
    scope: { accountId: string; userId: string }
  ): Promise<ChatRuntimeEventRow[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const sessionRows = await this.ctx.service.db.query(
      `SELECT id FROM gateway_sessions
       WHERE id = ? AND account_id = ? AND user_id = ? AND transport = 'chat'
       LIMIT 1`,
      [sessionId, scope.accountId, scope.userId]
    );
    if (!Array.isArray(sessionRows) || sessionRows.length === 0) {
      this.ctx.throw(403, 'Session not found or access denied');
    }
    return this.listEventsAfter(sessionId, after);
  }

  private parseRawEvent(rawJson: string): {
    eventSeq?: number;
    turnId?: string;
    clientRequestId?: string;
    type?: string;
    payload: Record<string, unknown>;
  } {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { payload: {} };
      }
      const record = parsed as Record<string, unknown>;
      const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload as Record<string, unknown>
        : {};
      return {
        eventSeq: typeof record.eventSeq === 'number'
          ? record.eventSeq
          : typeof record.id === 'number'
            ? record.id
            : undefined,
        turnId: typeof record.turnId === 'string' ? record.turnId : undefined,
        clientRequestId: typeof record.clientRequestId === 'string' ? record.clientRequestId : undefined,
        type: typeof record.type === 'string' ? record.type : undefined,
        payload
      };
    } catch {
      return { payload: {} };
    }
  }
}
