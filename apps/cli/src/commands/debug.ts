import type { Command } from 'commander';
import { localLanAddress } from '@tether/gateway';
import { runGatewayDoctor } from '../gateway/doctor.js';
import { showGatewayLogs } from '../gateway/logs.js';
import { promptLine, promptRequiredLine } from '../utils/prompt.js';

export function registerDebugCommand(program: Command): void {
  program
    .command('debug')
    .description('打开 Debug 交互菜单')
    .action(async () => {
      await runDebugMenu();
    });
}

async function runDebugMenu(): Promise<void> {
  console.log('Debug 工具');
  console.log('1. 全面诊断环境');
  console.log('2. 查看 Gateway 日志');
  console.log('3. 打印 session URL');
  const answer = await promptLine('请选择 1/2/3: ');
  switch (answer) {
    case '1':
    case 'doctor':
      await runGatewayDoctor();
      return;
    case '2':
    case 'logs': {
      const follow = await promptLine('是否持续跟随日志？y/N: ');
      await showGatewayLogs({ follow: follow === 'y' || follow === 'Y' || follow === 'yes' });
      return;
    }
    case '3':
    case 'url': {
      const id = await promptRequiredLine('session id: ');
      debugPrintSessionUrl(id);
      return;
    }
    default:
      throw new Error(`未知 Debug 选项：${answer || '-'}`);
  }
}

function debugPrintSessionUrl(id: string, host = localLanAddress() ?? '127.0.0.1', port = 4789): void {
  console.log(`http://${host}:${port}/remote/session/${id}`);
}
