import type { Command } from 'commander';
import { printGatewayStatus } from '../gateway/status.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('打印 Gateway 状态')
    .action(async () => {
      await printGatewayStatus();
    });
}
