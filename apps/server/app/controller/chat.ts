import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  workspaceId?: string;
  userId?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; workspaceId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    workspaceId: auth?.workspaceId ?? '',
    userId: auth?.userId ?? ''
  };
}

export default class ChatController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId, userId } = authScope(ctx);
    const sessions = await ctx.service.chatRepository.listChatSessions(accountId, workspaceId, userId);
    ctx.success({ sessions });
  }

  public async messages(): Promise<void> {
    const { ctx } = this;
    const { accountId, workspaceId, userId } = authScope(ctx);
    const { sessionId } = ctx.params as { sessionId: string };
    if (!sessionId) {
      ctx.throw(400, 'sessionId is required');
      return;
    }
    const messages = await ctx.service.chatRepository.listMessages(sessionId, accountId, workspaceId, userId);
    ctx.success({ messages });
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
