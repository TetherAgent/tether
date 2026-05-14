import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'registry-test-'));
}

function withRegistry<T>(fn: (registryFile: string, cleanup: () => void) => Promise<T>): Promise<T> {
  const dir = makeTmpDir();
  const registryFile = path.join(dir, 'gateways.json');
  const originalEnv = process.env.TETHER_REGISTRY_PATH;
  process.env.TETHER_REGISTRY_PATH = registryFile;
  const cleanup = () => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.TETHER_REGISTRY_PATH;
    } else {
      process.env.TETHER_REGISTRY_PATH = originalEnv;
    }
  };
  return fn(registryFile, cleanup).finally(cleanup);
}

function makeRecord(overrides: Partial<import('../src/registry.js').GatewayRecord> = {}): import('../src/registry.js').GatewayRecord {
  return {
    id: 'gw_001',
    host: '127.0.0.1',
    port: 8080,
    url: 'http://127.0.0.1:8080',
    pid: process.pid,          // current process is always alive
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// registerGateway
// ---------------------------------------------------------------------------

test('registerGateway: writes new record to registry', async () => {
  await withRegistry(async () => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_001' }));
    const list = await listGateways();
    assert.ok(list.some(r => r.id === 'gw_001'));
  });
});

test('registerGateway: replaces existing record with same id', async () => {
  await withRegistry(async () => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_001', port: 8080 }));
    await registerGateway(makeRecord({ id: 'gw_001', port: 9090 }));
    const list = await listGateways();
    const matched = list.filter(r => r.id === 'gw_001');
    assert.equal(matched.length, 1);
    assert.equal(matched[0]!.port, 9090);
  });
});

test('registerGateway: cleans up stale (> 30s) records', async () => {
  await withRegistry(async () => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    // stale: lastSeenAt is 60 seconds ago
    await registerGateway(makeRecord({ id: 'gw_stale', lastSeenAt: Date.now() - 60_000 }));
    await registerGateway(makeRecord({ id: 'gw_fresh' }));
    const list = await listGateways();
    assert.ok(!list.some(r => r.id === 'gw_stale'));
    assert.ok(list.some(r => r.id === 'gw_fresh'));
  });
});

test('registerGateway: cleans up records with dead PIDs', async () => {
  await withRegistry(async () => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    // PID 1 exists on Unix (init), but PID 2147483647 (max int32) almost certainly doesn't
    const deadPid = 2147483647;
    await registerGateway(makeRecord({ id: 'gw_dead', pid: deadPid }));
    await registerGateway(makeRecord({ id: 'gw_live' }));
    const list = await listGateways();
    assert.ok(!list.some(r => r.id === 'gw_dead'));
    assert.ok(list.some(r => r.id === 'gw_live'));
  });
});

// ---------------------------------------------------------------------------
// touchGateway
// ---------------------------------------------------------------------------

test('touchGateway: updates lastSeenAt for existing record', async () => {
  await withRegistry(async () => {
    const { registerGateway, touchGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_touch', lastSeenAt: Date.now() - 5000 }));
    const before = (await listGateways()).find(r => r.id === 'gw_touch')!.lastSeenAt;
    const now = Date.now();
    await touchGateway('gw_touch', now);
    const after = (await listGateways()).find(r => r.id === 'gw_touch')!.lastSeenAt;
    assert.equal(after, now);
    assert.ok(after > before);
  });
});

test('touchGateway: silently ignores unknown id', async () => {
  await withRegistry(async () => {
    const { touchGateway } = await import('../src/registry.js');
    await assert.doesNotReject(() => touchGateway('gw_nonexistent'));
  });
});

// ---------------------------------------------------------------------------
// unregisterGateway
// ---------------------------------------------------------------------------

test('unregisterGateway: removes specified record', async () => {
  await withRegistry(async () => {
    const { registerGateway, unregisterGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_remove' }));
    await registerGateway(makeRecord({ id: 'gw_keep' }));
    await unregisterGateway('gw_remove');
    const list = await listGateways();
    assert.ok(!list.some(r => r.id === 'gw_remove'));
    assert.ok(list.some(r => r.id === 'gw_keep'));
  });
});

test('unregisterGateway: also cleans up stale records while removing', async () => {
  await withRegistry(async () => {
    const { registerGateway, unregisterGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_stale2', lastSeenAt: Date.now() - 60_000 }));
    await registerGateway(makeRecord({ id: 'gw_target' }));
    await unregisterGateway('gw_target');
    const list = await listGateways();
    assert.ok(!list.some(r => r.id === 'gw_stale2'));
    assert.ok(!list.some(r => r.id === 'gw_target'));
  });
});

// ---------------------------------------------------------------------------
// listGateways
// ---------------------------------------------------------------------------

test('listGateways: returns records sorted by lastSeenAt descending', async () => {
  await withRegistry(async () => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    const now = Date.now();
    await registerGateway(makeRecord({ id: 'gw_older', lastSeenAt: now - 1000 }));
    await registerGateway(makeRecord({ id: 'gw_newer', lastSeenAt: now }));
    const list = await listGateways();
    const ids = list.filter(r => r.id === 'gw_older' || r.id === 'gw_newer').map(r => r.id);
    assert.deepEqual(ids, ['gw_newer', 'gw_older']);
  });
});

test('listGateways: excludes stale records and writes back pruned list', async () => {
  await withRegistry(async (registryFile) => {
    const { registerGateway, listGateways } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_stale3', lastSeenAt: Date.now() - 60_000 }));
    await registerGateway(makeRecord({ id: 'gw_good' }));
    const list = await listGateways();
    assert.ok(!list.some(r => r.id === 'gw_stale3'));
    // verify file was rewritten: stale record is not in the file
    const content = await readFile(registryFile, 'utf8');
    assert.ok(!content.includes('gw_stale3'));
  });
});

// ---------------------------------------------------------------------------
// Atomic write (tmp + rename)
// ---------------------------------------------------------------------------

test('writeRegistry uses tmp file and rename (no direct overwrite)', async () => {
  await withRegistry(async (registryFile) => {
    const { registerGateway } = await import('../src/registry.js');
    await registerGateway(makeRecord({ id: 'gw_atomic' }));
    // After the write, registryFile should exist and no .tmp files should remain
    assert.ok(existsSync(registryFile));
    const dir = path.dirname(registryFile);
    const tmpFiles = readdirSync(dir).filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0, `unexpected tmp files: ${tmpFiles.join(', ')}`);
  });
});
