import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-store-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('stores sessions and cursor-addressed events', () => {
  const { store, cleanup } = tempStore();
  try {
    const now = Date.now();
    store.insertSession({
      id: 'tth_test',
      provider: 'codex',
      title: 'test',
      projectPath: '/tmp/test',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'codex',
      pid: 123,
      runnerPid: 456,
      runnerSocketPath: '/tmp/tth_test.sock',
      runnerStartedAt: now,
      runnerLastHeartbeatAt: now,
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    const first = store.appendEvent('tth_test', 'terminal.output', { data: 'one', encoding: 'utf8' });
    const second = store.appendEvent('tth_test', 'terminal.output', { data: 'two', encoding: 'utf8' });
    const third = store.appendEvent('tth_test', 'terminal.output', { data: 'three', encoding: 'utf8' });

    assert.equal(store.getSession('tth_test')?.transport, 'pty-event-stream');
    assert.equal(store.getSession('tth_test')?.runnerPid, 456);
    assert.equal(store.getSession('tth_test')?.runnerSocketPath, '/tmp/tth_test.sock');
    assert.equal(store.latestEventId('tth_test'), third.id);
    assert.deepEqual(store.listEvents('tth_test', first.id).map((event) => event.id), [second.id, third.id]);
    assert.deepEqual(store.listRecentEvents('tth_test', 2).map((event) => event.id), [second.id, third.id]);
    assert.equal(store.transcript('tth_test'), 'onetwothree');
  } finally {
    cleanup();
  }
});

test('listEvents skips rows with corrupt payload JSON', () => {
  const { store, cleanup } = tempStore();
  try {
    const now = Date.now();
    store.insertSession({
      id: 'tth_corrupt_event',
      provider: 'codex',
      title: 'corrupt event',
      projectPath: '/tmp/test',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'codex',
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    const first = store.appendEvent('tth_corrupt_event', 'terminal.output', { data: 'one', encoding: 'utf8' });
    (store as unknown as { db: DatabaseSync }).db
      .prepare('INSERT INTO session_events (session_id, type, ts, payload_json) VALUES (?, ?, ?, ?)')
      .run('tth_corrupt_event', 'terminal.output', now + 1, '{bad-json');
    const third = store.appendEvent('tth_corrupt_event', 'terminal.output', { data: 'three', encoding: 'utf8' });

    assert.deepEqual(store.listEvents('tth_corrupt_event').map((event) => event.id), [first.id, third.id]);
    assert.deepEqual(store.listRecentEvents('tth_corrupt_event', 3).map((event) => event.id), [first.id, third.id]);
  } finally {
    cleanup();
  }
});

test('migrates legacy sessions table with runner metadata columns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-store-legacy-'));
  const dbPath = path.join(dir, 'tether.db');
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        title TEXT,
        project_path TEXT,
        status TEXT NOT NULL,
        tmux_session_name TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    db.close();

    const store = new Store(dbPath);
    const migratedDb = new DatabaseSync(dbPath);
    const columns = new Set(
      (migratedDb.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map((column) => column.name)
    );
    migratedDb.close();
    assert.equal(columns.has('runner_pid'), true);
    assert.equal(columns.has('runner_socket_path'), true);
    assert.equal(columns.has('runner_started_at'), true);
    assert.equal(columns.has('runner_last_heartbeat_at'), true);

    const now = Date.now();
    store.insertSession({
      id: 'tth_legacy_runner',
      provider: 'codex',
      title: 'legacy',
      projectPath: '/tmp/legacy',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'codex',
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });
    store.updateRunnerMetadata('tth_legacy_runner', {
      runnerPid: 1234,
      runnerSocketPath: '/tmp/tth_legacy_runner.sock',
      runnerStartedAt: now,
      runnerLastHeartbeatAt: now
    });
    assert.equal(store.getSession('tth_legacy_runner')?.runnerPid, 1234);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('supports multiple store instances appending session events', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-store-concurrent-'));
  try {
    const dbPath = path.join(dir, 'tether.db');
    const firstStore = new Store(dbPath);
    const secondStore = new Store(dbPath);
    const now = Date.now();
    firstStore.insertSession({
      id: 'tth_multi_writer',
      provider: 'codex',
      title: 'multi',
      projectPath: '/tmp/multi',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'codex',
      transport: 'pty-event-stream',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    firstStore.appendEvent('tth_multi_writer', 'terminal.output', { data: 'one', encoding: 'utf8' });
    secondStore.appendEvent('tth_multi_writer', 'runner.heartbeat', { pid: 1234 });

    assert.deepEqual(firstStore.listEvents('tth_multi_writer').map((event) => event.type), [
      'terminal.output',
      'runner.heartbeat'
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stores chat events in the dedicated chat event table', () => {
  const { store, cleanup } = tempStore();
  try {
    const now = Date.now();
    store.insertSession({
      id: 'tth_chat',
      provider: 'claude',
      title: 'chat',
      projectPath: '/tmp/chat',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'claude',
      transport: 'chat',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    store.appendChatEvent('tth_chat', 'user.message', { content: 'hello' }, now);
    store.appendChatEvent('tth_chat', 'agent.result', { content: 'hi', usage: { input_tokens: 1, output_tokens: 2 } }, now + 1);

    assert.deepEqual(store.listChatEvents('tth_chat').map((event) => event.type), ['user.message', 'agent.result']);
    assert.equal(store.getSession('tth_chat')?.transport, 'chat');
  } finally {
    cleanup();
  }
});

test('listChatEvents skips rows with corrupt payload JSON', () => {
  const { store, cleanup } = tempStore();
  try {
    const now = Date.now();
    store.insertSession({
      id: 'tth_chat_corrupt',
      provider: 'claude',
      title: 'chat corrupt',
      projectPath: '/tmp/chat',
      status: 'running',
      attachState: 'detached',
      tmuxSessionName: '',
      command: 'claude',
      transport: 'chat',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    });

    store.appendChatEvent('tth_chat_corrupt', 'user.message', { content: 'hello' }, now);
    (store as unknown as { db: DatabaseSync }).db
      .prepare('INSERT INTO session_chats_events (session_id, type, ts, payload_json) VALUES (?, ?, ?, ?)')
      .run('tth_chat_corrupt', 'agent.result', now + 1, '{bad-json');
    store.appendChatEvent('tth_chat_corrupt', 'agent.result', { content: 'hi' }, now + 2);

    assert.deepEqual(store.listChatEvents('tth_chat_corrupt').map((event) => event.ts), [now, now + 2]);
  } finally {
    cleanup();
  }
});
