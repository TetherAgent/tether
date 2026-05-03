import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller } = app;

  router.get('/admin/api/dashboard/stats', controller.admin.users.dashboard);
  router.get('/admin/api/users',           controller.admin.users.index);
  router.get('/admin/api/admins',          controller.admin.admins.index);
  router.post('/admin/api/admins',         controller.admin.admins.create);
  router.delete('/admin/api/admins/:id',   controller.admin.admins.destroy);
  router.get('/admin/api/devices',                controller.admin.devices.index);
  router.post('/admin/api/devices/:id/revoke',    controller.admin.devices.revoke);
  router.get('/admin/api/gateways',               controller.admin.gateways.index);
  router.delete('/admin/api/gateways/:id/unlink', controller.admin.gateways.unlink);
  router.get('/admin/api/audit',                  controller.admin.audit.index);
};
