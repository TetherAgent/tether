import type { Command } from 'commander';
import { logoutGateway } from '../auth/gateway-login.js';

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('删除本机 Gateway 登录凭据，不解绑服务端 Gateway')
    .action(async () => {
      await logoutGateway();
    });
}
