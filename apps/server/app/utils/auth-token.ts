import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthScopePayload, AuthTokenClass } from '@tether/core';

export type AuthConfig = {
  [key: string]: unknown;
  jwt?: {
    secret?: string;
  };
};

export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  accessPayload: AuthScopePayload;
  refreshPayload: AuthScopePayload;
};

export type VerifiedToken = AuthScopePayload & {
  realm: 'normal' | 'management' | 'gateway';
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function signValue(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function encodeSegment(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSegment<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

function serverSecret(config: AuthConfig): string {
  const secret = config.jwt?.secret;
  if (!secret) {
    throw new Error('jwt_secret_missing');
  }
  return secret;
}

function issueToken(payload: AuthScopePayload, config: AuthConfig): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = encodeSegment(header);
  const encodedPayload = encodeSegment(payload);
  const signature = signValue(`${encodedHeader}.${encodedPayload}`, serverSecret(config));
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function extractBearerToken(rawToken: string): string {
  return rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
}

export function verifySignedToken(token: string, config: AuthConfig, nowMs: number): VerifiedToken {
  const normalizedToken = extractBearerToken(token);
  const parts = normalizedToken.split('.');
  if (parts.length !== 3) {
    throw new Error('invalid_token');
  }

  const [ encodedHeader, encodedPayload, signature ] = parts;
  const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`, serverSecret(config));
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('invalid_signature');
  }

  const payload = decodeSegment<AuthScopePayload>(encodedPayload);
  if (payload.expiresAt <= nowMs) {
    throw new Error('token_expired');
  }

  const realm =
    payload.tokenClass === 'management_access' || payload.tokenClass === 'management_refresh'
      ? 'management'
      : payload.tokenClass === 'gateway_access' || payload.tokenClass === 'gateway_refresh'
        ? 'gateway'
        : 'normal';

  return {
    ...payload,
    realm
  };
}

export function issueTokenBundle(
  payload: Omit<AuthScopePayload, 'tokenClass' | 'expiresAt' | 'jti'>,
  config: AuthConfig,
  accessTokenClass: AuthTokenClass,
  refreshTokenClass: AuthTokenClass,
  nowMs: number,
  newJti: () => string
): TokenBundle {
  const accessPayload: AuthScopePayload = {
    ...payload,
    tokenClass: accessTokenClass,
    expiresAt: nowMs + THIRTY_DAYS_MS,
    jti: newJti()
  };
  const refreshPayload: AuthScopePayload = {
    ...payload,
    tokenClass: refreshTokenClass,
    expiresAt: nowMs + THIRTY_DAYS_MS,
    jti: newJti()
  };

  return {
    accessToken: issueToken(accessPayload, config),
    refreshToken: issueToken(refreshPayload, config),
    accessPayload,
    refreshPayload
  };
}
