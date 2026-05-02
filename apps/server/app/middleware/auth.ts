import type { AuthTokenClass } from '@tether/core';

import { verifyToken, type AuthConfig } from '../service/auth';

export function bearerTokenFromHeader(headerValue: string | undefined): string {
  if (!headerValue || !headerValue.startsWith('Bearer ')) {
    throw new Error('missing_token');
  }
  return headerValue.slice(7).trim();
}

export function requireTokenClass(headerValue: string | undefined, config: AuthConfig, expected: AuthTokenClass[]) {
  const token = bearerTokenFromHeader(headerValue);
  const payload = verifyToken(token, config);
  if (!expected.includes(payload.tokenClass)) {
    throw new Error('wrong_token_class');
  }
  return payload;
}
