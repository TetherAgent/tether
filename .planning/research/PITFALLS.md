# Pitfalls Research

**Domain:** PTY event-stream / multi-device CLI / supervisor-style daemon (Tether v0.3)
**Researched:** 2026-05-01
**Confidence:** HIGH — grounded in actual codebase audit (CONCERNS.md) + verified external sources

---

## Critical Pitfalls

### Pitfall 1: Raw Mode Left on Terminal After Crash or SIGKILL

**What goes wrong:**
`tether attach` calls `process.stdin.setRawMode(true)` to pass keystrokes through. If the attach process exits via an unhandled exception, `process.exit()` inside a SIGINT handler, or a `SIGKILL` from outside, `setRawMode(false)` never runs. The user's shell is left with echo disabled, line discipline broken, and every typed character invisible. They must run `stty sane` or `reset` to recover. This is distinct from the PTY child process — it affects the *attach client's own terminal*.

**Why it happens:**
Node.js only resets TTY state via the normal exit path. Signal handlers that call `process.exit()` directly skip the `finally` block. `SIGKILL` cannot be caught at all.

**How to avoid:**
- Register `SIGINT`, `SIGTERM`, and `process.on('exit')` handlers that all call `process.stdin.setRawMode(false)` before exiting.
- Wrap the entire attach loop in `try/finally { process.stdin.setRawMode(false) }`.
- Do NOT call `process.exit()` directly inside signal handlers — instead set a flag, let the event loop drain, then exit. Example shape:
  ```ts
  let exiting = false;
  process.on('SIGINT', () => { if (!exiting) { exiting = true; cleanup(); } });
  function cleanup() {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }
  ```
- Test: write an integration test that kills the attach process mid-session with `process.kill(pid, 'SIGTERM')` and asserts the parent shell's tty state with `stty -g` before and after.

**Warning signs:**
- After `tether attach` exits, the caller's terminal shows no typed characters (invisible input).
- `stty -a` shows `-echo -icanon` on the parent terminal after the process exits.
- Unit test: spawn `tether attach`, send SIGTERM, check exit, verify `stty echo` is still set.

**Phase to address:** P0 — EXP-01/EXP-02; the detach key implementation must pair raw mode cleanup.

---

### Pitfall 2: node-pty posix_spawn File Descriptor Leak Causing `posix_spawnp failed`

**What goes wrong:**
On macOS, when many PTY sessions are spawned and exited over a long Gateway uptime, open file descriptors accumulate. The specific issue (node-pty issue #907) is that `posix_spawn` on Darwin leaks file descriptors across repeated spawn/exit cycles. After hitting the per-process FD limit (default 256 on macOS, configurable up to ~10240), subsequent `pty.spawn()` calls throw `posix_spawnp failed: Too many open files`. The error surfaces as a Gateway-level crash or session creation failure with no obvious cause.

**Why it happens:**
node-pty `1.2.0-beta.2` (currently pinned) predates the fd-leak fixes introduced in beta.4 (Linux) and beta.10 (macOS). This is a known open issue on macOS in early betas.

**How to avoid:**
- Upgrade from `node-pty@1.2.0-beta.2` to `node-pty@1.2.0-beta.12` (latest as of this research). Beta.10 specifically addresses fd leaks on macOS.
- After upgrading, verify native rebuild: `pnpm rebuild node-pty` and confirm `apps/gateway/package.json` pin is updated.
- Add a health check: on each Gateway startup, log the current open fd count (`/proc/self/fd` on Linux or `lsof -p $PID | wc -l` on macOS). Alert if > 128 at idle.
- Test: spawn 20 PTY sessions sequentially in a test, each with a `/bin/true` command, assert all 20 succeed without EMFILE errors.

**Warning signs:**
- `ENOENT` or `posix_spawnp failed` errors in Gateway logs on session creation.
- `lsof -p <gateway-pid> | wc -l` grows monotonically after sessions exit.
- Affects long-running Gateway instances (hours+), not fresh restarts.

**Phase to address:** P1 — GW-01 (Gateway supervisor upgrade); pin upgrade is a prerequisite.

---

### Pitfall 3: macOS PTY ~1024-Byte Write Corruption on Large Pastes

**What goes wrong:**
On macOS, writing more than ~1024 bytes to a PTY master fd in a single `pty.write()` call corrupts the input. The macOS PTY canonical-mode line editor creates backpressure: the kernel's ~1024-byte buffer overflows and wraps, so content after byte ~1024 replays earlier buffer data and the shell's command is corrupted silently. The agent receives garbled input and may execute a wrong command or produce an error with no clear cause. This is the root cause of "paste large code block, agent gets garbage."

**Why it happens:**
macOS PTY behavior differs from Linux. node-pty `>=1.1.0` introduced `CustomWriteStream` which retries on `EAGAIN` via `setImmediate`, but this only works if callers use the `write()` method properly and do not exceed the buffer threshold in a single synchronous call. The current `PtySessionManager.write()` in `pty.ts:117` calls `live.pty.write(options.data)` directly without any chunking for large inputs.

**How to avoid:**
- In `PtySessionManager.write()`, chunk input into ≤512-byte pieces with a small delay between chunks when `data.length > 512`.
- Alternatively, rely on node-pty `>=1.1.0`'s `CustomWriteStream` EAGAIN retry — but only if the write path goes through the stream interface, not the raw fd. Confirm in node-pty source that the `write()` method uses `CustomWriteStream`.
- Test: write an integration test that sends a 2000-byte paste string through the WebSocket input path and asserts the full string arrives intact in the PTY child's stdin (use `/bin/cat` as the command and check its stdout event equals the input).
- The bracketed paste wrapper (`\x1b[200~...\x1b[201~`) adds overhead — test with the wrapper present.

**Warning signs:**
- Pasting >1KB of code into `tether attach` produces a garbled command in the agent.
- `EXP-03` acceptance item ("paste large text not garbled") fails in manual test.
- The corruption is silent — no error is returned from `pty.write()`.

**Phase to address:** P0 — EXP-03 (bracketed paste strategy).

---

### Pitfall 4: Alternate Screen + Resize Causes TUI Flicker and Broken Layout

**What goes wrong:**
When a TUI agent (Claude, Codex, opencode) uses the alternate screen buffer (`\x1b[?1049h`) and a resize happens at the wrong moment, the PTY sends a `SIGWINCH` to the child process while the alternate screen is partially rendered. The child process redraws before the terminal emulator (xterm.js or the local terminal) has processed the in-flight output, causing a visible flash of the primary screen, incorrect cursor positions, and sometimes a permanent layout break until the user manually clears.

The specific failure: `active controller owns size` means any new control client triggers an immediate resize. If a phone or web client claims control and then immediately resizes to their viewport, the in-flight TUI render gets interrupted.

**Why it happens:**
PTY resize (`pty.resize()`) is synchronous and immediate — the child sees `SIGWINCH` before any in-flight output is flushed. Tether's current `resize()` in `pty.ts:127` calls `live.pty.resize()` synchronously as soon as the resize WS frame arrives, with no debounce and no check of whether alternate screen is active.

**How to avoid:**
- Debounce resize calls: coalesce rapid resize frames into one `pty.resize()` call after a 150ms idle window. This covers the browser viewport event firing repeatedly during a drag.
- Check if the alternate screen buffer is active via xterm.js `terminal.buffer.active.type === 'alternate'` before applying resize on the client side. If alternate screen is active, queue the resize until `\x1b[?1049l` (exit alternate screen) is observed. This is a client-side hint only — the Gateway still applies the resize from the controller.
- On the Gateway side, add a 100ms debounce to `resize()` calls per session. The debounce timer should be stored per live session.
- Test: start a Vim session (which uses alternate screen), trigger 3 rapid resize frames from the controller, assert the PTY only received one `SIGWINCH` (check `terminal.resize` events in the event store).

**Warning signs:**
- `EXP-05` acceptance item (complex TUI resize reflow) fails.
- Opening a second local terminal window and claiming control causes the first window's TUI to flicker.
- `terminal.resize` events appear in bursts of 5+ in a short window in the event store.

**Phase to address:** P0 — EXP-04/EXP-05 (ANSI/alternate screen/resize verification).

---

### Pitfall 5: SQLite WAL Checkpoint Starvation Growing Without Bound

**What goes wrong:**
The event store appends one `terminal.output` row every 16ms per active session (the flush window in `pty.ts:183`). A long Codex session running for hours writes tens of thousands of rows. In WAL mode, SQLite defers merging WAL writes back to the main database file until a checkpoint runs. A checkpoint can only complete if no readers hold a read transaction open. Because `listEvents()` opens a read transaction on every WS replay request, and the replay cursor can be requested repeatedly, checkpoints get starved — the WAL file grows without bound (documented cases: 20GB+ WAL files). This degrades all subsequent reads and writes as SQLite scans the growing WAL.

**Why it happens:**
`better-sqlite3` uses synchronous API, single process, WAL mode. The actual risk here is specifically from the HTTP polling fallback (`/api/sessions/:id/events` polled every 500ms from `main.tsx:478`) combined with `transcript()` using a reverse-then-forward query (loads up to 5000 rows into memory). Each poll is a short read transaction, but under continuous polling from a slow web client combined with constant appends, the WAL writer cannot checkpoint.

**How to avoid:**
- Schedule a periodic WAL checkpoint with `PRAGMA wal_checkpoint(RESTART)` every 5 minutes when no session is actively writing. Add this as a `setInterval` in the Gateway startup.
- Set `PRAGMA wal_autocheckpoint = 1000` (default is 1000 pages, ~4MB) to keep WAL small.
- Set `PRAGMA synchronous = NORMAL` (safe with WAL; reduces fsync overhead without durability risk for this use case).
- Implement `RETAIN-01` (7-day / 100MB retention) before the WAL issue becomes visible in practice. DELETE of old rows also triggers implicit checkpoint opportunities.
- Test: write a test that inserts 10,000 events, then checks `pragma wal_checkpoint(PASSIVE)` returns `(log, checkpointed)` counts showing WAL is being reclaimed.

**Warning signs:**
- `~/.tether/tether.db-wal` file grows past 10MB during a session.
- Gateway response times increase over a multi-hour session.
- `SELECT COUNT(*) FROM session_events` takes >100ms.

**Phase to address:** P1 — RETAIN-01 (event retention initial version).

---

### Pitfall 6: WebSocket Broadcast Stalls PTY When Slow Client Fills Send Buffer

**What goes wrong:**
The broadcast loop in `daemon.ts:302-305` calls `socket.send(JSON.stringify({ type: 'event', event }))` synchronously for every connected client on every PTY output event. If a mobile client on a slow connection has a full TCP send buffer, `socket.send()` queues the data in the `ws` library's internal buffer. This buffer is unbounded by default. With 60 PTY output events/second and a slow mobile client, the Gateway process heap grows at ~1MB/min. Eventually the Node.js process OOMs or the connection latency causes cascading slowness that stalls the PTY read loop.

**Why it happens:**
The current implementation does not check `socket.bufferedAmount` (ws library: `socket.bufferedAmount` property) or listen to the `drain` event before sending. The `ws` library's `send()` is not backpressure-aware by default.

**How to avoid:**
- Check `socket.bufferedAmount` before each `socket.send()`. If above a threshold (e.g., 256KB), either drop the event for that client or close the connection:
  ```ts
  if (socket.bufferedAmount > 256_000) {
    socket.close(1008, 'client too slow');
    return;
  }
  ```
- Drop non-critical events (e.g., `client.attached` heartbeats) for lagging clients; never drop `terminal.output` to the controlling client.
- Test: write a test that connects a mock WS client that never reads, sends 100 PTY output events, and asserts the Gateway does not accumulate unbounded memory (check `socket.bufferedAmount` after the batch).

**Warning signs:**
- Gateway Node.js heap grows monotonically while a session is running.
- `socket.bufferedAmount` for any single client exceeds 1MB.
- Mobile client sees event IDs jump by 100+ on reconnect (events were queued for it specifically).

**Phase to address:** P1 — GW-01 (supervisor hardening); also relevant to TEST-01.

---

### Pitfall 7: Device Token in WebSocket URL Leaks via Server Logs and Referrer

**What goes wrong:**
The current WS ticket is passed as `?ticket=<uuid>` in the URL query string. When AUTH-01 lands and the device token is added to the ticket-issuing request, or if the device token itself ends up in a URL (e.g., a future `/api/sessions?token=...` shortcut), it will appear in:
- Node.js/Hono access log entries.
- Browser history and the browser devtools Network tab.
- Proxy logs (Tailscale, Cloudflare Tunnel).
- The `Referer` header sent to any third-party resource loaded by the web app.

If the web app ever loads a third-party font, analytics, or CDN resource, the Referer header sends the full URL including the token to that third party.

**Why it happens:**
Putting auth credentials in query strings is the simplest browser-compatible approach when custom headers are not available for WS connections. The design correctly uses a short-lived one-time ticket (60s TTL, single use), which limits the blast radius — but only if the web app has no third-party requests and the Gateway has no access logging.

**How to avoid:**
- Keep the current one-time ticket design (correct). The ticket's 60s TTL and single-use invalidation already prevent replay of a logged ticket.
- Add Gateway-side access log masking: replace ticket values in logged URLs. In the Hono access logger, apply a regex mask to `req.url` before logging: `url.replace(/[?&]ticket=[^&]+/, '?ticket=[REDACTED]')`.
- Ensure the web app's Content Security Policy (`connect-src`) prevents any third-party requests that would receive Referer headers containing the session URL.
- Do NOT put the long-lived device token in a URL ever — only in `Authorization: Bearer` header or in the POST body of the ticket exchange.
- Test: write a unit test asserting that `POST /api/ws-ticket` response body never includes the raw device token, only an opaque ticket UUID.

**Warning signs:**
- Server access logs show `?ticket=<uuid>` in plaintext.
- Any future debug log includes `Authorization: Bearer` in a URL.

**Phase to address:** P1 — AUTH-01/AUTH-02 (when device token is introduced, log masking must land simultaneously).

---

### Pitfall 8: launchd KeepAlive Crash Loop from Gateway Port Conflict or EPIPE

**What goes wrong:**
When `tether gateway` is registered as a macOS `LaunchAgent` with `KeepAlive: true`, a crash loop can form in two ways:
1. The Gateway process starts, fails because port 4789 is already in use (a previous stale instance), exits with a non-zero code, and launchd immediately restarts it — which fails again. After 10 rapid failures, launchd throttles with exponential backoff (up to 5 minutes). The UI shows "Gateway failed to start" with no clear reason.
2. When the parent process (e.g., a terminal) closes its stdout/stderr pipe, the Gateway receives `EPIPE` on its first `console.log()` call after startup. Since EPIPE is unhandled in Node.js by default in some versions, the process crashes immediately, triggering the same loop.

**Why it happens:**
`KeepAlive: true` is unconditional — it restarts on any non-zero exit, including failed startup. The Gateway currently has no startup health check, no port conflict detection with a user-friendly exit code, and no SIGTERM-aware graceful drain before close.

**How to avoid:**
- Use `KeepAlive: { SuccessfulExit: false }` (restart only on crash, not clean exit). This prevents restart after `tether gateway stop`.
- Before binding, check if the port is in use with a TCP probe. If in use, log to the launchd log file (not stdout) and exit with code 0 (clean exit) — this prevents the restart loop.
- Handle EPIPE explicitly: `process.stdout.on('error', (err) => { if (err.code === 'EPIPE') process.exit(0); })`.
- Use `StandardOutPath` and `StandardErrorPath` in the plist to route logs to `~/.tether/gateway.log` — this avoids the pipe closure issue entirely.
- Test: write a test that starts a Gateway on port 4789, then starts a second Gateway on the same port, and asserts the second exits with code 0 and logs a human-readable "port in use" message.

**Warning signs:**
- `launchctl list com.tether.gateway` shows `LastExitStatus: 256` or similar.
- `~/.tether/gateway.log` shows rapid repeated startup/shutdown timestamps.
- The Gateway PID in `~/.tether/gateways.json` changes every 10-30 seconds.

**Phase to address:** P1 — GW-02 (launchd evaluation and initial implementation).

---

### Pitfall 9: launchd PATH Does Not Include nvm/nodenv/Homebrew Node

**What goes wrong:**
When the Gateway runs as a macOS `LaunchAgent`, it inherits launchd's minimal environment, not the user's shell PATH. If `node` was installed via nvm, nodenv, or `~/.local/bin`, the `ProgramArguments` entry `node` is not found and the LaunchAgent exits immediately with `EX_CONFIG` (exit code 78). This is the most common launchd failure mode for Node.js services on developer machines.

**Why it happens:**
launchd resolves `ProgramArguments[0]` using its own PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), not the user's shell PATH. `~/.nvm/versions/node/<version>/bin` is not in this list. The `EnvironmentVariables.PATH` key in the plist is applied to child processes, not to the resolution of `ProgramArguments[0]` itself.

**How to avoid:**
- The plist generator must use the absolute path to `node` at install time: `$(which node)` or `$(command -v node)`.
- At install time, emit a plist with `ProgramArguments: ["/Users/<user>/.nvm/versions/node/v20.x.x/bin/node", ...]` — not `["node", ...]`.
- Set `EnvironmentVariables.PATH` in the plist to include `$(dirname $(which node)):$(dirname $(which tsx)):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` for child process resolution.
- Test: write a shell test that generates the plist, loads it with `launchctl load`, checks `launchctl list com.tether.gateway` shows a running PID (not error status), and verifies the Gateway responds to `GET /api/sessions`.

**Warning signs:**
- `launchctl list com.tether.gateway` shows `LastExitStatus: 78`.
- No entry in `~/.tether/gateways.json` after reboot.
- `launchctl log show --predicate 'subsystem == "com.apple.launchd"'` shows spawn failure with `ENOENT`.

**Phase to address:** P1 — GW-02.

---

### Pitfall 10: Pairing Code TOCTOU — Token Written Before Code Is Verified

**What goes wrong:**
A naive pairing implementation writes the device token to the database when the code is *generated* rather than when it is *verified by the user*. An attacker on the LAN who can observe network traffic (or who guesses the short numeric code) can replay the code exchange endpoint before the legitimate user does, registering their own device. Alternatively, the code is checked and then the token is written in two separate operations without a transaction, creating a window where two simultaneous requests can both pass the code check and both register tokens.

**Why it happens:**
Pairing flows feel simple ("generate code → user enters code → save token") and developers often skip the transactional atomicity of the verify-and-write step. Short numeric codes (6 digits) have only 1,000,000 possibilities and are typically valid for 5+ minutes, making brute-force feasible on a LAN.

**How to avoid:**
- Use a cryptographically random 6-character alphanumeric code (base36), giving ~2.2 billion possibilities, not a 6-digit decimal.
- Make the verify-and-write atomic using a SQLite transaction: `BEGIN IMMEDIATE; SELECT code WHERE expires_at > now; DELETE code; INSERT device_token; COMMIT`. The `BEGIN IMMEDIATE` acquires a write lock immediately, preventing TOCTOU.
- Store the pairing code's HMAC (not plaintext) in the DB. The comparison uses `crypto.timingSafeEqual()` to prevent timing attacks.
- Rate-limit the verify endpoint to 5 attempts per code before invalidating it.
- Test names: `auth.test.ts > pairing code > rejects second use of same code`, `pairing code > concurrent requests both fail after first succeeds`.

**Warning signs:**
- Pairing code endpoint accepts the same code twice in concurrent requests.
- Pairing code length is less than 8 characters (too short for LAN brute-force resistance).
- Code verification and token write are not in the same SQLite transaction.

**Phase to address:** P1 — AUTH-02 (pairing flow implementation).

---

### Pitfall 11: tmux Transport Left Active Alongside PTY — Silent Dual-Path Bugs

**What goes wrong:**
Because both `tmux` and `pty-event-stream` transports are still live in the codebase (see CONCERNS.md), any new code that touches session state must explicitly handle both. If a developer adds new logic (e.g., for auth, retention, or supervisor heartbeat) and only tests the PTY path, the tmux path silently breaks. Users who have old `tether_*` tmux sessions in the DB will see unexpected behavior: sessions stuck at `running` status, stop button returning 501, controller handoff events referencing non-existent WS clients.

**Why it happens:**
The dual-transport design was intentional as a migration bridge. The exit criterion (CLEAN-01) is defined but not yet implemented. In the meantime, new code developed against the PTY path often forgets the tmux branch entirely.

**How to avoid:**
- Land CLEAN-01 (tmux transport removal) early in v0.3 P2, not last. Every day it stays live is a day new code might re-entrench it.
- Until removal, add a lint rule or code comment at the top of `daemon.ts`: `// MIGRATION NOTE: Remove all tmux branches when CLEAN-01 lands`.
- Write a test that asserts no `tmux` session can be created via the current API (i.e., `POST /api/sessions` with `transport: 'tmux'` returns 400 or 409).
- For users with existing tmux sessions in `~/.tether/tether.db`: the Gateway startup migration should update any `transport='tmux'` sessions with `status='running'` to `status='lost'` on startup, same as PTY sessions without live handles.

**Warning signs:**
- Any new test that uses a tmux session to test a new feature.
- `grep -r "transport === 'tmux'"` returns >10 hit sites (currently ~8 in `daemon.ts`).
- A new endpoint is added without a `session.transport !== 'pty-event-stream'` guard at the top.

**Phase to address:** P2 — CLEAN-01/CLEAN-02; but the tmux migration test should be added in P0/P1.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `env: process.env` in `pty.spawn()` | No configuration needed | Gateway env (with secrets) leaks into agent child process | Never — add allowlist before launchd |
| `tickets` Map without size cap | Simple implementation | Memory DoS: attacker creates millions of tickets | Never — cap at 10,000 entries, sweep expired |
| `controllers` Map never GC'd on session end | Simple bookkeeping | Memory leak if sessions accumulate over days | Add `onExit` cleanup hook |
| Multiple `new Store()` per CLI invocation | Each command is independent | Leftover WAL/SHM files after CLI exits | Acceptable until multi-session Gateway lands |
| `stripAnsi` transcript fallback | Legacy snapshot still works | Stale code survives CLEAN-01 | Remove when tmux path is gone |
| HTTP polling fallback at 500ms | Browser compat | 60 SQLite reads/min per browser tab | Remove once WS is proven stable |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| node-pty on macOS | Pin to any `1.2.0-beta.*` without verifying fd leak fix | Use `>=1.2.0-beta.10`; verify with `lsof` health check |
| better-sqlite3 | Assume WAL auto-manages itself | Schedule explicit `wal_checkpoint(RESTART)` every 5 min |
| launchd `KeepAlive` | Set `true` without crash loop guard | Use `SuccessfulExit: false`; probe port before bind |
| xterm.js + node-pty resize | Propagate resize immediately on every browser resize event | Debounce 150ms; only controller triggers `pty.resize()` |
| ws library broadcast | `socket.send()` without checking `bufferedAmount` | Check threshold, disconnect slow clients |
| WS ticket in URL | Log `req.url` verbatim | Mask ticket value in access logs |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| WAL checkpoint starvation | `tether.db-wal` > 10MB; queries slow | Periodic `PRAGMA wal_checkpoint(RESTART)` | After 2+ hours of active session |
| `transcript()` reverse-then-load | Each call loads up to 5000 rows into JS memory | Delete when tmux path removed; event store only | Any call on session with >5000 terminal.output events |
| HTTP event polling at 500ms | SQLite reads 120/min per tab | Remove polling fallback after WS stable | Immediately with >2 browser tabs open |
| Broadcast to slow WS client | Gateway heap grows 1MB/min | `bufferedAmount` check before send | Any session with a mobile client on a flaky connection |
| No output batching on PTY exit | `onExit` calls `flushOutput()` then publishes — fine; but if multiple sessions exit simultaneously, many concurrent SQLite writes | Already batched via `outputBuffer`; acceptable | Not a concern until >5 concurrent sessions |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `env: process.env` in PTY spawn | API keys in Gateway env leak to agent child | Explicit env allowlist: `PATH`, `HOME`, `USER`, `TERM`, `LANG` + provider keys only |
| Ticket in URL without log masking | Ticket value in access logs / proxy logs | Mask `?ticket=` in Hono access logger |
| `POST /api/ws-ticket` no CSRF/Origin check | Any web page the user visits can create a ticket and open a WS | Require `Sec-Fetch-Site: same-origin` on ticket endpoint |
| `~/.tether/` directory created with default umask | World-readable DB and gateways.json | `mkdirSync(dir, { recursive: true, mode: 0o700 })` |
| Pairing code not atomic verify-and-write | TOCTOU race allows two devices to register on same code | `BEGIN IMMEDIATE` transaction wrapping check + insert |
| Device token stored as plaintext hash | Token theft from DB | Store PBKDF2/bcrypt hash of token; compare with `timingSafeEqual` |
| WebSocket `close()` reason leaks session existence | `'session not found'` tells attacker what sessions exist | Uniform generic close code for all auth failures |

---

## "Looks Done But Isn't" Checklist

- [ ] **Raw mode cleanup:** `setRawMode(false)` is called in ALL exit paths — verify with `test: SIGTERM kills attach → stty echo still set`.
- [ ] **Bracketed paste:** Paste of >1KB string through WS input arrives intact at PTY child — verify with `/bin/cat` echo test.
- [ ] **Resize debounce:** 5 rapid resize frames produce exactly 1 `terminal.resize` event in the store — verify with event count assertion.
- [ ] **WAL checkpoint:** After 10,000 event inserts, `tether.db-wal` is smaller than 5MB — verify by checking file size after `wal_checkpoint(PASSIVE)`.
- [ ] **Ticket log masking:** Gateway access log for `GET /api/sessions/.../stream?ticket=...` shows `[REDACTED]` — verify with log output test.
- [ ] **Port conflict exits cleanly:** Starting second Gateway on port 4789 exits with code 0 — verify with integration test.
- [ ] **node-pty fd leak:** After 20 sequential session create/exit cycles, `lsof -p <pid> | wc -l` returns same count as baseline — verify in CI.
- [ ] **Slow client disconnect:** Mock WS client that never reads gets closed by Gateway after 256KB queues — verify with bufferedAmount test.
- [ ] **tmux sessions marked lost on startup:** Existing `transport='tmux'` `status='running'` sessions are set to `lost` at Gateway startup — verify with Store unit test.
- [ ] **Pairing code single-use:** Two concurrent requests with the same pairing code — only one succeeds — verify with concurrent Promise.all test.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Raw mode left on terminal | LOW | User runs `stty sane` or `reset`; add cleanup to attach |
| fd leak causing posix_spawnp failed | MEDIUM | Restart Gateway; upgrade node-pty version |
| WAL file bloated | MEDIUM | `sqlite3 ~/.tether/tether.db 'PRAGMA wal_checkpoint(TRUNCATE)'` |
| launchd crash loop | MEDIUM | `launchctl unload plist; fix port conflict; launchctl load plist` |
| TOCTOU pairing race | HIGH | Revoke all device tokens; re-pair all devices |
| Slow client OOM | MEDIUM | Restart Gateway; add `bufferedAmount` guard before deploy |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Raw mode not restored on crash | P0 — EXP-01/EXP-02 | Integration test: SIGTERM → `stty echo` still set |
| node-pty fd leak (posix_spawnp) | P1 — GW-01 (upgrade node-pty to beta.12) | Test: 20 sequential spawns succeed without EMFILE |
| PTY write corruption >1024 bytes | P0 — EXP-03 | Integration test: 2KB paste arrives intact at PTY child |
| Alternate screen resize flicker | P0 — EXP-04/EXP-05 | Test: 5 rapid resize frames → 1 `terminal.resize` event |
| WAL checkpoint starvation | P1 — RETAIN-01 | Test: 10K inserts → `wal_checkpoint(PASSIVE)` reclaims WAL |
| Slow WS client stalls broadcast | P1 — GW-01 | Test: mock slow client → Gateway closes it, does not OOM |
| Ticket in URL without log masking | P1 — AUTH-01 | Test: access log shows `[REDACTED]` for ticket value |
| launchd crash loop | P1 — GW-02 | Test: second Gateway startup exits 0 with "port in use" log |
| launchd PATH not finding node | P1 — GW-02 | Test: generated plist uses absolute node path |
| Pairing code TOCTOU | P1 — AUTH-02 | Test: concurrent verify requests → exactly one succeeds |
| tmux transport dual-path bugs | P2 — CLEAN-01 | Test: `transport='tmux'` sessions marked `lost` at startup |

---

## Sources

- Codebase audit: `/Users/dream/code/tether/.planning/codebase/CONCERNS.md` (2026-05-01)
- node-pty issue #907: posix_spawn fd leak on macOS (open, affects beta.2)
- node-pty releases: beta.10 fixes macOS fd leaks; beta.12 is current stable beta
- macOS PTY 1024-byte write corruption: https://github.com/jcansdale/macos-pty-multiline-bug
- VS Code issue #296955: terminal corrupts multiline commands >1024 bytes
- node-pty PR #831: CustomWriteStream EAGAIN retry (merged in 1.1.0)
- xterm.js issue #1701: resize from left causes flicker
- xterm.js issue #1914: terminal resize roundtrip
- SQLite WAL checkpoint starvation: https://loke.dev/blog/sqlite-checkpoint-starvation-wal-growth
- better-sqlite3 performance docs: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md
- WebSocket backpressure: https://skylinecodes.substack.com/p/backpressure-in-websocket-streams
- Token in URL security: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- launchd PATH issue: https://lucaspin.medium.com/where-is-my-path-launchd-fc3fc5449864
- launchd KeepAlive crash loop: openclaw issue #21685, #26507
- launchd EPIPE crash: openclaw issue #4632
- Raw mode not restored: https://github.com/slopus/happy/issues/423 + nodejs/node #41143
- Bracketed paste: https://cirw.in/blog/bracketed-paste

---
*Pitfalls research for: PTY event-stream / multi-device CLI / supervisor daemon (Tether v0.3)*
*Researched: 2026-05-01*
