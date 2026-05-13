import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { latestNewCodexSessionId, readCodexSessionId, SessionRunner, runnerSocketPath } from '../src/pty/session-runner.js';
import { SessionRunnerClient } from '../src/pty/session-runner-client.js';
import { spawnSessionRunnerProcess } from '../src/pty/session-runner-spawn.js';

function tempRunnerFixture(): { dir: string; socketDir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-runner-'));
  return {
    dir,
    socketDir: path.join(dir, 'sessions'),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('runner socket path rejects unsafe session ids', () => {
  const { socketDir, cleanup } = tempRunnerFixture();
  try {
    assert.throws(() => runnerSocketPath('../bad', socketDir), /invalid runner session id/);
    assert.throws(() => runnerSocketPath('tth_bad/child', socketDir), /invalid runner session id/);
    assert.equal(runnerSocketPath('tth_safe_123', socketDir), path.join(socketDir, 'tth_safe_123.sock'));
  } finally {
    cleanup();
  }
});

test('reads Codex session id from session jsonl metadata', () => {
  const { dir, cleanup } = tempRunnerFixture();
  try {
    const sessionPath = path.join(dir, 'rollout-2026-05-06T15-35-25-019dfc36-896b-71f0-91d4-2935af9e4fc4.jsonl');
    writeFileSync(
      sessionPath,
      `${JSON.stringify({
        timestamp: '2026-05-06T07:35:25.814Z',
        type: 'session_meta',
        payload: { id: '019dfc36-896b-71f0-91d4-2935af9e4fc4' }
      })}\n`
    );

    assert.equal(readCodexSessionId(sessionPath), '019dfc36-896b-71f0-91d4-2935af9e4fc4');
  } finally {
    cleanup();
  }
});

test('detects newly created Codex session jsonl files', () => {
  const { dir, cleanup } = tempRunnerFixture();
  try {
    const sessionsDir = path.join(dir, '.codex', 'sessions', '2026', '05', '06');
    mkdirSync(sessionsDir, { recursive: true });
    const existing = path.join(sessionsDir, 'rollout-2026-05-06T12-42-22-019dfb98-17d0-7343-acc0-3734ff4d8a82.jsonl');
    const created = path.join(sessionsDir, 'rollout-2026-05-06T15-35-25-019dfc36-896b-71f0-91d4-2935af9e4fc4.jsonl');
    writeFileSync(existing, `${JSON.stringify({ type: 'session_meta', payload: { id: '019dfb98-17d0-7343-acc0-3734ff4d8a82' } })}\n`);
    const before = new Set([`codex-file:${existing}`]);
    writeFileSync(created, `${JSON.stringify({ type: 'session_meta', payload: { id: '019dfc36-896b-71f0-91d4-2935af9e4fc4' } })}\n`);

    assert.equal(latestNewCodexSessionId(before, dir), '019dfc36-896b-71f0-91d4-2935af9e4fc4');
  } finally {
    cleanup();
  }
});

test('runner refuses to unlink non-socket paths', async () => {
  const { socketDir, cleanup } = tempRunnerFixture();
  const sessionId = 'tth_runner_blocked';
  mkdirSync(socketDir, { recursive: true });
  writeFileSync(runnerSocketPath(sessionId, socketDir), 'not a socket');
  const runner = new SessionRunner({
    id: sessionId,
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    socketDir
  });
  try {
    await assert.rejects(() => runner.start(), /refusing to unlink non-socket runner path/);
  } finally {
    await runner.close().catch(() => undefined);
    cleanup();
  }
});

test('runner client can ping, write, subscribe events and stop', async () => {
  const { socketDir, cleanup } = tempRunnerFixture();
  const runner = new SessionRunner({
    id: 'tth_runner_test',
    provider: 'codex',
    command: '/bin/cat',
    projectPath: process.cwd(),
    cols: 80,
    rows: 24,
    socketDir
  });
  let client: SessionRunnerClient | undefined;
  try {
    const session = await runner.start();
    assert.equal(session.runnerSocketPath, runner.socketPath);

    client = new SessionRunnerClient({ socketPath: runner.socketPath });
    const ping = await client.ping() as { sessionId?: string; session?: { runnerPid?: number } };
    assert.equal(ping?.sessionId, session.id);
    assert.equal(ping?.session?.runnerPid, process.pid);

    const eventIds: number[] = [];
    const eventTypes: string[] = [];
    const unsubscribe = await client.subscribeEvents((frame) => {
      eventIds.push(frame.eventId);
      eventTypes.push(frame.event.type);
    });
    await client.write('hello runner\r', 'runner-test-client');

    await waitFor(() => eventTypes.includes('user.input'), 1500);
    await waitFor(() => eventTypes.includes('terminal.output'), 1500);
    assert.equal(eventIds.length > 0, true);

    await client.stop('test-complete');
    await waitFor(() => eventTypes.includes('session.exited'), 1500);
    await unsubscribe();
  } finally {
    await client?.close().catch(() => undefined);
    await runner.close().catch(() => undefined);
    cleanup();
  }
});

test('detached runner process survives parent process exit', async () => {
  const { socketDir, cleanup } = tempRunnerFixture();
  const fixture = fileURLToPath(new URL('../src/pty/session-runner-detach-fixture.ts', import.meta.url));
  const payload = Buffer.from(JSON.stringify({
    socketDir,
    projectPath: process.cwd()
  }), 'utf8').toString('base64url');
  const parent = spawn(process.execPath, [...runnerExecArgv(), fixture, payload], {
    stdio: 'ignore',
    env: process.env
  });
  let client: SessionRunnerClient | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      parent.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`fixture exited with code ${code}`)));
      parent.once('error', reject);
    });

    client = new SessionRunnerClient({ socketPath: runnerSocketPath('tth_detach_fixture', socketDir) });
    const ping = await client.ping() as { sessionId?: string; session?: { runnerPid?: number } };
    assert.equal(ping?.sessionId, 'tth_detach_fixture');
    assert.equal(typeof ping?.session?.runnerPid, 'number');
    assert.notEqual(ping?.session?.runnerPid, parent.pid);
    assert.notEqual(ping?.session?.runnerPid, process.pid);

    const eventTypes: string[] = [];
    const unsubscribe = await client.subscribeEvents((frame) => {
      eventTypes.push(frame.event.type);
    });
    await client.write('detached hello\r', 'detach-test');
    await waitFor(() => eventTypes.includes('terminal.output'), 1500);
    await client.stop('detach-test-complete');
    await waitFor(() => eventTypes.includes('session.exited'), 1500);
    await unsubscribe();
  } finally {
    await client?.close().catch(() => undefined);
    cleanup();
  }
});

test('spawned runner process invokes onExit when child exits', async () => {
  const { socketDir, cleanup } = tempRunnerFixture();
  const exitEvents: Array<{ sessionId: string; exitCode: number | null; signal: NodeJS.Signals | null }> = [];
  let client: SessionRunnerClient | undefined;
  try {
    await spawnSessionRunnerProcess({
      options: {
        id: 'tth_spawn_exit',
        provider: 'codex',
        command: '/bin/cat',
        projectPath: process.cwd(),
        cols: 80,
        rows: 24,
        socketDir
      },
      onExit: (event) => {
        exitEvents.push(event);
      }
    });

    client = new SessionRunnerClient({ socketPath: runnerSocketPath('tth_spawn_exit', socketDir) });
    await client.stop('exit-test-complete');
    await waitFor(() => exitEvents.length === 1, 1500);
    assert.equal(exitEvents[0]?.sessionId, 'tth_spawn_exit');
    assert.equal(exitEvents[0]?.exitCode, 0);
    assert.equal(exitEvents[0]?.signal, null);
  } finally {
    await client?.close().catch(() => undefined);
    cleanup();
  }
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}

function runnerExecArgv(): string[] {
  return process.execArgv.filter((arg) => arg !== '--test');
}
