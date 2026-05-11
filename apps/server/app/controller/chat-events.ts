import { Controller } from 'egg';

export default class ChatEventsController extends Controller {
  public async list(): Promise<void> {
    const { ctx } = this;
    const sessionId = String(ctx.params['sessionId'] ?? '');
    if (!sessionId) {
      ctx.throw(400, 'Missing sessionId');
      return;
    }
    const after = Number(ctx.query['after'] ?? 0);
    const events = await ctx.service.chatEventsRepository.listDeltaEventsAfter(sessionId, after);
    ctx.success({ events });
  }
}
