import { Service } from 'egg';

export type ChatDeltaEventRow = {
  eventId: number;
  rawJson: string;
};

export default class ChatEventsRepositoryService extends Service {
  private mysqlModeEnabled() {
    return this.ctx.service.db.mysqlModeEnabled();
  }

  public async listDeltaEventsAfter(sessionId: string, after: number): Promise<ChatDeltaEventRow[]> {
    if (!this.mysqlModeEnabled()) {
      return [];
    }
    const rows = await this.ctx.service.db.query(
      `SELECT event_id, raw_json
       FROM gateway_runtime_chats_events
       WHERE session_id = ? AND event_type = 'agent.delta' AND event_id > ?
       ORDER BY event_id ASC`,
      [sessionId, after]
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      eventId: Number(row.event_id ?? 0),
      rawJson: String(row.raw_json ?? '{}')
    }));
  }
}
