import { bearerTokenFromHeader } from '../../middleware/auth';
import { verifyToken, type AuthConfig } from '../../service/auth';

type HandshakeLike = {
  auth?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
};

export function authenticateNotificationHandshake(handshake: HandshakeLike, config: AuthConfig) {
  const authToken = typeof handshake.auth?.token === 'string' ? handshake.auth.token : undefined;
  const headerValue = Array.isArray(handshake.headers?.authorization)
    ? handshake.headers?.authorization[0]
    : handshake.headers?.authorization;

  const token = authToken ?? bearerTokenFromHeader(headerValue);
  const payload = verifyToken(token, config);
  if (!['normal_client_access', 'management_access'].includes(payload.tokenClass)) {
    throw new Error('wrong_token_class');
  }
  return payload;
}
