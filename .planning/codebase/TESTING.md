# Testing Patterns

**Analysis Date:** 2026-05-01

## Test Framework

**Runner:** `node:test` — the built-in Node.js test runner. No Vitest, Jest, Mocha, or other framework is installed.

**Assertion library:** `node:assert/strict` — imported as `import assert from 'node:assert/strict'`.

**TypeScript execution:** tests run directly through `tsx` (no compile step). The gateway's package script is:

```json
"test": "tsx --test src/*.test.ts"
```

(`apps/gateway/package.json:13`)

**Root orchestration:** the root `package.json` runs `pnpm -r --if-present run test` so every workspace that defines a `test` script is executed.

## Run Commands

```bash
pnpm test                                      # Run all workspace tests (only @tether/gateway has any)
pnpm --filter @tether/gateway test             # Run gateway tests only
pnpm --filter @tether/gateway exec tsx --test src/daemon.test.ts   # Run a single file
pnpm typecheck                                 # tsc --noEmit across all workspaces
```

There is no watch mode, no coverage reporter, and no CI test config wired up at the time of analysis.

## Test File Locations

Tests are **co-located with source** in `apps/gateway/src/` using the `<unit>.test.ts` suffix. Current test files:

- `apps/gateway/src/store.test.ts` — sqlite store CRUD and event cursor.
- `apps/gateway/src/pty.test.ts` — `PtySessionManager` lifecycle and input masking.
- `apps/gateway/src/daemon.test.ts` — HTTP/WebSocket integration tests against a live `startDaemon` instance.

No tests exist for `apps/cli`, `apps/web`, or any `packages/*`. New test files in those workspaces must add a `test` script in the workspace's `package.json` to be picked up by `pnpm test`.

## Test File Structure

**Imports follow the same convention as source** — `node:` built-ins, third-party, relative `.js` paths.

**Top-level `test('name', async () => { ... })` calls.** No `describe` blocks; `node:test` is used flat. Tests within a file are independent and may run concurrently.

**Sample (`apps/gateway/src/store.test.ts:16`):**

```typescript
test('stores sessions and cursor-addressed events', () => {
  const { store, cleanup } = tempStore();
  try {
    // ... arrange + act + assert
  } finally {
    cleanup();
  }
});
```

**Resource cleanup pattern:** every test that opens a resource (DB, daemon, PTY) wraps the body in `try { ... } finally { cleanup(); }` (and `await daemon.close()` first when applicable). Always pair allocation with cleanup in `finally` to avoid leaking sockets, file descriptors, or sqlite handles.

**Sample (`apps/gateway/src/daemon.test.ts:80`):**

```typescript
test('stop endpoint terminates live pty session', async () => {
  const { store, cleanup } = tempStore();
  const ptySessions = new PtySessionManager(store);
  const sessionId = createSessionId();
  ptySessions.create({ /* ... */ });
  const daemon = await startDaemon({ host: '127.0.0.1', port: 4893, store, ptySessions });

  try {
    const response = await fetch(`http://127.0.0.1:4893/api/sessions/${sessionId}/stop`, { method: 'POST' });
    assert.equal(response.ok, true);
    await waitFor(() => store.getSession(sessionId)?.status !== 'running', 1000);
    assert.equal(ptySessions.hasLiveSession(sessionId), false);
  } finally {
    await daemon.close();
    cleanup();
  }
});
```

## Fixtures and Factories

**No shared fixtures directory.** Each test file defines its own `tempStore()` helper at the top. The pattern is identical across all three test files:

```typescript
function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-<scope>-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}
```

The directory prefix differs per file (`tether-store-`, `tether-pty-`, `tether-daemon-`) so concurrent tests do not collide. Copy this pattern when adding a new test file rather than centralizing it — this matches the codebase's "don't add abstractions for single use" rule.

**Session IDs:** use `createSessionId()` from `./ids.js` for realistic IDs, or hand-pick a literal like `'tth_test'` / `'tth_lost_test'` when a stable string is needed for assertions.

## Mocking

**No mocking library is used.** The codebase prefers real implementations:

- Real sqlite databases in temp directories (no in-memory mocks).
- Real PTYs, spawning `/bin/cat` as a stand-in agent process (`apps/gateway/src/pty.test.ts:23`, `apps/gateway/src/daemon.test.ts:56`).
- Real HTTP and WebSocket servers via `startDaemon` on distinct ports (4891, 4892, 4893 — pick a fresh port per test to avoid binding clashes).
- Real `fetch` and `WebSocket` clients against the running daemon.

Do not introduce `sinon`, `jest.mock`, or `node:test` mock helpers without a strong reason. Prefer driving real subsystems through their public API.

**Port allocation convention:** when adding a daemon-level test, pick the next unused port in the 489x range. If you need parallelism, randomize within an unused range and assert nothing else binds it.

## Async and Timing Patterns

**Promise-based readiness loops.** Tests poll for state convergence with `waitFor`:

```typescript
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for condition');
}
```

(`apps/gateway/src/pty.test.ts:49`, `apps/gateway/src/daemon.test.ts:126`)

**WebSocket message waiting** uses a per-test helper with timeout and predicate:

```typescript
async function waitForMessage(ws: WebSocket, predicate: (text: string) => boolean): Promise<string> {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket message')), 1000);
    ws.on('message', (raw) => {
      const text = raw.toString();
      if (predicate(text)) {
        clearTimeout(timer);
        resolve(text);
      }
    });
    ws.on('error', reject);
  });
}
```

(`apps/gateway/src/daemon.test.ts:112`)

**Default timeout:** 1000 ms is the convention for both `waitFor` and `waitForMessage`. Bump this only when the test genuinely needs more time, and document why.

## Assertion Patterns

Use **`node:assert/strict`** equality forms:

- `assert.equal(actual, expected)` — strict equality.
- `assert.deepEqual(actual, expected)` — for arrays/objects.
- `assert.match(actual, /regex/)` — for partial string matching.
- `assert.ok(value)` — truthiness/existence check.

Examples appear at `apps/gateway/src/store.test.ts:39-42`, `apps/gateway/src/pty.test.ts:30-42`, `apps/gateway/src/daemon.test.ts:41-42`.

Do not use chained matchers (`expect(...).toBe(...)`); they are not available.

## Test Types

**Unit tests:**
- `apps/gateway/src/store.test.ts` — pure persistence logic, single sqlite file, no network.

**Integration tests:**
- `apps/gateway/src/pty.test.ts` — exercises a real PTY child process plus the store.
- `apps/gateway/src/daemon.test.ts` — boots `startDaemon`, drives it via `fetch` and `ws` clients end-to-end.

**E2E tests:** none. `PROJECT.md` instead requires that subprocess/PTY-affecting changes be **manually verified** with a live `pnpm tether gateway` + PTY session before merging.

## What to Test

When adding new gateway functionality, follow the existing slicing:

- **Store-shaped behavior** (a new column, query, migration): add a case to `store.test.ts` style — temp DB, exercise the public method, assert via the same store instance.
- **PTY/process behavior** (input masking, lifecycle, signals): add a `pty.test.ts`-style test with `/bin/cat` or another deterministic command.
- **HTTP/WebSocket surface** (new endpoint, new frame type): add a `daemon.test.ts`-style test that boots a real daemon on a fresh port and drives it with `fetch` / `ws`.

## Coverage

**Coverage is not measured.** No `c8`, `nyc`, or `--experimental-test-coverage` flag is wired up. Do not assume any minimum threshold; rely on the manual verification gate from `PROJECT.md` for behaviors that aren't unit-testable.

## Typecheck

`pnpm typecheck` runs `tsc -p tsconfig.json --noEmit` in every workspace that defines the script. Treat typecheck as the baseline gate that must pass alongside `pnpm test`.

---

*Testing analysis: 2026-05-01*
