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

test('conversation_turns uses a shared sequential turn_index and returns assigned index', () => {
  const { store, cleanup } = tempStore();
  try {
    const firstIndex = store.insertConversationTurn('tth_conversation_seq', 'user', 'hello');
    const secondIndex = store.insertConversationTurn('tth_conversation_seq', 'assistant', 'hi');
    assert.equal(firstIndex, 0);
    assert.equal(secondIndex, 1);
    assert.deepEqual(
      store.listConversationTurns('tth_conversation_seq').map((turn) => ({
        turnIndex: turn.turnIndex,
        role: turn.role,
        content: turn.content
      })),
      [
        { turnIndex: 0, role: 'user', content: 'hello' },
        { turnIndex: 1, role: 'assistant', content: 'hi' }
      ]
    );
  } finally {
    cleanup();
  }
});

test('conversation_turns INSERT OR IGNORE keeps unique (session_id, turn_index)', () => {
  const { store, cleanup } = tempStore();
  try {
    const sessionId = 'tth_conversation_ignore';
    const ts = Date.now();
    const turnIndex = store.insertConversationTurn(sessionId, 'user', 'hello', undefined, ts);
    assert.equal(turnIndex, 0);
    const db = (store as any).db as DatabaseSync;
    db.prepare(
      `INSERT OR IGNORE INTO conversation_turns (session_id, turn_index, role, content, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, turnIndex, 'assistant', 'ignored', null, ts + 1);
    const row = db.prepare('SELECT COUNT(*) as count FROM conversation_turns WHERE session_id = ?').get(sessionId) as {
      count: number;
    };
    assert.equal(row.count, 1);
  } finally {
    cleanup();
  }
});

test('listConversationTurns always returns rows in turn_index ascending order', () => {
  const { store, cleanup } = tempStore();
  try {
    const sessionId = 'tth_conversation_order';
    const db = (store as any).db as DatabaseSync;
    const ts = Date.now();
    db.prepare(
      `INSERT INTO conversation_turns (session_id, turn_index, role, content, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, 1, 'assistant', 'second', null, ts + 1);
    db.prepare(
      `INSERT INTO conversation_turns (session_id, turn_index, role, content, tools, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sessionId, 0, 'user', 'first', null, ts);
    assert.deepEqual(
      store.listConversationTurns(sessionId).map((turn) => ({
        turnIndex: turn.turnIndex,
        content: turn.content
      })),
      [
        { turnIndex: 0, content: 'first' },
        { turnIndex: 1, content: 'second' }
      ]
    );
  } finally {
    cleanup();
  }
});
