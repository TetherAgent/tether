import type { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { readTetherConfig, resolveRelayConfig } from '@tether/config';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { listSessionsViaRelay } from '../relay/sessions.js';
import { color } from '../terminal.js';

// CJK characters occupy 2 terminal columns
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      cp >= 0x1100 && (
        cp <= 0x115F ||
        (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) ||
        (cp >= 0xAC00 && cp <= 0xD7A3) ||
        (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFF01 && cp <= 0xFF60) ||
        (cp >= 0xFFE0 && cp <= 0xFFE6)
      )
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function abbreviatePath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function truncate(s: string, maxVW: number): string {
  let w = 0;
  let i = 0;
  for (const ch of s) {
    const cw = visualWidth(ch);
    if (w + cw > maxVW) return s.slice(0, i - 1) + '…';
    w += cw;
    i += ch.length;
  }
  return s;
}

async function probeRunnerSocket(sessionId: string): Promise<boolean> {
  const socketPath = join(homedir(), '.tether', 'sessions', `${sessionId}.sock`);
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 300);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function translateStatus(s: string): string {
  switch (s) {
    case 'running': return '运行中';
    case 'lost': return '失联';
    case 'stopped': return '已停止';
    case 'failed': return '失败';
    case 'completed': return '完成';
    default: return s;
  }
}

function translateType(t: string): string {
  switch (t) {
    case 'chat': return '对话';
    case 'pty-event-stream': return '终端';
    case 'tmux': return 'tmux';
    default: return t;
  }
}

function statusPaint(s: string): (v: string) => string {
  switch (s) {
    case 'running': return color.green;
    case 'lost':
    case 'failed': return color.red;
    case 'stopped': return color.yellow;
    default: return color.dim;
  }
}

type Cell = { plain: string; display: string };

const textCell = (text: string): Cell => ({ plain: text, display: text });
const dimCell = (text: string): Cell => ({ plain: text, display: color.dim(text) });
const paintCell = (text: string, paint: (s: string) => string): Cell => ({ plain: text, display: paint(text) });

function printTable(headers: string[], rows: Cell[][]): void {
  const colCount = headers.length;
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(visualWidth(headers[i]), ...rows.map(r => visualWidth(r[i]?.plain ?? '')))
  );

  const hr = (l: string, m: string, r: string) =>
    color.dim(l + colWidths.map(w => '─'.repeat(w + 2)).join(m) + r);

  const pipe = color.dim('│');

  const renderRow = (cells: Cell[], allDim = false) =>
    pipe + cells.map((cell, i) => {
      const display = allDim ? color.dim(cell.plain) : cell.display;
      const padding = ' '.repeat(colWidths[i] - visualWidth(cell.plain));
      return ` ${display}${padding} ${pipe}`;
    }).join('');

  console.log(hr('┌', '┬', '┐'));
  console.log(renderRow(headers.map(h => textCell(h)), true));
  console.log(hr('├', '┼', '┤'));
  for (const row of rows) {
    console.log(renderRow(row));
  }
  console.log(hr('└', '┴', '┘'));
}

export function registerLsCommand(program: Command): void {
  program
    .command('ls')
    .description('列出已知 session')
    .action(async () => {
      const relay = resolveRelayConfig({ file: readTetherConfig() });
      if (!relay) {
        throw new Error('当前 Gateway 未配置 Relay，无法列出 session。');
      }
      const auth = await readFreshGatewayAuthState();
      const sessions = await listSessionsViaRelay(relay.url, auth.accessToken).catch((error: unknown) => {
        throw new Error(`无法连接 Relay：${String(error)}`);
      });

      if (sessions.length === 0) {
        console.log(color.dim('没有活跃的 session。'));
        return;
      }

      const ptySessions = sessions.filter(s => s.transport === 'pty-event-stream');
      const localChecks = await Promise.all(
        ptySessions.map(async s => ({ id: s.id, alive: await probeRunnerSocket(s.id) }))
      );
      const localAlive = new Map(localChecks.map(c => [c.id, c.alive]));

      const termWidth = process.stdout.columns || 100;
      const fixedVW = 21 + 2 + 6 + 2 + 4 + 2 + 4 + 2 + 3 * 4; // cols + borders
      const pathMaxVW = Math.max(10, termWidth - fixedVW);

      const rows: Cell[][] = sessions.map(s => {
        const isPty = s.transport === 'pty-event-stream';
        const statusText = translateStatus(s.status);
        const typeText = translateType(s.transport ?? '');
        const path = truncate(abbreviatePath(s.projectPath ?? ''), pathMaxVW);

        let statusCell: Cell;
        if (isPty) {
          const alive = localAlive.get(s.id) ?? false;
          const indicator = alive ? color.green(' ●') : color.red(' ✗');
          statusCell = {
            plain: statusText + (alive ? ' ●' : ' ✗'),
            display: statusPaint(s.status)(statusText) + indicator
          };
        } else {
          statusCell = paintCell(statusText, statusPaint(s.status));
        }

        return [
          textCell(s.id),
          statusCell,
          dimCell(typeText),
          dimCell(path)
        ];
      });

      printTable(['ID', '状态', '类型', '路径'], rows);
    });
}
