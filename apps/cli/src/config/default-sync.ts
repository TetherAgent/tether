import { shouldForceLocalConfigSync, syncTetherConfigDefaults } from '@tether/config';
import { readGatewayAuthState, writeGatewayAuthState } from '../auth/gateway-auth-store.js';
import { logger } from '../utils/logger.js';

export async function syncLocalDefaultConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!shouldForceLocalConfigSync()) {
    return;
  }

  const result = await syncTetherConfigDefaults({ env, force: true });
  const auth = await readGatewayAuthState().catch(() => undefined);
  if (auth && auth.serverUrl !== result.serverUrl) {
    await writeGatewayAuthState({ ...auth, serverUrl: result.serverUrl });
  }
  logger.info('config', 'synced default deployment config', {
    deployment: result.deployment,
    serverUrl: result.serverUrl,
    relayUrl: result.relayUrl,
    authServerUrlUpdated: Boolean(auth && auth.serverUrl !== result.serverUrl)
  });
}
