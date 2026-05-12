import type { Command } from 'commander';
import * as terminal from '../terminal.js';
import { startGatewayBackground, stopGatewayBackground } from '../gateway/supervisor.js';

export function registerRestartCommand(program: Command): void {
  program
    .command('restart')
    .description('通过 launchd 重启 Gateway')
    .action(async () => {
      await stopGatewayBackground();
      await startGatewayBackground();
      terminal.success('Gateway 已重启。');
    });
}
