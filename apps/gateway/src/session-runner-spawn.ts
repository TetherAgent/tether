import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_RUNTIME_FLAGS } from './node-flags.js';
import { runnerSocketPath, type CreateSessionRunnerOptions } from './session-runner.js';
import { SessionRunnerClient } from './session-runner-client.js';
import type { Session } from './types.js';

export type SpawnSessionRunnerOptions = {
  options: CreateSessionRunnerOptions;
  timeoutMs?: number;
};

type RunnerPingResult = {
  sessionId?: string;
  session?: Session | null;
};

export async function spawnSessionRunnerProcess({ options, timeoutMs = 5000 }: SpawnSessionRunnerOptions): Promise<Session> {
  const entry = resolveRunnerEntry();
  const payload = Buffer.from(JSON.stringify({ options }), 'utf8').toString('base64url');
  const child = spawn(process.execPath, [...NODE_RUNTIME_FLAGS, ...runnerExecArgv(), entry, payload], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();

  const client = new SessionRunnerClient({
    socketPath: runnerSocketPath(options.id, options.socketDir),
    requestTimeoutMs: timeoutMs
  });
  try {
    const result = await waitForRunner(client, options.id, timeoutMs);
    if (!result.session) {
      throw new Error(`runner started but session metadata was unavailable: ${options.id}`);
    }
    return result.session;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function runnerExecArgv(): string[] {
  return process.execArgv.filter((arg) => arg !== '--test');
}

function resolveRunnerEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dev: here = apps/gateway/src/, entry = ./session-runner-process.ts
  // prod (tsup bundle): here = dist/cli/, entry = ../gateway/session-runner-process.js
  const candidates = [
    path.join(here, 'session-runner-process.ts'),
    path.join(here, '..', 'gateway', 'session-runner-process.js')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`session-runner entry 路径未找到，候选：${candidates.join(', ')}`);
}

async function waitForRunner(client: SessionRunnerClient, sessionId: string, timeoutMs: number): Promise<RunnerPingResult> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = (await client.ping()) as RunnerPingResult | undefined;
      if (result?.sessionId === sessionId) {
        return result;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`timed out waiting for session runner: ${sessionId}`);
}
