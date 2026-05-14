import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  userId?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    userId: auth?.userId ?? ''
  };
}

export default class ChatController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const sessions = await ctx.service.chatRepository.listChatSessions(accountId, userId);
    ctx.success({ sessions });
  }

  public async messages(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    if (!sessionId) {
      ctx.throw(400, 'sessionId is required');
      return;
    }
    const { messages, snapshotEventSeq } = await ctx.service.chatRepository.listMessages(sessionId, accountId, userId);
    ctx.success({ messages, snapshotEventSeq, lastEventId: snapshotEventSeq });
  }

  public async events(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    if (!sessionId) {
      ctx.throw(400, 'sessionId is required');
      return;
    }
    const after = Number(ctx.query['after'] ?? 0);
    const events = await ctx.service.chatEventsRepository.listClientEventsAfter(sessionId, after, { accountId, userId });
    ctx.success({ events });
  }

  public async renameSession(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    const { title } = ctx.request.body as { title?: string };
    if (!sessionId || typeof title !== 'string' || !title.trim()) {
      ctx.throw(400, 'sessionId and title are required');
      return;
    }
    await ctx.service.chatRepository.renameSession(sessionId, accountId, userId, title.trim());
    ctx.success({ ok: true });
  }

  public async deleteSession(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    if (!sessionId) {
      ctx.throw(400, 'sessionId is required');
      return;
    }
    await ctx.service.chatRepository.deleteSession(sessionId, accountId, userId);
    ctx.success({ ok: true });
  }

  public async updateAgentSessionId(): Promise<void> {
    const { ctx } = this;
    const { sessionId } = ctx.params as { sessionId: string };
    const body = ctx.request.body as Record<string, unknown>;
    const agentSessionId = typeof body.agentSessionId === 'string' ? body.agentSessionId : '';
    const scopeRaw = body.scope as Record<string, unknown> | undefined;
    if (!sessionId || !agentSessionId) {
      ctx.throw(400, 'sessionId and agentSessionId are required');
      return;
    }
    if (!scopeRaw?.accountId || !scopeRaw?.gatewayId || !scopeRaw?.userId) {
      ctx.throw(400, 'Missing scope: accountId, gatewayId, userId required');
      return;
    }
    const scope = {
      accountId: String(scopeRaw.accountId),
      gatewayId: String(scopeRaw.gatewayId),
      userId: String(scopeRaw.userId)
    };
    await ctx.service.chatRepository.updateAgentSessionId(sessionId, agentSessionId, scope);
    ctx.success({ ok: true });
  }
}
