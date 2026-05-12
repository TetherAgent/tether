import type { Command } from 'commander';
import { performGatewayLogin, type GatewayLoginEnv } from '../auth/gateway-login.js';

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('在浏览器中授权，将本机 Gateway 绑定到远程 Server，并写入 auth.json')
    .option('--server-url <url>', 'Server 基础地址；默认读取 TETHER_SERVER_URL')
    .option('--env <env>', '登录环境：local 或 prod；默认 prod')
    .action(async (options: { serverUrl?: string; env?: string }) => {
      await performGatewayLogin({ ...options, env: parseGatewayLoginEnvOption(options.env) });
    });
}

function parseGatewayLoginEnvOption(env: string | undefined): GatewayLoginEnv | undefined {
  if (!env) {
    return undefined;
  }
  if (env === 'local' || env === 'prod') {
    return env;
  }
  throw new Error(`未知 Gateway 登录环境：${env}`);
}
