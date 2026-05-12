import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as terminal from '../terminal.js';
import { isNodeError } from '../utils/errors.js';

export async function showGatewayLogs(options: { follow?: boolean; stderr?: boolean; stdout?: boolean }): Promise<void> {
  const paths = gatewayLogPaths(options);
  if (options.follow) {
    const child = spawn('tail', ['-f', ...paths], { stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
    return;
  }
  for (const filePath of paths) {
    terminal.section(`==> ${filePath} <==`);
    const text = await readFile(filePath, 'utf8').catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return '';
      }
      throw error;
    });
    const lines = text.trimEnd().split('\n').filter(Boolean).slice(-80);
    console.log(lines.length > 0 ? lines.join('\n') : terminal.color.dim('(暂无日志)'));
  }
}

function gatewayLogPaths(options: { stderr?: boolean; stdout?: boolean }): string[] {
  const logsDir = path.join(os.homedir(), '.tether', 'logs');
  if (options.stderr) {
    return [path.join(logsDir, 'gateway.err.log')];
  }
  if (options.stdout) {
    return [path.join(logsDir, 'gateway.out.log')];
  }
  return [path.join(logsDir, 'gateway.out.log'), path.join(logsDir, 'gateway.err.log')];
}
