import type { Command } from 'commander';
import { readTetherConfig, resolveRelayConfig } from '@tether/config';
import * as terminal from '../terminal.js';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { stopGatewayBackground } from '../gateway/supervisor.js';
import { type CliSession, listSessionsViaRelay, stopSessionViaRelay } from '../relay/sessions.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .argument('[id]')
    .option('--all', '停止所有运行中的 session')
    .description('停止 Gateway 或运行中的 session')
    .action(async (id: string | undefined, options: { all?: boolean }) => {
      if (!id && !options.all) {
        await stopGatewayBackground();
        terminal.success('Gateway 已停止。');
        return;
      }
      const relay = resolveRelayConfig({ file: readTetherConfig() });
      if (!relay) {
        throw new Error('当前 Gateway 未配置 Relay，无法停止 session。');
      }
      const auth = await readFreshGatewayAuthState();
      if (options.all) {
        const sessions = await listSessionsViaRelay(relay.url, auth.accessToken);
        const ids = runningSessionIds(sessions);
        for (const sessionId of ids) {
          await stopSessionViaRelay(sessionId, relay.url, auth.accessToken);
          console.log(`已关闭 ${sessionId}`);
        }
        console.log(`已关闭 ${ids.length} 个 session。`);
        return;
      }
      if (!id) {
        throw new Error('missing session id; use `tether stop <id>` or `tether stop --all`; use `tether stop` to stop Gateway');
      }
      await stopSessionViaRelay(id, relay.url, auth.accessToken);
      console.log(`已关闭 ${id}`);
    });
}

function runningSessionIds(sessions: CliSession[]): string[] {
  return sessions.filter((session) => session.status === 'running').map((session) => session.id);
}
