import type { Application } from 'egg';
import adminRouter from './router/admin';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireNormalAccess = middleware.requireTokenClass({ expected: [ 'normal_client_access' ] });
  const requireAnyAccess = middleware.requireTokenClass({
    expected: [ 'management_access', 'normal_client_access', 'gateway_access' ]
  });
  const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

  router.get('/healthz', controller.health.index);

  router.post('/api/server/auth/register', controller.auth.register);
  router.post('/api/server/auth/login', controller.auth.login);
  router.post('/api/server/auth/refresh', controller.auth.refresh);
  router.post('/api/server/auth/logout', controller.auth.logout);
  router.get('/api/server/auth/me', requireNormalAccess, controller.auth.me);

  router.post('/api/admin/auth/register', controller.adminAuth.register);
  router.post('/api/admin/auth/login', controller.adminAuth.login);
  router.post('/api/admin/auth/refresh', controller.adminAuth.refresh);
  router.post('/api/admin/auth/logout', controller.adminAuth.logout);

  router.post('/api/relay/gateway/bind', controller.gateway.bind);
  router.post('/api/relay/gateway/refresh', controller.gateway.refresh);

  router.post('/api/server/token/revoke', requireAnyAccess, controller.token.revoke);
  router.post('/api/server/token/validate', controller.token.validate);

  router.post('/api/server/audit', controller.audit.create);
  router.get('/api/server/audit', controller.audit.index);

  router.post('/api/relay/runtime-sync/gateway/sessions', requireRuntimeSyncSecret, controller.runtimeSync.sessions);
  router.post('/api/relay/runtime-sync/gateway/conversation', requireRuntimeSyncSecret, controller.runtimeSync.conversation);
  router.post('/api/relay/runtime-sync/gateway/event', requireRuntimeSyncSecret, controller.runtimeSync.event);

  router.get('/api/server/sessions', requireNormalAccess, controller.session.list);
  router.get('/api/server/sessions/:id/conversation', requireNormalAccess, controller.session.conversation);
  router.get('/api/server/sessions/:id/events', requireNormalAccess, controller.session.events);

  adminRouter(app);
};
