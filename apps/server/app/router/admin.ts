import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller, middleware } = app;
  const verifyManagementLogin = middleware.verifyLogin({ expected: [ 'management_access' ] });

  router.get('/admin/api/dashboard/stats', verifyManagementLogin, controller.admin.users.dashboard);
  router.get('/admin/api/users', verifyManagementLogin, controller.admin.users.index);
  router.get('/admin/api/admins', verifyManagementLogin, controller.admin.admins.index);
  router.post('/admin/api/admins', verifyManagementLogin, controller.admin.admins.create);
  router.delete('/admin/api/admins/:id', verifyManagementLogin, controller.admin.admins.destroy);
  router.get('/admin/api/devices', verifyManagementLogin, controller.admin.devices.index);
  router.post('/admin/api/devices/:id/revoke', verifyManagementLogin, controller.admin.devices.revoke);
  router.get('/admin/api/gateways', verifyManagementLogin, controller.admin.gateways.index);
  router.delete('/admin/api/gateways/:id/unlink', verifyManagementLogin, controller.admin.gateways.unlink);
  router.get('/admin/api/audit', verifyManagementLogin, controller.admin.audit.index);
};
