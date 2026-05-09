import { Controller } from 'egg';

type RuntimeSyncScope = {
  accountId: string;
  workspaceId: string;
  gatewayId: string;
};

function parseScope(input: unknown): RuntimeSyncScope | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const scope = input as Record<string, unknown>;
  if (!scope.accountId || !scope.workspaceId || !scope.gatewayId) {
    return undefined;
  }
  return {
    accountId: String(scope.accountId),
    workspaceId: String(scope.workspaceId),
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

  public async conversation(): Promise<void> {
    const { ctx } = this;
    const body = ctx.request.body as Record<string, unknown>;
    const scope = requireScope(ctx, body.scope);
    const sessionId = String(body.sessionId ?? '');
    const turns = Array.isArray(body.turns) ? body.turns : [];
    if (!sessionId) {
      ctx.throw(400, 'Missing sessionId or scope');
    }
    for (const item of turns) {
      const turn = item as Record<string, unknown>;
      await ctx.service.runtimeSyncRepository.upsertChatMessage(
        sessionId,
        Number(turn.turnIndex ?? 0),
        String(turn.role ?? 'assistant'),
        String(turn.content ?? ''),
        turn.tools ? JSON.stringify(turn.tools) : null,
        scope
      );
    }
    const lastTurn = turns[turns.length - 1] as Record<string, unknown> | undefined;
    if (lastTurn) {
      await ctx.service.runtimeSyncRepository.upsertSyncCursor(
        sessionId,
        null,
        Number(lastTurn.turnIndex ?? 0),
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
    if (eventType === 'agent.turn') {
      const payload = (event.payload as Record<string, unknown> | undefined) ?? {};
      await ctx.service.runtimeSyncRepository.upsertChatMessage(
        sessionId,
        Number(payload.turnIndex ?? 0),
        String(payload.role ?? 'assistant'),
        String(payload.content ?? ''),
        payload.tools ? JSON.stringify(payload.tools) : null,
        scope
      );
      await ctx.service.runtimeSyncRepository.upsertSyncCursor(
        sessionId,
        eventId,
        Number(payload.turnIndex ?? 0),
        scope
      );
      ctx.success({ ok: true });
      return;
    }
    await ctx.service.runtimeSyncRepository.upsertRuntimeEvent(
      sessionId,
      eventId,
      eventType,
      event.payload,
      scope
    );
    await ctx.service.runtimeSyncRepository.upsertSyncCursor(sessionId, eventId, null, scope);
    ctx.success({ ok: true });
  }
}
