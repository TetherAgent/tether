import { Service } from 'egg';

import { createId } from '../utils/id';
import type { AuthRealm, NotificationEvent } from './runtime';

export default class NotificationService extends Service {
  public openNotificationSink(input: {
    accountId: string;
    realm: AuthRealm;
    userId?: string;
    adminUserId?: string;
  }) {
    const { ctx } = this;
    const sink = {
      id: createId('notif'),
      events: [],
      ...input
    };
    ctx.service.runtime.runtimeStore().notificationSinks.set(sink.id, sink);
    return sink;
  }

  public emitNotification(event: NotificationEvent) {
    const { ctx } = this;
    for (const sink of ctx.service.runtime.runtimeStore().notificationSinks.values()) {
      if (sink.accountId !== event.accountId) {
        continue;
      }
      if (sink.realm === 'normal' && sink.userId && event.userId && sink.userId !== event.userId) {
        continue;
      }
      if (sink.realm === 'management' && sink.adminUserId && event.adminUserId && sink.adminUserId !== event.adminUserId) {
        continue;
      }
      sink.events.push(event);
    }
  }

  public notificationEvents(sinkId: string) {
    const { ctx } = this;
    return ctx.service.runtime.runtimeStore().notificationSinks.get(sinkId)?.events ?? [];
  }
}
