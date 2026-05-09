import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireManagementAccess = middleware.requireTokenClass({ expected: [ 'management_access' ] });

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
};
