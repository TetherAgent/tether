import type { Command } from 'commander';
import { startGatewayBackground } from '../gateway/supervisor.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('通过 launchd 在后台启动 Gateway（无配置时自动初始化）')
    .action(async () => {
      await startGatewayBackground();
    });
}
