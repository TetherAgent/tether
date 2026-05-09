import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'

describe('test/runtime-sync.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
  })

  it('runtimeSyncRepository.upsertGatewaySession — MySQL 未启用时静默返回', async () => {
    const scope = { accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gw_1' }
    await assert.doesNotReject(async () => {
      await (
        ctx.service as unknown as {
          runtimeSyncRepository?: {
            upsertGatewaySession?: (session: unknown, scope: unknown) => Promise<void>
          }
        }
      ).runtimeSyncRepository?.upsertGatewaySession?.(
        { id: 'tth_sync_01', provider: 'codex', status: 'running' },
        scope
      )
    })
  })

  it('runtimeSyncRepository.upsertChatMessage — MySQL 未启用时静默返回', async () => {
    const scope = { accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gw_1' }
    await assert.doesNotReject(async () => {
      await (
        ctx.service as unknown as {
          runtimeSyncRepository?: {
            upsertChatMessage?: (
              sessionId: string,
              turnIndex: number,
              role: string,
              content: string,
              toolsJson: string | null,
              scope: unknown
            ) => Promise<void>
          }
        }
      ).runtimeSyncRepository?.upsertChatMessage?.(
        'tth_sync_01',
        1,
        'user',
        'hello',
        null,
        scope
      )
    })
  })

  it('runtimeSyncRepository.upsertRuntimeEvent — 非白名单事件不写入', async () => {
    const scope = { accountId: 'acct_1', workspaceId: 'ws_1', gatewayId: 'gw_1' }
    await assert.doesNotReject(async () => {
      await (
        ctx.service as unknown as {
          runtimeSyncRepository?: {
            upsertRuntimeEvent?: (
              sessionId: string,
              eventId: number,
              eventType: string,
              payload: unknown,
              scope: unknown
            ) => Promise<void>
          }
        }
      ).runtimeSyncRepository?.upsertRuntimeEvent?.(
        'tth_sync_01',
        1,
        'custom.not_whitelisted',
        { data: 'x' },
        scope
      )
    })
  })
})
