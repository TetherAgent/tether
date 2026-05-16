import WebSocket from 'ws';
import type { RawData } from 'ws';
import { readFreshGatewayAuthState } from '../auth/gateway-auth-store.js';
import { relayClientUrl } from '../relay/sessions.js';
import { sleep } from '../utils/sleep.js';
import { logger } from '../utils/logger.js';
import { LOCAL_DETACH_KEY, TERMINAL_RESET_SEQUENCE } from './terminal-state.js';

export type AttachMode = 'control' | 'observe';

export type AttachPtySessionOptions = {
  relayUrl: string;
  mode?: AttachMode;
  reconnect?: boolean;
};

type AttachAttemptResult = {
  status: 'detached' | 'exited' | 'stopped' | 'reconnect' | 'lost';
  latestEventId: number;
  message?: string;
};

export async function attachPtySession(
  id: string,
  options: AttachPtySessionOptions
): Promise<'detached' | 'exited' | 'stopped'> {
  const mode = options.mode ?? 'control';
  const reconnect = options.reconnect !== false;
  let latestEventId = 0;
  let reconnectAttempt = 0;

  while (true) {
    let attempt: AttachAttemptResult;
    try {
      attempt = await attachPtySessionOnce(id, { ...options, mode }, latestEventId);
    } catch (error) {
      if (!reconnect || isAttachAuthError(error)) {
        if (isAttachAuthError(error)) {
          logger.error('attach', 'auth failed', { sessionId: id });
        }
        throw error;
      }
      attempt = {
        status: 'reconnect',
        latestEventId,
        message: error instanceof Error ? error.message : 'Gateway 连接失败'
      };
    }

    latestEventId = Math.max(latestEventId, attempt.latestEventId);
    if (attempt.status === 'exited') {
      return 'exited';
    }
    if (attempt.status === 'stopped') {
      return 'stopped';
    }
    if (attempt.status === 'detached') {
      return 'detached';
    }
    if (attempt.status === 'lost') {
      throw new Error(attempt.message ?? 'session 已失联，无法自动重连');
    }
    if (!reconnect) {
      return 'detached';
    }

    reconnectAttempt += 1;
    const delayMs = reconnectDelayMs(reconnectAttempt);
    const reason = attempt.message ? `：${attempt.message}` : '';
    logger.warn('attach', 'disconnected, reconnecting', { sessionId: id, attempt: reconnectAttempt, error: attempt.message });
    console.error(`\nGateway 连接断开${reason}。${delayMs}ms 后自动重连；当前输入不会发送。按 Ctrl-C 停止 session，按 Ctrl-A 只退出本地 attach。`);
    await sleep(delayMs);
  }
}

async function attachPtySessionOnce(
  id: string,
  options: Required<Pick<AttachPtySessionOptions, 'relayUrl' | 'mode'>>,
  after: number
): Promise<AttachAttemptResult> {
  const { accessToken } = await readFreshGatewayAuthState();
  const ws = new WebSocket(relayClientUrl(options.relayUrl));
  let result: AttachAttemptResult = { status: 'reconnect', latestEventId: after };
  let localDetach = false;
  let localStop = false;
  let stopPromise: Promise<void> | undefined;

  // Auth handshake: open -> client.auth -> client.auth.ok -> client.subscribe
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      ws.removeAllListeners();
      ws.close();
      reject(err);
    };
    ws.once('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    });
    ws.on('message', (raw: RawData) => {
      if (done) return;
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        fail(new Error(`relay auth failed: ${String(frame.message ?? 'unknown')}`));
      } else if (frame.type === 'error') {
        fail(new Error(String(frame.message ?? frame.code ?? 'relay error')));
      } else if (frame.type === 'client.auth.ok') {
        ws.removeAllListeners();
        ws.send(JSON.stringify({
          type: 'client.subscribe',
          sessionId: id,
          mode: options.mode,
          cols: process.stdout.columns || 120,
          rows: process.stdout.rows || 40,
          ...(after > 0 ? { after } : {})
        }));
        done = true;
        resolve();
      }
    });
    ws.once('close', () => fail(new Error('relay 连接在认证前关闭')));
  });

  const previousRawMode = process.stdin.isRaw;
  const wasStdinPaused = process.stdin.isPaused();

  console.error('Attached to Tether PTY session. Press Ctrl-C to stop, Ctrl-A to detach.');
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  let terminalCleanedUp = false;
  const cleanupTerminal = () => {
    if (terminalCleanedUp) {
      return;
    }
    terminalCleanedUp = true;
    process.stdin.off('data', onData);
    process.stdout.off('resize', resize);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(previousRawMode);
    }
    if (wasStdinPaused) {
      process.stdin.pause();
    }
    if (process.stdout.isTTY) {
      process.stdout.write(TERMINAL_RESET_SEQUENCE);
    }
  };
  const stopAttachedSession = () => {
    if (localStop) {
      return;
    }
    localStop = true;
    result = { status: 'stopped', latestEventId: result.latestEventId, message: `Session 已停止：${id}` };
    cleanupTerminal();
    console.error('\n正在停止 Tether session...');
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'client.stop', sessionId: id }));
    }
    stopPromise = new Promise<void>((r) => setTimeout(r, 300))
      .finally(() => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'local stop');
        }
      });
  };
  const signalHandler = (signal: NodeJS.Signals) => {
    if (signal === 'SIGINT') {
      stopAttachedSession();
      return;
    }
    cleanupTerminal();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, `local ${signal}`);
    }
    process.exit(143);
  };

  const resize = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'client.resize',
        sessionId: id,
        cols: process.stdout.columns || 120,
        rows: process.stdout.rows || 40
      }));
    }
  };
  const onData = (chunk: Buffer) => {
    if (chunk.includes(0x03)) {
      stopAttachedSession();
      return;
    }
    if (chunk.includes(LOCAL_DETACH_KEY.charCodeAt(0))) {
      localDetach = true;
      result = { status: 'detached', latestEventId: result.latestEventId, message: `已退出本地 attach，session 继续运行：${id}` };
      ws.send(JSON.stringify({ type: 'client.detach', sessionId: id }));
      ws.close(1000, 'local detach');
      return;
    }
    if (options.mode !== 'observe' && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'client.input', sessionId: id, data: chunk.toString('utf8') }));
    }
  };
  process.stdin.on('data', onData);
  process.stdout.on('resize', resize);
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  process.once('SIGHUP', signalHandler);
  resize();

  await new Promise<void>((resolve, reject) => {
    ws.on('message', (raw: RawData) => {
      const frame = JSON.parse(raw.toString()) as {
        type?: string;
        code?: string;
        data?: unknown;
        latestEventId?: unknown;
        sessionId?: unknown;
        event?: { id?: unknown; type?: string; payload?: { data?: unknown } };
      };
      if (typeof frame.latestEventId === 'number') {
        result.latestEventId = Math.max(result.latestEventId, frame.latestEventId);
      }
      if (typeof frame.event?.id === 'number') {
        result.latestEventId = Math.max(result.latestEventId, frame.event.id);
      }
      if (frame.type === 'replay.output') {
        if (typeof frame.data === 'string') {
          process.stdout.write(frame.data);
        }
        return;
      }
      const event = frame.type === 'gateway.event' || frame.type === 'event'
        ? frame.event
        : undefined;
      if (event?.type === 'terminal.output') {
        const data = event.payload?.data;
        if (typeof data === 'string') {
          process.stdout.write(data);
        }
        return;
      }
      if (event?.type === 'session.exited') {
        result = { status: 'exited', latestEventId: result.latestEventId, message: `Session 已停止：${id}` };
        ws.close();
        return;
      }
      if (frame.type === 'error' && frame.code === 'session_lost') {
        result = {
          status: 'lost',
          latestEventId: result.latestEventId,
          message: `Session 已失联：${id}。Gateway 已恢复，但这个 session runner 不可连接`
        };
        ws.close();
      }
    });
    ws.once('close', (code, reasonBuffer) => {
      if (result.status === 'exited' || result.status === 'stopped' || result.status === 'lost' || localDetach || localStop) {
        resolve();
        return;
      }
      const reason = reasonBuffer.toString();
      result = {
        status: 'reconnect',
        latestEventId: result.latestEventId,
        message: closeReasonMessage(code, reason)
      };
      resolve();
    });
    ws.once('error', reject);
  }).finally(() => {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
    process.off('SIGHUP', signalHandler);
    cleanupTerminal();
  });
  await stopPromise;
  if ((result.status === 'detached' || result.status === 'exited' || result.status === 'stopped' || result.status === 'lost') && result.message) {
    console.error(`\n${result.message}`);
  }
  return result;
}

export function closeReasonMessage(code: number, reason: string): string {
  if (reason) {
    return `WebSocket ${code} ${reason}`;
  }
  return `WebSocket ${code}`;
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(500 * attempt, 5000);
}

export function isAttachAuthError(error: unknown): boolean {
  return error instanceof Error && /relay auth failed/.test(error.message);
}
