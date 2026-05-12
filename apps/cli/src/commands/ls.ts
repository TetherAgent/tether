import type { Command } from 'commander';
import { readTetherConfig, resolveRelayConfig } from '@tether/config';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { listSessionsViaRelay } from '../relay/sessions.js';

export function registerLsCommand(program: Command): void {
  program
    .command('ls')
    .description('列出已知 session')
    .action(async () => {
      const relay = resolveRelayConfig({ file: readTetherConfig() });
      if (!relay) {
        throw new Error('当前 Gateway 未配置 Relay，无法列出 session。');
      }
      const auth = await readFreshGatewayAuthState();
      const sessions = await listSessionsViaRelay(relay.url, auth.accessToken).catch((error: unknown) => {
        throw new Error(`无法连接 Relay：${String(error)}`);
      });
      for (const session of sessions) {
        console.log(`${session.id}\t${session.status}\t${session.transport}\t${session.projectPath}`);
      }
    });
}
