# Phase 3: Cleanup - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 removes the tmux runtime path so Tether has one active transport before multi-account auth work begins. The deliverable is a single-runtime codebase where new and active sessions are always `pty-event-stream`; tmux is treated only as historical bootstrap data.

This phase may delete tmux helper code, CLI flags, runtime branches, protocol exposure, Web fallback labels, tests, and docs that imply tmux is still executable. It must not implement account/auth, Relay multi-account auth, retention, provider abstraction, UI redesign, or destructive SQLite schema cleanup.

</domain>

<decisions>
## Implementation Decisions

### Runtime Scope
- **D-01:** Delete tmux runtime support completely. `apps/gateway/src/tmux.ts` should be removed, and no CLI, Gateway, Relay, Web, or protocol path may execute tmux commands after this phase.
- **D-02:** New sessions must always use `transport='pty-event-stream'`. No command or API should create `transport='tmux'`.
- **D-03:** `--transport` should be removed from provider commands and `tether run`. It should not appear in help output. Passing `--transport tmux` may fail as an unknown option rather than a custom compatibility path.

### Historical tmux Sessions
- **D-04:** Existing database rows with `transport='tmux'` are retained as historical records but are no longer operational.
- **D-05:** A historical tmux row should be treated as `lost` by Tether. Do not probe `tmux has-session`, do not capture panes, do not send input, and do not try to restore or attach.
- **D-06:** `attach`, `send`, `stop`, and snapshot/API paths for historical tmux rows should return a clear legacy unsupported error. CLI user-facing wording should be Chinese, for example: `旧 tmux 会话已不再支持，请重新创建 PTY session`.
- **D-07:** Do not automatically kill any existing tmux process. Phase 3 removes Tether runtime support; it must not guess whether an external tmux session is safe to terminate.

### Schema and Types
- **D-08:** Keep SQLite columns `sessions.transport` and `sessions.tmux_session_name` in this phase. Do not perform `DROP COLUMN`, table rebuild, or destructive schema migration.
- **D-09:** Keep enough TypeScript representation to read historical rows safely, but tighten active write paths so only `'pty-event-stream'` is valid for new sessions.
- **D-10:** `tmuxSessionName` may remain as a historical/empty field for now. It must not participate in runtime execution after this phase.
- **D-11:** Document `transport` as a retained extension point and historical compatibility field. Any future transport would need a new explicit phase and auth review.

### API, CLI, and Web Semantics
- **D-12:** HTTP API paths that encounter historical tmux sessions should return HTTP `409` with `error: 'legacy tmux session is no longer supported'` or an equivalent stable error code/message.
- **D-13:** `tether ls` may still list historical tmux rows, but should not probe tmux liveness. It should present them as `lost`/legacy rather than running.
- **D-14:** Web session cards should not default unknown transport to `tmux`. Unknown or historical transport may be shown as `legacy`, but the UI must not imply it is still controllable.
- **D-15:** Relay session metadata should no longer advertise `'tmux'` as a valid active transport. Relay should forward only PTY-backed session metadata after this phase.

### Verification
- **D-16:** Phase 3 verification must include static scans in addition to typecheck/test. Runtime source should not contain executable tmux references such as `apps/gateway/src/tmux.ts`, `--transport`, `capturePane`, `createAgentSession`, or tmux-flavored `sendKeys`.
- **D-17:** Run `pnpm typecheck` and `pnpm test`.
- **D-18:** Run a minimal PTY end-to-end verification: start a Gateway, create a PTY session using `/bin/cat` or a provider test command, attach or send input once, stop the session, and confirm the flow does not depend on tmux.

### the agent's Discretion
- Choose exact internal helper names for legacy unsupported errors.
- Choose whether historical tmux rows are normalized to `lost` on read/list or persisted as `lost` when encountered, as long as no tmux runtime probe occurs.
- Choose exact Web display copy for historical transport, as long as it does not imply active support.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 3 goal and success criteria.
- `.planning/REQUIREMENTS.md` — `CLEAN-01` and `CLEAN-02`, plus downstream auth boundaries.
- `.planning/PROJECT.md` — active milestone, validated PTY/event-stream decisions, safety constraints, and out-of-scope items.
- `.planning/STATE.md` — current decisions, especially retained `transport` extension-point decision and multi-account auth sequence.

### Prior Phase Context
- `.planning/phases/01-personal-relay-mvp/01-CONTEXT.md` — Relay bootstrap history and the fact that shared-secret/tmux-era decisions are historical, not the target model.
- `.planning/phases/06-supervisor-launchd/06-CONTEXT.md` — persistent Gateway decisions and explicit deferral of tmux fallback deletion to Phase 3.

### Current Architecture and Docs
- `AGENTS.md` — repository reading order and safety rules.
- `CLAUDE.md` — scoped-change and verification principles.
- `PROJECT.md` — package manager, command conventions, security gates, and validation expectations.
- `AI_CONTEXT.md` — current architecture and the statement that tmux is migration fallback, not the long-term path.
- `docs/current/gateway-supervisor.md` — persistent Gateway behavior and session creation boundaries.
- `docs/current/relay-mvp.md` — current Relay bootstrap behavior and production-auth caveat.

### Codebase Maps
- `.planning/codebase/STACK.md` — workspace stack, node-pty dependency, and current tmux fallback note.
- `.planning/codebase/ARCHITECTURE.md` — current tmux fallback runtime, session abstractions, and anti-patterns.
- `.planning/codebase/INTEGRATIONS.md` — current tmux integration, HTTP/WS endpoints, storage schema, and auth gaps.

### Implementation Entry Points
- `apps/cli/src/main.ts` — provider/run `--transport` flags, tmux creation branch, attach/send/stop/list branching, and user-facing CLI errors.
- `apps/gateway/src/daemon.ts` — tmux branches in session listing, snapshot, send, stop, and WS transport checks.
- `apps/gateway/src/tmux.ts` — tmux helper file to delete.
- `apps/gateway/src/index.ts` — tmux exports to remove.
- `apps/gateway/package.json` — `./tmux` package export to remove.
- `apps/gateway/src/store.ts` — retained `transport` / `tmux_session_name` schema and historical row normalization.
- `apps/gateway/src/store.test.ts` — persistence tests for retained fields and PTY-only active transport.
- `apps/gateway/src/daemon.test.ts` — API tests for PTY-only behavior and legacy tmux unsupported handling.
- `apps/cli/src/main.test.ts` and `apps/cli/src/session-stop.test.ts` — CLI helper tests that may need expansion after removing tmux branches.
- `packages/protocol/src/index.ts` — Relay session transport type should stop advertising `'tmux'` as active.
- `apps/web/src/main.tsx` — session card transport label and legacy display behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PtySessionManager` in `apps/gateway/src/pty.ts` already creates, writes, resizes, stops, records, and publishes PTY event-stream sessions.
- `Store.markRunningPtySessionsLost` already models lost PTY rows on Gateway restart; Phase 3 can use a similar idea for historical tmux rows without probing tmux.
- Existing HTTP route patterns in `apps/gateway/src/daemon.ts` already return structured JSON errors with explicit status codes.
- Existing CLI `stop --all` uses `runningSessionIds`, so Phase 3 should ensure legacy lost rows are not included as runnable sessions.

### Established Patterns
- Runtime code is TypeScript ESM run directly with `tsx`.
- External commands must never use `shell:true`; Phase 3 should reduce command surface by removing tmux helpers rather than adding compatibility wrappers.
- Gateway is the session owner; UI surfaces attach through HTTP/WS and should not replicate runtime ownership logic.
- Sensitive terminal data must continue flowing through `session_events` and masking paths; Phase 3 must not create a parallel transcript path.

### Integration Points
- CLI provider commands and `tether run` currently expose `--transport`; this is the most user-visible cleanup point.
- Gateway `snapshot`, `send`, `stop`, and `list sessions` currently contain tmux branches; these become PTY-only plus legacy unsupported paths.
- Store migration currently defaults missing `transport` to `'tmux'`; Phase 3 must decide how missing/old rows are represented without making tmux active again.
- Protocol and Web still surface transport names to remote clients and users; they need PTY-only active semantics.

</code_context>

<specifics>
## Specific Ideas

- The user approved deleting all tmux runtime support.
- The user selected `lost` as the status/meaning for historical `transport='tmux'` rows.
- The user selected keeping DB fields while tightening runtime behavior.
- The user selected removing `--transport` rather than keeping a compatibility flag.
- The user selected static scan + `pnpm typecheck` + `pnpm test` + minimal PTY E2E as the verification bar.

</specifics>

<deferred>
## Deferred Ideas

- Dropping `sessions.transport` or `sessions.tmux_session_name` from SQLite is deferred. This can be revisited after multi-account auth stabilizes.
- Account/auth implementation remains Phase 5.
- Relay multi-account auth remains Phase 5.
- Retention and WAL checkpoint scheduling remain Phase 6.
- Full diff/file-tree/review UI remains future work outside v0.3.

</deferred>

---

*Phase: 3-Cleanup*
*Context gathered: 2026-05-02*
