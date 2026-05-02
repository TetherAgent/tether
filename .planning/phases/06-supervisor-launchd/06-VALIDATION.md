---
phase: 06
slug: supervisor-launchd
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner through `tsx --test` |
| **Config file** | `apps/gateway/package.json`, `apps/cli/package.json` |
| **Quick run command** | `pnpm --filter @tether/gateway test && pnpm --filter @tether/cli test` |
| **Full suite command** | `pnpm typecheck && pnpm test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the affected package test or typecheck listed in the plan.
- **After every plan wave:** Run `pnpm typecheck && pnpm test`.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 60 seconds for automated checks, plus manual launchd checks on macOS.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-T01 | 01 | 1 | GW-01 | T-06-01 | Provider command source is whitelist-only | unit/type | `pnpm typecheck` | ✅ | ⬜ pending |
| 06-01-T02 | 01 | 1 | GW-01/GW-02 | T-06-02 | Config JSON is non-executable and defaults are safe | unit | `pnpm --filter @tether/config typecheck` | ✅ | ⬜ pending |
| 06-02-T01 | 02 | 2 | GW-01 | T-06-03 | Session API disabled by default | integration | `pnpm --filter @tether/gateway test` | ✅ | ⬜ pending |
| 06-02-T02 | 02 | 2 | GW-01 | T-06-04 | Session API rejects command-shaped payloads | integration | `pnpm --filter @tether/gateway test` | ✅ | ⬜ pending |
| 06-03-T01 | 03 | 3 | GW-01 | — | CLI defaults to Gateway forwarding with inline fallback | type/manual | `pnpm --filter @tether/cli typecheck` | ✅ | ⬜ pending |
| 06-04-T01 | 04 | 3 | GW-02 | T-06-05 | launchd uses absolute entry and list-form spawn | unit/manual | `pnpm --filter @tether/cli test` | ✅ | ⬜ pending |
| 06-05-T01 | 05 | 4 | GW-01/GW-02 | — | End-to-end supervisor flow verified | manual/full | `pnpm typecheck && pnpm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers gateway tests. If CLI tests are added, `apps/cli/package.json` must add `test: "tsx --test src/*.test.ts"`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| launchd background lifecycle | GW-02 | Requires macOS user launchd session | Run `tether gateway install`, `start`, `status`, `stop`, `uninstall`; verify Chinese output and plist path. |
| persistent Gateway owns session after CLI detaches | GW-01 | Requires real terminal/PTY interaction | Start Gateway, run `tether codex`, detach/close CLI, verify Web/Relay still lists the session. |
| global command path | GW-02 | Depends on local pnpm/global environment | Run `pnpm link --global` or planned equivalent, then `tether gateway status` outside repo cwd. |

---

## Validation Sign-Off

- [x] All tasks have automated or manual verification.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing test infrastructure references.
- [x] No watch-mode flags.
- [x] Feedback latency < 60s for automated checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending

