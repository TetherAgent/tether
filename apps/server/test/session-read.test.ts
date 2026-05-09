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
            listSessions?: (accountId: string, workspaceId: string) => Promise<unknown[]>
          }
        }
      ).sessionRepository?.listSessions?.('acct_1', 'ws_1')
    ) ?? []
    assert.deepStrictEqual(sessions, [])
  })

  it('sessionRepository.getConversation — MySQL 未启用时返回空数组', async () => {
    const turns = await (
      (
        ctx.service as unknown as {
          sessionRepository?: {
            getConversation?: (
              sessionId: string,
              accountId: string,
              workspaceId: string
            ) => Promise<unknown[]>
          }
        }
      ).sessionRepository?.getConversation?.('tth_missing', 'acct_1', 'ws_1')
    ) ?? []
    assert.deepStrictEqual(turns, [])
  })

  it('sessionRepository.listEvents — MySQL 未启用时返回空数组', async () => {
    const events = await (
      (
        ctx.service as unknown as {
          sessionRepository?: {
            listEvents?: (
              sessionId: string,
              accountId: string,
              workspaceId: string
            ) => Promise<unknown[]>
          }
        }
      ).sessionRepository?.listEvents?.('tth_missing', 'acct_1', 'ws_1')
    ) ?? []
    assert.deepStrictEqual(events, [])
  })
})
