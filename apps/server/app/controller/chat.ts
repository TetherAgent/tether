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
    const messages = await ctx.service.chatRepository.listMessages(sessionId, accountId, userId);
    ctx.success({ messages });
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
    const { agentSessionId } = ctx.request.body as { agentSessionId?: string };
    if (!sessionId || !agentSessionId) {
      ctx.throw(400, 'sessionId and agentSessionId are required');
      return;
    }
    await ctx.service.chatRepository.updateAgentSessionId(sessionId, agentSessionId);
    ctx.success({ ok: true });
  }
}
