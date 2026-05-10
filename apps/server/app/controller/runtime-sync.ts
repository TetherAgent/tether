import { Controller } from 'egg';

type RuntimeSyncScope = {
  accountId: string;
  gatewayId: string;
};

function parseScope(input: unknown): RuntimeSyncScope | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const scope = input as Record<string, unknown>;
  if (!scope.accountId || !scope.gatewayId) {
    return undefined;
  }
  return {
    accountId: String(scope.accountId),
    gatewayId: String(scope.gatewayId)
  };
}

function requireScope(ctx: Controller['ctx'], input: unknown): RuntimeSyncScope {
  const scope = parseScope(input);
  if (scope) {
    return scope;
  }
  return ctx.throw(400, 'Missing scope') as never;
}

function requireEvent(ctx: Controller['ctx'], input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return ctx.throw(400, 'Missing event or scope') as never;
}

export default class RuntimeSyncController extends Controller {
  public async sessions(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const scope = requireScope(ctx, body.scope);
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    for (const item of sessions) {
      const session = item as Record<string, unknown>;
      await ctx.service.runtimeSyncRepository.upsertGatewaySession(
        {
          id: String(session.id ?? ''),
          provider: String(session.provider ?? ''),
          title: typeof session.title === 'string' ? session.title : undefined,
          projectPath: typeof session.projectPath === 'string' ? session.projectPath : undefined,
          agentSessionId: typeof session.agentSessionId === 'string' ? session.agentSessionId : undefined,
          status: String(session.status ?? 'running'),
          transport: typeof session.transport === 'string' ? session.transport : undefined,
          lastActiveAt: typeof session.lastActiveAt === 'number' ? session.lastActiveAt : undefined,
          userId: typeof session.userId === 'string' ? session.userId : undefined
        },
        scope
      );
    }
    ctx.success({ ok: true });
  }

  public async event(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const scope = requireScope(ctx, body.scope);
    const event = requireEvent(ctx, body.event);
    const eventType = String(event.type ?? '');
    const sessionId = String(event.sessionId ?? '');
    const eventId = Number(event.id ?? 0);
    await ctx.service.runtimeSyncRepository.upsertRuntimeEvent(
      sessionId,
      eventId,
      eventType,
      event.payload,
      scope,
      event.ts
    );
    ctx.success({ ok: true });
  }
}
