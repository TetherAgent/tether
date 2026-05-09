// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportError from '../../../app/middleware/error';
import ExportRequireRuntimeSyncSecret from '../../../app/middleware/require-runtime-sync-secret';
import ExportRequireTokenClass from '../../../app/middleware/require-token-class';
import ExportVerifyLogin from '../../../app/middleware/verify-login';

declare module 'egg' {
  interface IMiddleware {
    error: typeof ExportError;
    requireRuntimeSyncSecret: typeof ExportRequireRuntimeSyncSecret;
    requireTokenClass: typeof ExportRequireTokenClass;
    verifyLogin: typeof ExportVerifyLogin;
  }
}
