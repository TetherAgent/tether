// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
type AnyClass = new (...args: any[]) => any;
type AnyFunc<T = any> = (...args: any[]) => T;
type CanExportFunc = AnyFunc<Promise<any>> | AnyFunc<IterableIterator<any>>;
type AutoInstanceType<T, U = T extends CanExportFunc ? T : T extends AnyFunc ? ReturnType<T> : T> = U extends AnyClass ? InstanceType<U> : U;
import ExportAdminAuth from '../../../app/service/admin-auth';
import ExportApprovalRepository from '../../../app/service/approvalRepository';
import ExportAudit from '../../../app/service/audit';
import ExportAuditRepository from '../../../app/service/auditRepository';
import ExportAuth from '../../../app/service/auth';
import ExportAuthRepository from '../../../app/service/authRepository';
import ExportChatEventsRepository from '../../../app/service/chatEventsRepository';
import ExportChatRepository from '../../../app/service/chatRepository';
import ExportCliRelease from '../../../app/service/cliRelease';
import ExportDb from '../../../app/service/db';
import ExportGateway from '../../../app/service/gateway';
import ExportGatewayRepository from '../../../app/service/gatewayRepository';
import ExportNotification from '../../../app/service/notification';
import ExportRedis from '../../../app/service/redis';
import ExportRuntime from '../../../app/service/runtime';
import ExportRuntimeSyncRepository from '../../../app/service/runtimeSyncRepository';
import ExportSessionRepository from '../../../app/service/sessionRepository';
import ExportAdminAdmins from '../../../app/service/admin/admins';
import ExportAdminAudit from '../../../app/service/admin/audit';
import ExportAdminDevices from '../../../app/service/admin/devices';
import ExportAdminGateways from '../../../app/service/admin/gateways';
import ExportAdminSessions from '../../../app/service/admin/sessions';
import ExportAdminUsers from '../../../app/service/admin/users';

declare module 'egg' {
  interface IService {
    adminAuth: AutoInstanceType<typeof ExportAdminAuth>;
    approvalRepository: AutoInstanceType<typeof ExportApprovalRepository>;
    audit: AutoInstanceType<typeof ExportAudit>;
    auditRepository: AutoInstanceType<typeof ExportAuditRepository>;
    auth: AutoInstanceType<typeof ExportAuth>;
    authRepository: AutoInstanceType<typeof ExportAuthRepository>;
    chatEventsRepository: AutoInstanceType<typeof ExportChatEventsRepository>;
    chatRepository: AutoInstanceType<typeof ExportChatRepository>;
    cliRelease: AutoInstanceType<typeof ExportCliRelease>;
    db: AutoInstanceType<typeof ExportDb>;
    gateway: AutoInstanceType<typeof ExportGateway>;
    gatewayRepository: AutoInstanceType<typeof ExportGatewayRepository>;
    notification: AutoInstanceType<typeof ExportNotification>;
    redis: AutoInstanceType<typeof ExportRedis>;
    runtime: AutoInstanceType<typeof ExportRuntime>;
    runtimeSyncRepository: AutoInstanceType<typeof ExportRuntimeSyncRepository>;
    sessionRepository: AutoInstanceType<typeof ExportSessionRepository>;
    admin: {
      admins: AutoInstanceType<typeof ExportAdminAdmins>;
      audit: AutoInstanceType<typeof ExportAdminAudit>;
      devices: AutoInstanceType<typeof ExportAdminDevices>;
      gateways: AutoInstanceType<typeof ExportAdminGateways>;
      sessions: AutoInstanceType<typeof ExportAdminSessions>;
      users: AutoInstanceType<typeof ExportAdminUsers>;
    }
  }
}
