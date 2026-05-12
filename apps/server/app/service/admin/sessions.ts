import { Service } from 'egg';

export default class AdminSessionsService extends Service {
  public async listAdminSessions(
    page: number,
    limit: number,
    filters: { userId?: string; gatewayId?: string; transport?: string; status?: string } = {}
  ) {
    return this.ctx.service.sessionRepository.adminListSessions(page, limit, filters);
  }

  public async getAdminSession(sessionId: string) {
    return this.ctx.service.sessionRepository.adminGetSession(sessionId);
  }

  public async listAdminChatMessages(sessionId: string, page: number, limit: number) {
    return this.ctx.service.sessionRepository.adminListChatMessages(sessionId, page, limit);
  }

  public async listAdminRuntimeEvents(sessionId: string, page: number, limit: number) {
    return this.ctx.service.sessionRepository.adminListRuntimeEvents(sessionId, page, limit);
  }

  public async listAdminChatEvents(sessionId: string, page: number, limit: number) {
    return this.ctx.service.sessionRepository.adminListChatEvents(sessionId, page, limit);
  }
}
