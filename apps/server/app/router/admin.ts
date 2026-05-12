import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireManagementAccess = middleware.requireTokenClass({ expected: [ 'management_access' ] });

  // 管理员认证
  router.post('/api/admin/auth/register', controller.adminAuth.register);  // 管理员注册
  router.post('/api/admin/auth/login', controller.adminAuth.login);        // 管理员登录
  router.post('/api/admin/auth/refresh', controller.adminAuth.refresh);    // 管理员刷新 Token
  router.post('/api/admin/auth/logout', controller.adminAuth.logout);      // 管理员登出

  router.get('/api/admin/dashboard/stats', requireManagementAccess, controller.admin.users.dashboard);
  router.get('/api/admin/users', requireManagementAccess, controller.admin.users.index);
  router.get('/api/admin/admins', requireManagementAccess, controller.admin.admins.index);
  router.post('/api/admin/admins', requireManagementAccess, controller.admin.admins.create);
  router.delete('/api/admin/admins/:id', requireManagementAccess, controller.admin.admins.destroy);
  router.get('/api/admin/devices', requireManagementAccess, controller.admin.devices.index);
  router.post('/api/admin/devices/:id/revoke', requireManagementAccess, controller.admin.devices.revoke);
  router.get('/api/admin/gateways', requireManagementAccess, controller.admin.gateways.index);
  router.delete('/api/admin/gateways/:id/unlink', requireManagementAccess, controller.admin.gateways.unlink);
  router.get('/api/admin/audit', requireManagementAccess, controller.admin.audit.index);

  router.get('/api/admin/sessions', requireManagementAccess, controller.admin.sessions.index);
  router.get('/api/admin/sessions/:id', requireManagementAccess, controller.admin.sessions.show);
  router.get('/api/admin/sessions/:id/messages', requireManagementAccess, controller.admin.sessions.messages);
  router.get('/api/admin/sessions/:id/events', requireManagementAccess, controller.admin.sessions.events);
  router.get('/api/admin/sessions/:id/chat-events', requireManagementAccess, controller.admin.sessions.chatEvents);
};
