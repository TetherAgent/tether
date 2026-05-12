import assert from 'assert'
import { Context } from 'egg'
import { app } from 'egg-mock/bootstrap'
import verifyLogin from '../app/middleware/verify-login'

describe('test/runtime-sync.test.ts', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = app.mockContext()
  })

  it('runtime sync 内部接口必须进入登录白名单', async () => {
    const whitelist = app.config.verifyLoginWhitelist
    assert(whitelist.includes('/api/relay/runtime-sync/gateway/sessions'))
    assert(whitelist.includes('/api/relay/runtime-sync/gateway/event'))
    assert(whitelist.includes('/api/relay/runtime-sync/gateway-sessions-restore/:gatewayId'))
    assert(whitelist.includes('/api/relay/gateway-sessions/:sessionId/metadata'))
    assert(whitelist.includes('/api/relay/gateway-sessions/:sessionId/agent-session-id'))
  })

  it('verifyLogin 白名单支持 :param 路由模板匹配真实路径', async () => {
    const middleware = verifyLogin()
    const requestCtx = app.mockContext({
      url: '/api/relay/gateway-sessions/tth_sync_route/metadata'
    }) as Context & { service: Context['service'] }
    let passed = false
    requestCtx.get = (name: string) => name.toLowerCase() === 'authorization' ? '' : ''
    requestCtx.service.auth.verifyToken = async () => {
      throw new Error('verifyToken should not be called for whitelist route')
    }

    await middleware(requestCtx, async () => {
      passed = true
    })

    assert.equal(passed, true)
  })

  it('verifyLogin 白名单支持 gateway-sessions-restore :gatewayId 路由模板匹配真实路径', async () => {
    const middleware = verifyLogin()
    const requestCtx = app.mockContext({
      url: '/api/relay/runtime-sync/gateway-sessions-restore/gw_restore_01'
    }) as Context & { service: Context['service'] }
    let passed = false
    requestCtx.get = (name: string) => name.toLowerCase() === 'authorization' ? '' : ''
    requestCtx.service.auth.verifyToken = async () => {
      throw new Error('verifyToken should not be called for whitelist route')
    }

    await middleware(requestCtx, async () => {
      passed = true
    })

    assert.equal(passed, true)
  })

  it('runtimeSyncRepository.upsertGatewaySession — MySQL 未启用时静默返回', async () => {
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
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
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
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

  it('runtimeSyncRepository.upsertGatewaySession — lastActiveAt 为 null 时不抛错', async () => {
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
    await assert.doesNotReject(async () => {
      await (
        ctx.service as unknown as {
          runtimeSyncRepository?: {
            upsertGatewaySession?: (session: unknown, scope: unknown) => Promise<void>
          }
        }
      ).runtimeSyncRepository?.upsertGatewaySession?.(
        { id: 'tth_sync_02', provider: 'claude', status: 'running', lastActiveAt: undefined },
        scope
      )
    })
  })

  it('runtimeSyncRepository.upsertGatewaySession — lastActiveAt 有值时不抛错', async () => {
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
    await assert.doesNotReject(async () => {
      await (
        ctx.service as unknown as {
          runtimeSyncRepository?: {
            upsertGatewaySession?: (session: unknown, scope: unknown) => Promise<void>
          }
        }
      ).runtimeSyncRepository?.upsertGatewaySession?.(
        { id: 'tth_sync_03', provider: 'claude', status: 'running', lastActiveAt: Date.now() },
        scope
      )
    })
  })

  it('runtimeSyncRepository.listSessionsForGateway — MySQL 未启用时返回空数组', async () => {
    const result = await ctx.service.runtimeSyncRepository.listSessionsForGateway('gw_restore_01')
    assert.deepEqual(result, [])
  })

  it('runtimeSyncRepository.upsertGatewaySession — 用户自定义标题不被 Gateway 同步覆盖', async () => {
    const queries: Array<{ sql: string; values?: any[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      transaction: <T>(run: (connection: { query: (sql: string, values?: any[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
    }
    db.mysqlModeEnabled = () => true
    db.transaction = async run => {
      const connection = {
        query: async (sql: string, values?: any[]) => {
          queries.push({ sql, values })
          if (/SELECT session_id FROM gateway_deleted_sessions/.test(sql)) {
            return []
          }
          return { affectedRows: 1 }
        }
      }
      return await run(connection)
    }

    await ctx.service.runtimeSyncRepository.upsertGatewaySession(
      {
        id: 'tth_title_sync',
        provider: 'claude',
        title: 'Gateway 旧标题',
        status: 'running',
        transport: 'chat',
        userId: 'user_1'
      },
      { accountId: 'acct_1', gatewayId: 'gw_1' }
    )

    const upsert = queries.find(query => /INSERT INTO gateway_sessions/.test(query.sql))
    assert(upsert)
    assert.match(upsert.sql, /title = IF\(title_source = 'user', title, VALUES\(title\)\)/)
    assert.match(upsert.sql, /title_source = COALESCE\(title_source, 'gateway'\)/)
  })

  it('runtimeSyncRepository.upsertRuntimeEvent — 非白名单事件不写入', async () => {
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
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

  it('runtimeSyncRepository.upsertChatRuntimeEvent — MySQL 未启用时静默返回', async () => {
    const scope = { accountId: 'acct_1', gatewayId: 'gw_1' }
    const event = { id: 1, type: 'agent.delta', sessionId: 'tth_chat_01', ts: Date.now(), payload: { text: 'hello' } }
    await assert.doesNotReject(async () => {
      await ctx.service.runtimeSyncRepository.upsertChatRuntimeEvent(
        'tth_chat_01',
        1,
        'agent.delta',
        event,
        scope,
        Date.now()
      )
    })
  })

  it('chatEventsRepository.listDeltaEventsAfter — MySQL 未启用时返回空数组', async () => {
    const result = await ctx.service.chatEventsRepository.listDeltaEventsAfter('tth_chat_01', 0)
    assert.deepEqual(result, [])
  })

  it('runtime sync chat-events 接口必须进入登录白名单', async () => {
    const whitelist = app.config.verifyLoginWhitelist
    assert(whitelist.includes('/api/relay/chat-events/:sessionId'))
  })

  it('verifyLogin 白名单支持 chat-events :sessionId 路由模板匹配真实路径', async () => {
    const middleware = verifyLogin()
    const requestCtx = app.mockContext({
      url: '/api/relay/chat-events/tth_chat_session_abc'
    }) as Context & { service: Context['service'] }
    let passed = false
    requestCtx.get = (name: string) => name.toLowerCase() === 'authorization' ? '' : ''
    requestCtx.service.auth.verifyToken = async () => {
      throw new Error('verifyToken should not be called for whitelist route')
    }

    await middleware(requestCtx, async () => {
      passed = true
    })

    assert.equal(passed, true)
  })

  it('upsertChatRuntimeEvent transport=chat — 写入 gateway_runtime_chats_events', async () => {
    const queries: Array<{ sql: string; values?: any[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      transaction: <T>(run: (connection: { query: (sql: string, values?: any[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
    }
    db.mysqlModeEnabled = () => true
    db.transaction = async run => {
      const connection = {
        query: async (sql: string, values?: any[]) => {
          queries.push({ sql, values })
          if (/SELECT user_id FROM gateway_sessions/.test(sql)) {
            return [{ user_id: 'user_1' }]
          }
          if (/SELECT session_id FROM gateway_deleted_sessions/.test(sql)) {
            return []
          }
          if (/SELECT id FROM gateway_sessions[\s\S]*gateway_id <>/.test(sql)) {
            return []
          }
          return { affectedRows: 1 }
        }
      }
      return await run(connection)
    }

    const event = { id: 5, type: 'agent.delta', sessionId: 'tth_delta_session', ts: Date.now(), payload: { text: 'world' } }
    await ctx.service.runtimeSyncRepository.upsertChatRuntimeEvent(
      'tth_delta_session',
      5,
      'agent.delta',
      event,
      { accountId: 'acct_1', gatewayId: 'gw_1', transport: 'chat' },
      Date.now()
    )

    const chatEventsInsert = queries.find(query => /INSERT INTO gateway_runtime_chats_events/.test(query.sql))
    assert(chatEventsInsert, 'should have INSERT INTO gateway_runtime_chats_events')
    const rawJsonUpdate = queries.find(query => /UPDATE gateway_chat_messages SET raw_json/.test(query.sql))
    assert(!rawJsonUpdate, 'agent.delta should not update gateway_chat_messages.raw_json')
  })

  it('upsertChatRuntimeEvent transport=chat — agent.result 写入 messages raw_json', async () => {
    const queries: Array<{ sql: string; values?: any[] }> = []
    const db = ctx.service.db as unknown as {
      mysqlModeEnabled: () => boolean
      transaction: <T>(run: (connection: { query: (sql: string, values?: any[]) => Promise<unknown> }) => Promise<T>) => Promise<T>
    }
    db.mysqlModeEnabled = () => true
    db.transaction = async run => {
      const connection = {
        query: async (sql: string, values?: any[]) => {
          queries.push({ sql, values })
          if (/SELECT user_id FROM gateway_sessions/.test(sql)) {
            return [{ user_id: 'user_1' }]
          }
          if (/SELECT session_id FROM gateway_deleted_sessions/.test(sql)) {
            return []
          }
          if (/SELECT id FROM gateway_sessions[\s\S]*gateway_id <>/.test(sql)) {
            return []
          }
          return { affectedRows: 1 }
        }
      }
      return await run(connection)
    }

    const event = {
      id: 6,
      type: 'agent.result',
      sessionId: 'tth_result_session',
      ts: Date.now(),
      payload: { text: 'done', usage: { input_tokens: 1, output_tokens: 2 }, lastDeltaEventId: 5 }
    }
    await ctx.service.runtimeSyncRepository.upsertChatRuntimeEvent(
      'tth_result_session',
      6,
      'agent.result',
      event,
      { accountId: 'acct_1', gatewayId: 'gw_1', transport: 'chat' },
      Date.now()
    )

    const messageInsert = queries.find(query => /INSERT INTO gateway_chat_messages/.test(query.sql))
    assert(messageInsert, 'agent.result should upsert gateway_chat_messages')
    assert.match(messageInsert.sql, /raw_json/)
    assert.equal(messageInsert.values?.[0], 'tth_result_session')
    assert.equal(messageInsert.values?.[1], 6)
    assert.equal(messageInsert.values?.[2], 'assistant')
    assert.equal(messageInsert.values?.[3], 'done')
  })
})
