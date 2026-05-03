import { requireTokenClass } from './auth';
import type { AuthConfig } from '../service/auth';

export function requireManagementToken(
  headerValue: string | undefined,
  config: AuthConfig
) {
  return requireTokenClass(headerValue, config, ['management_access']);
}
