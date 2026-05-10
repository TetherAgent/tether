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
})
