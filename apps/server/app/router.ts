import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller } = app;

  router.get('/healthz', controller.health.index);
  router.post('/api/auth/register', controller.auth.register);
  router.post('/api/auth/login', controller.auth.login);
  router.post('/api/auth/refresh', controller.auth.refresh);
  router.post('/api/auth/logout', controller.auth.logout);
  router.get('/api/auth/me', controller.auth.me);

  router.post('/api/admin/auth/register', controller.adminAuth.register);
  router.post('/api/admin/auth/login', controller.adminAuth.login);
  router.post('/api/admin/auth/refresh', controller.adminAuth.refresh);
  router.post('/api/admin/auth/logout', controller.adminAuth.logout);

  router.post('/api/gateway/bind', controller.gateway.bind);
  router.post('/api/gateway/refresh', controller.gateway.refresh);

  router.post('/api/token/revoke', controller.token.revoke);
  router.post('/api/token/validate', controller.token.validate);

  router.post('/api/audit', controller.audit.create);
  router.get('/api/audit', controller.audit.index);
};
