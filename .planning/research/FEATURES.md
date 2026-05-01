# Feature Research

**Domain:** Multi-device agent console (remote access milestone)
**Researched:** 2026-05-01
**Confidence:** HIGH — primary sources: PROJECT.md, Phase 2 design doc, paseo.sh, abduco/mosh/zellij docs, xterm.js issue tracker

---

## Scope Note

Phase 2 already shipped the following. This file does NOT re-list them as targets — they are the baseline v0.3 builds on:

- PTY-backed event stream (node-pty, append-only SQLite event store)
- WebSocket cursor replay + live broadcast + one-time HTTP ticket auth
- `tether run/attach/clients/stop` CLI full set
- `--control / --observe` modes; `active controller owns size`
- Multi-local-terminal attach; controller takeover; last-input-source display
- Web xterm.js render + transcript fallback + localStorage cursor
- replay default 1000 / max 5000 events
- Provider whitelist + binary resolved by Gateway
- PTY output + user.input masked before DB write; raw bytes to PTY
- Gateway default `127.0.0.1`; LAN via explicit `--host 0.0.0.0`
- `lost` status for unrecoverable sessions after Gateway restart
- `approval.requested` / `diff.detected` / `agent.handoff` placeholder event types

---

## Feature Landscape

### Table Stakes for v0.3 — Remote Access

Features a user MUST experience before they will trust opening their Gateway to a phone over LAN. Missing any one of these makes the product feel broken or unsafe.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Detach hotkey / command mode** (EXP-01) | Every terminal multiplexer (tmux `Ctrl-b d`, abduco `Ctrl-\`, dtach `Ctrl-\`) has a dedicated detach key. Without one, closing the terminal window is the only way to detach — which feels like killing the session. Users will assume closing = kill. | MEDIUM | Must NOT replicate tmux prefix pattern. abduco uses `Ctrl-\`; options: `Ctrl-]`, `Ctrl-\`, or a short escape-then-key command mode. The key must transparently pass `Ctrl-C`, `Ctrl-D`, Enter, Backspace to the agent without interception. |
| **Enter / Backspace / Ctrl-C / Ctrl-D passthrough verified** (EXP-02) | These are the four most-used keystrokes in any CLI interaction. Users don't consciously notice them working correctly, but immediately notice when they don't. Codex/Claude interactive prompts heavily depend on Ctrl-C to cancel and Ctrl-D to signal EOF. | LOW-MEDIUM | xterm.js on mobile has known issues with predictive keyboard and backspace history (xterm.js #2403, #5377). CLI raw mode passthrough should be straightforward; web path requires testing on iOS Safari and Android Chrome. |
| **Bracketed paste first-version strategy** (EXP-03) | Users regularly paste multi-line prompts, code snippets, and API keys into agent sessions. Without bracketed paste support, pasted newlines execute immediately, truncating or mis-routing the paste. Security: unguarded paste can accidentally run embedded shell commands. | MEDIUM | PTY respects bracketed paste natively if the agent program requests it (`\e[?2004h`). The Tether terminal client (both CLI and xterm.js) must not strip `\e[200~` / `\e[201~` sequences. Decision needed: does the Tether layer itself send bracketed paste wrappers or pass them through transparently? First version = transparent passthrough. |
| **ANSI color / cursor / clear screen / alternate screen** (EXP-04) | Codex and Claude both use full TUI interfaces with color, cursor positioning, and alternate screen (full-screen mode). Users switching from `tmux attach` will immediately notice any degradation in rendering. | MEDIUM | xterm.js handles ANSI natively. The CLI attach path writes raw bytes to stdout, so ANSI works if bytes pass through cleanly. Risk areas: alternate screen on reconnect (state must be replayed correctly) and clear-screen (should not lose scrollback in transcript). |
| **Resize / TUI reflow after attach (complex TUI)** (EXP-05) | Codex and Claude repaint the entire screen on resize. When a new client attaches with different dimensions than the current controller, or when control transfers, the agent must receive a resize signal to reflow. Without this, the TUI shows a garbled layout. | HIGH | `active controller owns size` is implemented, but the claim+resize event chain for complex TUI startup needs dedicated verification. Specifically: initial size must be sent at session create time (already done), but controller handoff resize must reliably trigger `SIGWINCH` to the agent process. |
| **Device token auth on all write operations** (AUTH-01) | Any user who hears "remote access" expects that a random phone on the same Wi-Fi cannot type into their agent. Input, resize, stop, claim-control are write operations and must require an authenticated token. Without this, LAN exposure is insecure. | MEDIUM | Currently only the WS ticket endpoint requires Bearer. The write paths (input, resize, stop, claim-control) are not yet gated. This is the single hardest security gate before LAN exposure is safe. |
| **Complete pairing flow** (AUTH-02) | Users expect a first-time pairing experience analogous to Bluetooth or SSH key exchange — "phone shows a code, I confirm on the computer." Without this, device token auth has no enrollment path. | MEDIUM | Paseo uses a similar flow (`paseo daemon pair --json`). The design is specified in the Phase 1.5 section of the agent console doc: one-time code + 5-min expiry + QR + token hash in SQLite, no plaintext. |
| **Event retention initial policy** (RETAIN-01) | Users expect session history to survive Gateway restarts and be available for replay. Without a retention limit, the DB grows unboundedly. Without a minimum retention, reconnecting clients find no history. | LOW-MEDIUM | 7-day / 100MB-per-session rolling window is the right starting default (matches EveBox's default and typical CI log retention). Cleanup strategy: delete oldest events first by session, then VACUUM. |
| **Gateway as true supervisor — single-process PTY owner** (GW-01) | Users expect `tether gateway start` to be the one process that owns all sessions, survives CLI disconnects, and holds PTY handles. Without this, running multiple `tether run` commands creates orphaned PTY sessions with no single owner. | HIGH | Currently each CLI invocation holds its own PTY. The supervisor must become the single process that spawns and holds all PTY sessions, with the CLI as a pure API caller. This is architecturally the most complex item in v0.3. |
| **macOS launchd background service** (GW-02) | On macOS, users expect background services to use launchd. Without it, Gateway dies on logout or terminal close — meaning the phone finds nothing to connect to. `KeepAlive: true` + `RunAtLoad: true` is the standard pattern. | LOW-MEDIUM | A minimal `com.tether.gateway.plist` in `~/Library/LaunchAgents/` with `KeepAlive: true` and `ThrottleInterval: 10` is sufficient. `tether gateway install` and `tether gateway uninstall` should manage the plist. |
| **tmux fallback removed from product path** (CLEAN-01) | Users asked to install Tether should not discover a hidden tmux dependency. Leaving it in creates confusion about which transport is active and maintains a dead code path with real security surface. | LOW | `--transport tmux` flag removal. Decision on whether to keep the field as a protocol extension point is independent of removing the tmux codepath. |
| **Auth / security integration tests** (TEST-01) | Before exposing Gateway to a phone, the auth gating must be proven by tests, not just manually verified. This is especially true for the provider whitelist and secret mask paths which have security implications. | MEDIUM | Tests must cover: unauthenticated write operations return 401, provider whitelist rejects unknown binaries, secret mask covers API keys in both PTY output and user.input events, old Phase 1 compatibility endpoints still function. |

### Differentiators (v0.3 scope — what makes Tether better than tmux + phone browser)

These are not expected by users the first time, but become the reason users prefer Tether over the alternatives once they discover them.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Event cursor replay on reconnect** | tmux gives you only the current screen state (capture-pane). Tether gives you the full event history from any point. A phone reconnecting after 30 minutes of being off-network can replay the last N events and see exactly what the agent did. mosh synchronizes only the visible screen state — no history. | Already shipped (Phase 2A) | Differentiator value is only realized once AUTH-01 and GW-01 are done — otherwise the replay endpoint is accessible to unauthenticated clients. |
| **Multi-client controller handoff with visibility** | tmux has no concept of "which device is currently in control." Tether's `active controller owns size` + `client.control_changed` events + `tether clients <id>` display gives every observer visibility into who is driving the agent. | Already shipped (Phase 2B) | Needs verified behavior when controller disconnects mid-TUI-operation (should gracefully fall through to next terminal client, not hang). |
| **Last-input-source visibility** | When two people (or two devices) are both attached, it is unclear who typed what. Tether records `clientId` on every `user.input` event and surfaces "last input from <device>" in the UI. tmux, abduco, and mosh have no concept of input attribution. | Already shipped (Phase 2B) | Value realized only once device naming is wired to the pairing flow (AUTH-02). Before pairing, all clients show as anonymous. |
| **Secret mask before DB write** | tmux capture-pane exposes raw PTY output including any API keys or tokens pasted by the user. Tether masks known secret patterns before storing in SQLite, so the event DB is safe to inspect, export, or relay without leaking credentials. Paseo does not document equivalent behavior. | Already shipped (Phase 2C) | Mask patterns must be kept updated as providers evolve. v0.3 scope: initial patterns covering OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN common formats. |
| **Structured event placeholders for diff/approval** | tmux is pure byte stream. Tether's event schema reserves `approval.requested`, `diff.detected`, `agent.handoff` namespaces, so Phase 4 UI can be built without a schema migration. No competitor ships this at v0.3 stage. | Already shipped (Phase 2D) — needs exhaustive switch tests (CLEAN-03) | Value is latent until Phase 4. CLEAN-03 adds a TypeScript exhaustive switch test to prevent silent event type drift. |
| **Gateway-owned PTY (no tmux dependency)** | abduco and dtach require an external program. tmux-based approaches (claude-squad, agent-of-empires) mean the phone is a second-class citizen using capture-pane. Tether's Gateway owns the PTY directly, making phone and desktop first-class equal clients. | Already shipped (Phase 2) | This is the foundational differentiator. All other differentiators depend on it. |

### Anti-Features (Deliberately NOT in Tether v0.3 or beyond)

These are features users may request, competitors may have, or that seem like natural extensions — but are explicitly out of scope with documented rationale.

| Feature | Why Requested | Why It's an Anti-Feature | What Tether Does Instead |
|---------|---------------|--------------------------|--------------------------|
| **tmux pane split / window manager** | Power users want multiple panes visible simultaneously, as in tmux. Zellij and WezTerm both emphasize pane splitting as a differentiator. | Tether is a single-session agent console, not a general terminal multiplexer. Building a window manager means maintaining a layout engine, keybinding system, and pane lifecycle — a multi-month distraction with no agent-console value. Each agent gets its own session; users switch sessions, not panes. | `tether ls` + `tether attach <id>` to switch sessions. Multiple sessions in separate terminal windows is the correct model for multi-agent use. |
| **tmux prefix keybinding system** | Muscle memory. tmux users expect `Ctrl-b` prefix sequences. | A prefix system means intercepting key sequences before forwarding to the agent. Every interception is a potential keybinding conflict with Codex/Claude TUI shortcuts. Tether's detach hotkey must be minimal and non-conflicting. | Single dedicated detach key (EXP-01) plus command mode if needed. No prefix system. |
| **Copy mode / scrollback navigation** | Users want to scroll back through session output in the terminal itself. tmux copy mode (`Ctrl-b [`) is a common workflow. | PTY raw mode passthrough means Tether cannot insert a scrollback cursor without intercepting all input. Web clients already get scrollback via xterm.js. CLI clients should use the host terminal's native scrollback. Implementing copy mode means reimplementing significant terminal emulator logic. | CLI: host terminal scrollback (iTerm2, Ghostty, etc.). Web/mobile: xterm.js scrollback + transcript endpoint for deep history. |
| **Cloudflare Tunnel / Tailscale integration engineering** | Users want to reach their Gateway from outside their home network without port forwarding. | Full tunnel integration requires testing across network topologies, managing `--public-url` routing, and handling TLS termination edge cases. This is a Phase 1.5 complete-version concern, not a v0.3 concern. v0.3 only guarantees LAN + device token security. | v0.3: manual Cloudflare Tunnel / Tailscale works today via `--host 0.0.0.0` + `--public-url`. Engineering adapter is v0.4+. |
| **Self-built relay / encrypted relay** | Users want remote access from outside home Wi-Fi without running their own tunnel. Paseo ships an encrypted relay with ECDH + AES-256-GCM. | Building a relay requires a cloud deployment, relay protocol, key exchange, and ongoing operational cost. This is Phase 3c, not v0.3. Building it before LAN + auth is stable creates a larger attack surface with no gain. | Users on v0.3 use Cloudflare Tunnel or Tailscale for remote access. Relay is explicitly Phase 3c. |
| **Arbitrary shell execution (POST /api/exec)** | Advanced users want to run arbitrary commands on the Gateway machine from their phone. | This is an RCE vulnerability as a feature. The entire Gateway security model is built around only spawning whitelisted providers. Any arbitrary exec endpoint makes the phone a full remote code execution console to the user's machine. | Provider whitelist (codex/claude/opencode only). No exec endpoint, ever. |
| **Plugin ecosystem** | Tmux and Zellij both have plugin systems. Power users want to extend behavior. | A plugin system requires a stable API surface, versioning, sandboxing, and documentation. This is Phase 4+ work and not the product's differentiator. Tether's differentiator is agent-native structured events, not extensibility. | Structured event types (`approval.requested`, etc.) are the extension surface for Phase 4 UI. |
| **IDE features: diff editor, code editing, LSP** | Users reviewing agent output on mobile may want to edit code inline. | This is the IDE-slippery-slope. The instant Tether has a code editor, it competes with VS Code/Cursor on terms where it cannot win. The product value is the console/control layer, not the editing surface. | Phase 4: read-only diff view. Never: inline edit, LSP, syntax checking. |
| **Multi-machine federation** | Users want to see sessions from multiple machines in one console. | Multi-machine federation requires inter-daemon trust model, network discovery, and federated session registry. This is Phase 3b — architecturally dependent on a stable single-machine model being proven first. | v0.3 and v0.4: single Gateway, single machine. Phase 3b: federation. |
| **Push notifications** | Mobile users want to be notified when an agent finishes or needs approval. | Push notifications require APNs/FCM credentials, a cloud intermediary, and a native app or service worker. This is Phase 3c. Building push before the session model is stable means building it twice. | v0.3: users poll or keep the phone browser tab open. Phase 3c: push. |

---

## Feature Dependencies

```
AUTH-02 (pairing flow)
    └──enables──> AUTH-01 (device token on writes)
                      └──enables──> GW-01 (supervisor single process)
                                        └──enables──> GW-02 (launchd)
                                                          └──enables──> Safe LAN exposure to phone

EXP-01 (detach hotkey)
    └──requires──> EXP-02 (Enter/Ctrl-C passthrough verified)
                       [detach key must not intercept passthrough keys]

EXP-03 (bracketed paste)
    └──complements──> EXP-02 (paste is an input path variant)

EXP-04 (ANSI/alternate screen)
    └──required by──> EXP-05 (TUI reflow after resize/attach)
                          [resize validation only meaningful if ANSI rendering is correct]

RETAIN-01 (event retention)
    └──independent of auth, but must land before──> GW-01
       [supervisor must manage retention cleanup as it owns all sessions]

CLEAN-01 (tmux fallback removal)
    └──depends on──> GW-01 being stable enough to handle all session creation
                     [cannot remove tmux fallback while supervisor is incomplete]

TEST-01 (auth/security tests)
    └──requires──> AUTH-01 + AUTH-02 to be implemented first
    └──gates──> milestone exit (v0.3 done)
```

### Dependency Notes

- **AUTH-02 must precede AUTH-01:** There is no point gating write operations on device tokens that cannot be issued. Pairing creates the token; auth checks the token.
- **GW-01 gates GW-02:** Installing a launchd plist for a process that is not yet a stable supervisor means launchd will repeatedly restart an unstable process. GW-01 (supervisor stability) must be achieved first.
- **EXP-01 must not conflict with EXP-02:** The detach hotkey design must be done with an explicit list of keys it must NOT intercept. Ctrl-C and Ctrl-D are the highest-risk accidental intercepts.
- **CLEAN-01 gates on GW-01:** While `--transport tmux` exists as a fallback, users or CI pipelines might rely on it. Removing it is only safe once the PTY path is proven stable enough to handle all cases the fallback was covering.

---

## v0.3 Milestone Scope

### Must Ship (P0 — milestone exit blocked without these)

- [ ] EXP-01: Detach hotkey / command mode — core local experience gap
- [ ] EXP-02: Enter / Backspace / Ctrl-C / Ctrl-D verified and fixed
- [ ] EXP-03: Bracketed paste first-version strategy
- [ ] EXP-04: ANSI / alternate screen / clear screen verified
- [ ] EXP-05: Complex TUI resize (Codex / Claude startup + controller handoff)
- [ ] AUTH-01: Device token auth on input / resize / stop / claim-control
- [ ] AUTH-02: Complete pairing flow (one-time code + token hash in SQLite)

### Should Ship (P1 — milestone quality blocked without these)

- [ ] RETAIN-01: Event retention (7d / 100MB, rolling cleanup)
- [ ] GW-01: Gateway supervisor single-process PTY owner
- [ ] GW-02: macOS launchd / keepalive initial implementation
- [ ] TEST-01: Auth + whitelist + mask + compatibility integration tests

### Clean Up (P2 — hygiene, unblocked by P0/P1)

- [ ] CLEAN-01: tmux fallback removed from product path
- [ ] CLEAN-02: Evaluate `transport` field retention vs removal
- [ ] CLEAN-03: Structured event exhaustive switch test + Phase 4 documentation

### Deliberately Deferred (not v0.3)

- Cloudflare Tunnel / Tailscale engineering adapter
- Self-built relay
- Multi-machine federation
- Push notifications
- Diff / approval UI
- Plugin system
- Any IDE feature

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| AUTH-01 (write auth) | HIGH — security gate for phone exposure | MEDIUM — route-level middleware | P0 |
| AUTH-02 (pairing flow) | HIGH — required for AUTH-01 | MEDIUM — one-time code + SQLite | P0 |
| EXP-01 (detach hotkey) | HIGH — local experience parity | MEDIUM — key intercept + command mode design | P0 |
| EXP-02 (key passthrough verified) | HIGH — baseline usability | LOW — mostly testing + targeted fixes | P0 |
| EXP-03 (bracketed paste) | HIGH — prevents accidental command execution | LOW-MEDIUM — passthrough policy decision | P0 |
| EXP-04 (ANSI verified) | HIGH — rendering correctness | LOW-MEDIUM — mostly testing + fixes | P0 |
| EXP-05 (TUI resize) | HIGH — Codex/Claude usability | HIGH — resize event chain verification | P0 |
| GW-01 (supervisor) | HIGH — architectural prerequisite for stability | HIGH — refactor PTY ownership | P1 |
| RETAIN-01 (retention) | MEDIUM — prevents DB growth | LOW — time-based DELETE + VACUUM | P1 |
| GW-02 (launchd) | MEDIUM — background keepalive | LOW — plist + install command | P1 |
| TEST-01 (security tests) | HIGH — confidence gate | MEDIUM — integration test setup | P1 |
| CLEAN-01 (tmux removal) | MEDIUM — cleanliness | LOW — flag removal | P2 |
| CLEAN-03 (exhaustive switch) | LOW — future-proofing | LOW — TypeScript type test | P2 |

---

## Competitor Feature Analysis

| Feature | tmux | mosh | abduco / dtach | Paseo | Tether v0.3 target |
|---------|------|------|----------------|-------|-------------------|
| Session keepalive | Yes (tmux server) | No (relies on tmux) | Yes (socket-based) | Yes (daemon) | Yes (Gateway supervisor — GW-01) |
| Detach hotkey | `Ctrl-b d` (prefix) | N/A | `Ctrl-\` (no prefix) | Not documented | Single non-prefix key (EXP-01) |
| Multi-client attach | Yes (any tmux client) | No | Yes (multiple clients) | Yes | Yes (already shipped) |
| Read-only observe mode | No native support | No | Yes (`-r` flag) | Not documented | Yes (`--observe`, already shipped) |
| Controller/observer distinction | No | No | Partial (read-only flag) | Partially (attach mode) | Yes (already shipped) |
| Input attribution | No | No | No | No | Yes (last-input-source, already shipped) |
| Event cursor replay | No (capture-pane only) | No (visible state sync) | No | Via timeline events | Yes (already shipped) |
| Phone / browser access | Weak (capture-pane screenshot style) | No | No | Yes (native) | Yes (already shipped) |
| Device token auth | N/A (local only) | N/A | N/A | Yes (pairing) | AUTH-01 + AUTH-02 (v0.3) |
| Pairing flow | N/A | N/A | N/A | Yes (QR + code) | AUTH-02 (v0.3) |
| Secret mask before storage | No | No | No | Not documented | Yes (already shipped) |
| Event retention policy | N/A | N/A | N/A | N/A (JSON files) | RETAIN-01 (v0.3) |
| Structured event types (diff/approval) | No | No | No | Partially (timeline) | Placeholders shipped; UI Phase 4 |
| Background supervisor | tmux server (auto-start) | N/A | Unix socket daemon | launchd/systemd per docs | GW-02 (v0.3) |
| Bracketed paste support | Yes (transparent) | Yes | Yes | Assumed yes | EXP-03 (v0.3 verification) |
| ANSI / alternate screen | Yes (mature) | Visible state sync | Yes (transparent) | Yes | EXP-04 (v0.3 verification) |
| Resize with multi-size clients | Best-effort (smallest) | N/A | Last-attach wins | Adaptive | `active controller owns size` (already shipped) |
| Pane split / window manager | Yes (core feature) | No | No | Yes (desktop UI) | Deliberate anti-feature |
| Plugin ecosystem | Yes (extensive) | No | No | No | Deliberate anti-feature |
| Copy mode | Yes | No | No | No | Deliberate anti-feature |
| Arbitrary shell exec | Yes (any command) | Yes (SSH) | Yes | No (whitelist) | Permanent anti-feature |

---

## Sources

- `/Users/dream/code/tether/.planning/PROJECT.md` — v0.3 Active requirements, Out of Scope decisions
- `/Users/dream/code/tether/docs/working/2026-05-01-tether-agent-console.md` — Phase design, competitor analysis (paseo, codex_manager)
- `/Users/dream/code/tether/docs/working/2026-05-01-phase-2-pty-event-stream.md` — Phase 2 design, event schema, CLI attach, tmux parity table
- [Paseo product site](https://paseo.sh/) — multi-device agent console feature set (HIGH confidence — official)
- [Paseo CLI docs](https://paseo.sh/docs/cli) — attach, send, daemon pair commands (HIGH confidence — official)
- [Paseo changelog](https://paseo.sh/changelog) — v0.1.51 pairing fix, v0.1.60 per-host config, v0.1.65 latest (HIGH confidence — official)
- [abduco documentation](https://www.brain-dump.org/projects/abduco/) — session manager features, `Ctrl-\` detach, read-only mode (HIGH confidence — official)
- [Bracketed paste mode](https://cirw.in/blog/bracketed-paste) — `\e[200~` / `\e[201~` mechanics (HIGH confidence — canonical reference)
- [xterm.js mobile issues #2403](https://github.com/xtermjs/xterm.js/issues/2403) and [#5377](https://github.com/xtermjs/xterm.js/issues/5377) — predictive keyboard, touch limitations (HIGH confidence — official issue tracker)
- [Zellij multiplayer sessions](https://zellij.dev/news/multiplayer-sessions/) — multi-cursor attach model (MEDIUM confidence — official blog)
- [launchd KeepAlive patterns](https://www.launchd.info/) — macOS service plist best practices (HIGH confidence — official docs)
- [EveBox SQLite retention](https://evebox.org/docs/server/sqlite/) — 7-day default, size-based cleanup pattern (MEDIUM confidence — real-world precedent)

---

*Feature research for: multi-device agent console — v0.3 Remote Access milestone*
*Researched: 2026-05-01*
