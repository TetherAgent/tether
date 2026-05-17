import { Controller } from 'egg';

type AuthScope = {
  accountId?: string;
  userId?: string;
};

type RuntimeSyncScope = {
  accountId: string;
  gatewayId: string;
  transport?: string;
};

function authScope(ctx: Controller['ctx']): { accountId: string; userId: string } {
  const auth = ctx.state.auth as AuthScope | undefined;
  return {
    accountId: auth?.accountId ?? '',
    userId: auth?.userId ?? ''
  };
}

function parseScope(input: unknown): RuntimeSyncScope | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const scope = input as Record<string, unknown>;
  if (!scope.accountId || !scope.gatewayId) return undefined;
  return {
    accountId: String(scope.accountId),
    gatewayId: String(scope.gatewayId),
    transport: typeof scope.transport === 'string' ? scope.transport : undefined
  };
}

export default class ApprovalController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const status = typeof ctx.query.status === 'string' && ctx.query.status.trim()
      ? ctx.query.status.trim()
      : 'pending';
    const limit = Math.min(Number(ctx.query.limit) || 100, 200);
    const approvals = await ctx.service.approvalRepository.listForUser(accountId, userId, status, limit);
    ctx.success({ approvals });
  }

  public async decide(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const { id } = ctx.params as { id: string };
    const body = ctx.request.body as Record<string, unknown>;
    const decision = body.decision === 'allow' || body.decision === 'deny' ? body.decision : undefined;
    if (!id || !decision) {
      ctx.throw(400, 'approval id and decision are required');
      return;
    }
    const approval = await ctx.service.approvalRepository.decide({
      approvalId: id,
      accountId,
      userId,
      decision
    });
    ctx.success({ approval });
  }

  public async decideByRequest(): Promise<void> {
    const { ctx } = this;
    const { accountId, userId } = authScope(ctx);
    const body = ctx.request.body as Record<string, unknown>;
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const decision = body.decision === 'allow' || body.decision === 'deny' ? body.decision : undefined;
    if (!sessionId || !requestId || !decision) {
      ctx.throw(400, 'sessionId, requestId, and decision are required');
      return;
    }
    const approval = await ctx.service.approvalRepository.decideByRequest({
      sessionId,
      requestId,
      accountId,
      userId,
      decision
    });
    ctx.success({ approval });
  }

  public async fromEvent(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const event = body.event && typeof body.event === 'object' ? body.event as Record<string, unknown> : undefined;
    const scope = parseScope(body.scope);
    const gatewayId = typeof body.gatewayId === 'string' ? body.gatewayId : scope?.gatewayId;
    if (!event || !scope || !gatewayId) {
      ctx.throw(400, 'event, gatewayId, and scope are required');
      return;
    }
    const approval = await ctx.service.approvalRepository.upsertFromRuntimeEvent({
      gatewayId,
      event,
      scope
    });
    ctx.success({ approval });
  }
}
