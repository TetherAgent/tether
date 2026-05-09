import { Subscription } from 'egg';

const DELETE_BATCH_SIZE = 10000;
const MAX_EVENTS_PER_SESSION = 100000;

export default class CleanupRuntimeEvents extends Subscription {
  static get schedule() {
    return {
      type: 'worker',
      cron: '0 0 3 * * *'
    };
  }

  async subscribe() {
    const { ctx } = this;
    if (!ctx.service.db.mysqlModeEnabled()) {
      return;
    }

    try {
      await ctx.service.db.query(
        `DELETE FROM gateway_runtime_events
         WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 MONTH)
         LIMIT ?`,
        [DELETE_BATCH_SIZE]
      );
    } catch (error) {
      console.warn('[cleanup] failed to delete old runtime events', String(error));
    }

    try {
      const sessions = await ctx.service.db.query(
        'SELECT DISTINCT session_id FROM gateway_runtime_events'
      ) as Array<{ session_id: string }>;
      for (const row of sessions) {
        await ctx.service.db.query(
          `DELETE FROM gateway_runtime_events
           WHERE session_id = ?
             AND id < (
               SELECT id FROM (
                 SELECT id FROM gateway_runtime_events
                 WHERE session_id = ?
                 ORDER BY id DESC
                 LIMIT 1 OFFSET ?
               ) AS t
             )`,
          [row.session_id, row.session_id, MAX_EVENTS_PER_SESSION - 1]
        ).catch(() => undefined);
      }
    } catch (error) {
      console.warn('[cleanup] failed to enforce runtime event cap', String(error));
    }
  }
}
