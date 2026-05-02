import {
  notificationEventsForSink,
  registerNotificationSink,
  runtimeStore,
  type AuthRealm,
  type NotificationEvent
} from './runtime';

export function openNotificationSink(input: {
  accountId: string;
  realm: AuthRealm;
  userId?: string;
  adminUserId?: string;
}) {
  return registerNotificationSink(input);
}

export function emitNotification(event: NotificationEvent) {
  for (const sink of runtimeStore().notificationSinks.values()) {
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

export function notificationEvents(sinkId: string) {
  return notificationEventsForSink(sinkId);
}
