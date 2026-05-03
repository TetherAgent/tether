import type { Application } from 'egg';

export default (app: Application): void => {
  const { router, controller } = app;

  router.get('/admin/api/dashboard/stats', controller.admin.users.dashboard);
  router.get('/admin/api/users',           controller.admin.users.index);
  router.get('/admin/api/admins',          controller.admin.admins.index);
  router.post('/admin/api/admins',         controller.admin.admins.create);
  router.delete('/admin/api/admins/:id',   controller.admin.admins.destroy);
  // Plan 03 will add devices/gateways/audit routes
};
