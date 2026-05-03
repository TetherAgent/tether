// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportAdminAuth from '../../../app/controller/admin-auth';
import ExportAudit from '../../../app/controller/audit';
import ExportAuth from '../../../app/controller/auth';
import ExportGateway from '../../../app/controller/gateway';
import ExportHealth from '../../../app/controller/health';
import ExportToken from '../../../app/controller/token';
import ExportAdminAdmins from '../../../app/controller/admin/admins';
import ExportAdminAudit from '../../../app/controller/admin/audit';
import ExportAdminDevices from '../../../app/controller/admin/devices';
import ExportAdminGateways from '../../../app/controller/admin/gateways';
import ExportAdminUsers from '../../../app/controller/admin/users';

declare module 'egg' {
  interface IController {
    adminAuth: ExportAdminAuth;
    audit: ExportAudit;
    auth: ExportAuth;
    gateway: ExportGateway;
    health: ExportHealth;
    token: ExportToken;
    admin: {
      admins: ExportAdminAdmins;
      audit: ExportAdminAudit;
      devices: ExportAdminDevices;
      gateways: ExportAdminGateways;
      users: ExportAdminUsers;
    }
  }
}
