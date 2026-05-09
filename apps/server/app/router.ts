import type { Application } from 'egg';
import adminRouter from './router/admin';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireNormalAccess = middleware.requireTokenClass({ expected: [ 'normal_client_access' ] });
  const requireAnyAccess = middleware.requireTokenClass({
    expected: [ 'management_access', 'normal_client_access', 'gateway_access' ]
  });
  const requireRuntimeSyncSecret = middleware.requireRuntimeSyncSecret();

  // 健康检查
  router.get('/healthz', controller.health.index);

  // 普通用户认证
  router.post('/api/server/auth/register', controller.auth.register);
  router.post('/api/server/auth/login', controller.auth.login);
  router.post('/api/server/auth/refresh', controller.auth.refresh);
  router.post('/api/server/auth/logout', controller.auth.logout);
  router.get('/api/server/auth/me', requireNormalAccess, controller.auth.me);

  // 管理员认证
  router.post('/api/admin/auth/register', controller.adminAuth.register);
  router.post('/api/admin/auth/login', controller.adminAuth.login);
  router.post('/api/admin/auth/refresh', controller.adminAuth.refresh);
  router.post('/api/admin/auth/logout', controller.adminAuth.logout);

  // Gateway 绑定与凭据刷新（CLI 调用）
  router.post('/api/relay/gateway/bind', controller.gateway.bind);
  router.post('/api/relay/gateway/refresh', controller.gateway.refresh);

  // Token 管理
  router.post('/api/server/token/revoke', requireAnyAccess, controller.token.revoke);
  router.post('/api/server/token/validate', controller.token.validate);

  // 审计日志
  router.post('/api/server/audit', controller.audit.create);
  router.get('/api/server/audit', controller.audit.index);

  // Relay → Server 运行时同步（仅 127.0.0.1 可访问，nginx 层拦截）
  router.post('/api/relay/runtime-sync/gateway/sessions', requireRuntimeSyncSecret, controller.runtimeSync.sessions);
  router.post('/api/relay/runtime-sync/gateway/conversation', requireRuntimeSyncSecret, controller.runtimeSync.conversation);
  router.post('/api/relay/runtime-sync/gateway/event', requireRuntimeSyncSecret, controller.runtimeSync.event);

  // Session 数据读取（前端只读，写操作走 WebSocket）
  router.get('/api/server/sessions', requireNormalAccess, controller.session.list);
  router.get('/api/server/sessions/:id/conversation', requireNormalAccess, controller.session.conversation);
  router.get('/api/server/sessions/:id/events', requireNormalAccess, controller.session.events);

  // 管理后台接口
  adminRouter(app);
};
