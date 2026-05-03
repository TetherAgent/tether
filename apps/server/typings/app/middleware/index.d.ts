// This file is created by egg-ts-helper@2.1.1
// Do not modify this file!!!!!!!!!
/* eslint-disable */

import 'egg';
import ExportError from '../../../app/middleware/error';
import ExportRequireTokenClass from '../../../app/middleware/require-token-class';
import ExportVerifyLogin from '../../../app/middleware/verify-login';

declare module 'egg' {
  interface IMiddleware {
    error: typeof ExportError;
    requireTokenClass: typeof ExportRequireTokenClass;
    verifyLogin: typeof ExportVerifyLogin;
  }
}
