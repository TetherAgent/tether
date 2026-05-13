import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/session-read.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
  })

  it('sessionRepository.listSessions — MySQL 未启用时返回空数组', async () => {
    const sessions = await (
      (
        ctx.service as unknown as {
          sessionRepository?: {
            listSessions?: (accountId: string) => Promise<unknown[]>
          }
        }
      ).sessionRepository?.listSessions?.('acct_1')
    ) ?? []
    assert.deepStrictEqual(sessions, [])
  })

  it('sessionRepository.listEvents — MySQL 未启用时返回空数组', async () => {
    const events = await (
      (
        ctx.service as unknown as {
          sessionRepository?: {
            listEvents?: (
              sessionId: string,
              accountId: string
            ) => Promise<unknown[]>
          }
        }
      ).sessionRepository?.listEvents?.('tth_missing', 'acct_1')
    ) ?? []
    assert.deepStrictEqual(events, [])
  })

  it('sessionRepository.renameSessionTitle marks user title without transport restriction', async () => {
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

    await ctx.service.sessionRepository.renameSessionTitle('tth_term_1', 'acct_1', 'user_1', 'Terminal 标题')

    assert.equal(queries.length, 1)
    assert.match(queries[0]!.sql, /title_source = 'user'/)
    assert.doesNotMatch(queries[0]!.sql, /transport = 'chat'/)
    assert.deepEqual(queries[0]!.values, ['Terminal 标题', 'tth_term_1', 'acct_1', 'user_1'])
  })

  it('sessionRepository.archiveSession rejects running terminal sessions', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: (sql: string, values?: unknown[]) => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async (sql, values) => {
      queries.push({ sql, values })
      return [{ id: 'tth_term_1', status: 'running', transport: 'pty-event-stream' }]
    }

    await assert.rejects(
      () => ctx.service.sessionRepository.archiveSession('tth_term_1', 'acct_1', 'user_1'),
      /Running terminal sessions must be stopped before archive/
    )
    assert.equal(queries.length, 1)
    assert.match(queries[0]!.sql, /SELECT id, status, transport FROM gateway_sessions/)
  })

  it('sessionRepository.archiveSession soft hides stopped terminal and keeps replay tables untouched', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      query: (sql: string, values?: unknown[]) => Promise<unknown>
    }
    db.mysqlModeEnabled = () => true
    db.query = async (sql, values) => {
      queries.push({ sql, values })
      if (/SELECT id, status, transport FROM gateway_sessions/.test(sql)) {
        return [{ id: 'tth_term_1', status: 'completed', transport: 'pty-event-stream' }]
      }
      return { affectedRows: 1 }
    }

    await ctx.service.sessionRepository.archiveSession('tth_term_1', 'acct_1', 'user_1')

    assert.equal(queries.length, 2)
    assert.match(queries[1]!.sql, /SET archived_at = COALESCE\(archived_at, CURRENT_TIMESTAMP\)/)
    assert.doesNotMatch(queries.map(query => query.sql).join('\n'), /DELETE FROM gateway_runtime_events/)
    assert.doesNotMatch(queries.map(query => query.sql).join('\n'), /DELETE FROM gateway_sessions/)
  })
})
