// Node 版本兜底检查。launcher (M3) 会在更早阶段检查；此处兜底用于直接通过 tsx 跑源码的场景。
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Tether 需要 Node.js 22.13 或更高版本，当前 ${process.versions.node}`);
    console.error('建议：nvm install 22 && nvm use 22');
    process.exit(1);
  }
}

import { Command } from 'commander';
import { initLogger, logger } from './utils/logger.js';
import { registerDebugCommand } from './commands/debug.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand } from './commands/logout.js';
import { registerLsCommand } from './commands/ls.js';
import { registerRestartCommand } from './commands/restart.js';
import { registerRunCommand } from './commands/run.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStartCommand } from './commands/start.js';
import { registerStatusCommand } from './commands/status.js';
import { registerStopCommand } from './commands/stop.js';
import { resolvePackageVersion } from './utils/package-version.js';

const program = new Command();
const TETHER_VERSION = resolvePackageVersion(import.meta.url, '@tether-labs/cli') ?? '0.0.0-dev';

initLogger();

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

program
  .name('tether')
  .description('跨设备接管同一个 CLI Agent 会话的控制台')
  .version(TETHER_VERSION, '-V, --version', '输出版本号')
  .helpOption('-h, --help', '显示帮助')
  .addHelpCommand('help [command]', '显示指定命令的帮助');

registerLoginCommand(program);
registerLogoutCommand(program);
registerStartCommand(program);
registerServeCommand(program);
registerRestartCommand(program);
registerStatusCommand(program);
registerDebugCommand(program);
registerRunCommand(program);
registerLsCommand(program);
registerStopCommand(program);

const cmd = process.argv.slice(2).find(a => !a.startsWith('-')) ?? 'unknown';
logger.info('cmd', 'command invoked', { command: cmd });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('cmd', 'command failed', { command: cmd, error: message });
  console.error(message);
  process.exitCode = 1;
});
