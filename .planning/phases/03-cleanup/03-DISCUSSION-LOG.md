# Phase 3: Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 3-Cleanup
**Areas discussed:** Historical tmux sessions, schema and types, CLI/API errors, verification

---

## Historical tmux Sessions

| Option | Description | Selected |
|--------|-------------|----------|
| `lost` | Historical tmux rows mean Tether can no longer manage the session; this is the most accurate status. | ✓ |
| `stopped` | Softer wording for users, but less accurate because the real tmux process may still exist. | |
| `legacy` | Add a new explicit historical status, but this creates more type/UI work. | |

**User's choice:** `lost`
**Notes:** Historical `transport='tmux'` rows remain visible but non-operational. Tether should not probe, restore, attach, send input, or kill tmux sessions.

---

## Schema and Types

| Option | Description | Selected |
|--------|-------------|----------|
| Keep DB fields, tighten runtime | Retain `transport` and `tmux_session_name` in SQLite while removing runtime tmux branches. | ✓ |
| Delete type fields too | Cleaner code, but higher migration and old-row compatibility risk. | |
| Keep everything one more round | Conservative, but leaves more auth-era branches. | |

**User's choice:** Keep DB fields, tighten runtime.
**Notes:** No SQLite `DROP COLUMN` or destructive table rebuild in Phase 3. New sessions must only write `pty-event-stream`.

---

## CLI/API Errors

| Option | Description | Selected |
|--------|-------------|----------|
| Delete option + legacy errors | Remove `--transport` from help and runtime; legacy rows get explicit unsupported errors. | ✓ |
| Keep `--transport` but only allow pty | Friendlier migration, but keeps transport concept visible. | |
| Keep `--transport tmux` with custom error | Best migration message, but not as clean. | |

**User's choice:** Delete option + legacy errors.
**Notes:** Passing `--transport tmux` can fail as unknown option. Historical tmux session operations should produce clear Chinese CLI errors and HTTP `409` JSON errors.

---

## Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Static scan + typecheck/test + minimal PTY E2E | Strongest practical proof that tmux runtime was removed and PTY still works. | ✓ |
| Static scan + typecheck/test only | Faster, but could miss real CLI/Gateway interaction issues. | |
| Add Web manual test too | More complete, but Phase 3 is not primarily UI work. | |

**User's choice:** Static scan + typecheck/test + minimal PTY E2E.
**Notes:** The static scan should reject executable tmux leftovers in runtime source. E2E should create, interact with, and stop a PTY session without tmux.

---

## the agent's Discretion

- Exact helper names for legacy unsupported errors.
- Exact Web copy for historical transport labels.
- Whether historical tmux rows are persisted as `lost` immediately or normalized on read/list, as long as no tmux probe occurs.

## Deferred Ideas

- SQLite schema cleanup that physically removes historical columns.
- Account/auth implementation.
- Relay multi-account auth.
- Retention and WAL checkpoint scheduling.
