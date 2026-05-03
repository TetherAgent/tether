import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const requireManagementAccess = middleware.requireTokenClass({ expected: [ 'management_access' ] });

  router.get('/admin/api/dashboard/stats', requireManagementAccess, controller.admin.users.dashboard);
  router.get('/admin/api/users', requireManagementAccess, controller.admin.users.index);
  router.get('/admin/api/admins', requireManagementAccess, controller.admin.admins.index);
  router.post('/admin/api/admins', requireManagementAccess, controller.admin.admins.create);
  router.delete('/admin/api/admins/:id', requireManagementAccess, controller.admin.admins.destroy);
  router.get('/admin/api/devices', requireManagementAccess, controller.admin.devices.index);
  router.post('/admin/api/devices/:id/revoke', requireManagementAccess, controller.admin.devices.revoke);
  router.get('/admin/api/gateways', requireManagementAccess, controller.admin.gateways.index);
  router.delete('/admin/api/gateways/:id/unlink', requireManagementAccess, controller.admin.gateways.unlink);
  router.get('/admin/api/audit', requireManagementAccess, controller.admin.audit.index);
};
