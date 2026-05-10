import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { replaySessionEvents, type ReplayPage } from '../src/replay.js';
import { Store, type Session } from '../src/store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-replay-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

function insertSession(store: Store, id: string): void {
  const now = Date.now();
  const session: Session = {
    id,
    provider: 'codex',
    title: 'Replay test',
    projectPath: process.cwd(),
    status: 'running',
    attachState: 'detached',
    tmuxSessionName: '',
    command: '/bin/cat',
    transport: 'pty-event-stream',
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now
  };
  store.insertSession(session);
}

test('replaySessionEvents paginates all history and only marks the final page done', () => {
  const { store, cleanup } = tempStore();
  const sessionId = 'tth_replay_all_test';
  try {
    insertSession(store, sessionId);
    for (let index = 0; index < 5001; index += 1) {
      store.appendEvent(sessionId, 'terminal.output', { data: String(index) });
    }

    const pages: ReplayPage[] = [];
    const cursor = replaySessionEvents({
      store,
      sessionId,
      after: 0,
      sendPage: (page) => pages.push(page)
    });

    assert.equal(cursor, 5001);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].events.length, 5000);
    assert.equal(pages[0].done, false);
    assert.equal(pages[0].latestEventId, 5000);
    assert.equal(pages[1].events.length, 1);
    assert.equal(pages[1].done, true);
    assert.equal(pages[1].latestEventId, 5001);
  } finally {
    cleanup();
  }
});

test('replaySessionEvents replays recent tail and returns latest cursor', () => {
  const { store, cleanup } = tempStore();
  const sessionId = 'tth_replay_recent_test';
  try {
    insertSession(store, sessionId);
    for (let index = 0; index < 5; index += 1) {
      store.appendEvent(sessionId, 'terminal.output', { data: String(index) });
    }

    const pages: ReplayPage[] = [];
    const cursor = replaySessionEvents({
      store,
      sessionId,
      after: 0,
      tail: 2,
      sendPage: (page) => pages.push(page)
    });

    assert.equal(cursor, 5);
    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0].events.map((event) => event.id), [4, 5]);
    assert.equal(pages[0].done, true);
    assert.equal(pages[0].latestEventId, 5);
  } finally {
    cleanup();
  }
});
