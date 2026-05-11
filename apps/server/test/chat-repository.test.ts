import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/chat-repository.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
  })

  it('chatRepository.renameSession marks user title and limits rename to chat sessions', async () => {
    const queries: Array<{ sql: string; values?: any[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: (sql: string, values?: any[]) => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async (sql, values) => {
      queries.push({ sql, values })
      return { affectedRows: 1 }
    }

    await ctx.service.chatRepository.renameSession('tth_title_1', 'acct_1', 'user_1', '自定义标题')

    assert.equal(queries.length, 1)
    assert.match(queries[0]!.sql, /title_source = 'user'/)
    assert.match(queries[0]!.sql, /transport = 'chat'/)
    assert.deepEqual(queries[0]!.values, ['自定义标题', 'tth_title_1', 'acct_1', 'user_1'])
  })

  it('chatRepository.renameSession rejects missing or unauthorized chat sessions', async () => {
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: () => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async () => ({ affectedRows: 0 })

    await assert.rejects(
      () => ctx.service.chatRepository.renameSession('tth_missing', 'acct_1', 'user_1', '自定义标题'),
      /Session not found or access denied/
    )
  })

  it('Phase15-T7: updateAgentSessionId scopes WHERE to accountId, gatewayId, userId', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: (sql: string, values?: unknown[]) => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async (sql, values) => {
      queries.push({ sql, values })
      return { affectedRows: 1 }
    }

    await ctx.service.chatRepository.updateAgentSessionId(
      'tth_session_1',
      'agent-session-abc',
      { accountId: 'acct_1', gatewayId: 'gw_1', userId: 'user_1' }
    )

    assert.equal(queries.length, 1)
    assert.match(queries[0]!.sql, /account_id = \?/)
    assert.match(queries[0]!.sql, /gateway_id = \?/)
    assert.match(queries[0]!.sql, /user_id = \?/)
    assert.deepEqual(queries[0]!.values, [ 'agent-session-abc', 'tth_session_1', 'acct_1', 'gw_1', 'user_1' ])
  })
})
