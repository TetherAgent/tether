import { startRelayServer } from './relay.js';
import type { RelayAuthScope } from '@tether/protocol';

const secret = process.env.TETHER_RELAY_SECRET;
const allowLegacySecret = process.env.TETHER_RELAY_ALLOW_LEGACY_SECRET === '1';
const serverUrl = process.env.TETHER_SERVER_URL?.replace(/\/+$/, '');
if (!secret && allowLegacySecret) {
  console.error('TETHER_RELAY_SECRET is required');
  process.exit(1);
}
if (!serverUrl && !allowLegacySecret) {
  console.error('TETHER_SERVER_URL is required when legacy secret mode is disabled');
  process.exit(1);
}

const host = process.env.TETHER_RELAY_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.TETHER_RELAY_PORT ?? '4889', 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('TETHER_RELAY_PORT must be a valid TCP port');
  process.exit(1);
}

const relay = await startRelayServer({
  host,
  port,
  secret: secret ?? '',
  allowLegacySecret,
  validateToken: serverUrl
    ? async (token) => {
        const response = await fetch(`${serverUrl}/api/token/validate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token })
        }).catch(() => undefined);
        if (!response?.ok) {
          return undefined;
        }
        return unwrapServerApiData<RelayAuthScope>(await response.json().catch(() => undefined));
      }
    : undefined
});
console.log(`Tether Relay: http://${host}:${port}`);

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});

function unwrapServerApiData<T>(body: unknown): T | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if ('code' in body) {
    const payload = body as { code?: unknown; data?: unknown };
    return payload.code === 200 && payload.data ? payload.data as T : undefined;
  }
  return body as T;
}
