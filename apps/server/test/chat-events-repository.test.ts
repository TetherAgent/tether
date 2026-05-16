import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'
import { parseEventSeqWatermark } from '../app/controller/chat'

describe('test/chat-events-repository.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
  })

  it('parseEventSeqWatermark 强校验 catch-up after 水位', () => {
    assert.equal(parseEventSeqWatermark(undefined), 0)
    assert.equal(parseEventSeqWatermark(''), 0)
    assert.equal(parseEventSeqWatermark('42'), 42)
    assert.equal(parseEventSeqWatermark(['7']), 7)
    assert.equal(parseEventSeqWatermark('-1'), undefined)
    assert.equal(parseEventSeqWatermark('1.5'), undefined)
    assert.equal(parseEventSeqWatermark('abc'), undefined)
    assert.equal(parseEventSeqWatermark(String(Number.MAX_SAFE_INTEGER + 1)), undefined)
  })

  it('listClientEventsAfter 返回全类型结构化事件，并按 eventSeq ASC 强排序', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: (sql: string, values?: unknown[]) => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async (sql, values) => {
      queries.push({ sql, values })
      if (/SELECT id FROM gateway_sessions/.test(sql)) {
        return [{ id: 'tth_chat_strict_order' }]
      }
      return [
        row(30, 30, 'agent.result', { text: 'done' }),
        row(10, 10, 'user.message', { message: 'hi' }),
        row(60, 60, 'session.error', { message: 'failed' }),
        row(40, 40, 'agent.tool', { name: 'Read' }),
        row(20, 20, 'agent.delta', { text: 'stream' }),
        row(50, 50, 'agent.permission_request', { requestId: 'perm_1' })
      ]
    }

    const events = await ctx.service.chatEventsRepository.listClientEventsAfter(
      'tth_chat_strict_order',
      9,
      { accountId: 'acct_1', userId: 'user_1' }
    )

    assert.deepEqual(events.map(event => event.eventSeq), [10, 20, 30, 40, 50, 60])
    assert.deepEqual(events.map(event => event.type), [
      'user.message',
      'agent.delta',
      'agent.result',
      'agent.tool',
      'agent.permission_request',
      'session.error'
    ])
    assert.deepEqual(queries[0]!.values, ['tth_chat_strict_order', 'acct_1', 'user_1'])
    assert.deepEqual(queries[1]!.values, ['tth_chat_strict_order', 9])
  })
})

function row(eventId: number, eventSeq: number, type: string, payload: Record<string, unknown>) {
  return {
    event_id: eventId,
    event_type: type,
    raw_json: JSON.stringify({
      id: eventSeq,
      eventSeq,
      type,
      sessionId: 'tth_chat_strict_order',
      turnId: `turn_${eventSeq}`,
      payload
    }),
    created_at: new Date(eventSeq * 1000).toISOString()
  }
}
