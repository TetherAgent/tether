// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportAdminAuth from '../../../app/controller/admin-auth';
import ExportApproval from '../../../app/controller/approval';
import ExportAudit from '../../../app/controller/audit';
import ExportAuth from '../../../app/controller/auth';
import ExportChatEvents from '../../../app/controller/chat-events';
import ExportChat from '../../../app/controller/chat';
import ExportGatewayAuth from '../../../app/controller/gateway-auth';
import ExportGateway from '../../../app/controller/gateway';
import ExportHealth from '../../../app/controller/health';
import ExportRuntimeSync from '../../../app/controller/runtime-sync';
import ExportSession from '../../../app/controller/session';
import ExportToken from '../../../app/controller/token';
import ExportAdminAdmins from '../../../app/controller/admin/admins';
import ExportAdminAudit from '../../../app/controller/admin/audit';
import ExportAdminDevices from '../../../app/controller/admin/devices';
import ExportAdminGateways from '../../../app/controller/admin/gateways';
import ExportAdminSessions from '../../../app/controller/admin/sessions';
import ExportAdminUsers from '../../../app/controller/admin/users';

declare module 'egg' {
  interface IController {
    adminAuth: ExportAdminAuth;
    approval: ExportApproval;
    audit: ExportAudit;
    auth: ExportAuth;
    chatEvents: ExportChatEvents;
    chat: ExportChat;
    gatewayAuth: ExportGatewayAuth;
    gateway: ExportGateway;
    health: ExportHealth;
    runtimeSync: ExportRuntimeSync;
    session: ExportSession;
    token: ExportToken;
    admin: {
      admins: ExportAdminAdmins;
      audit: ExportAdminAudit;
      devices: ExportAdminDevices;
      gateways: ExportAdminGateways;
      sessions: ExportAdminSessions;
      users: ExportAdminUsers;
    }
  }
}
