import type { Command } from 'commander';
import { gatewayProfileFromEnv, startGatewayForeground } from '../gateway/supervisor.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve', { hidden: true })
    .description('以前台 daemon 模式运行 Gateway（供 launchd 调用）')
    .action(async () => {
      await startGatewayForeground(gatewayProfileFromEnv());
    });
}
