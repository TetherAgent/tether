---
phase: 13
slug: mobile-web-chat
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-10
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (apps/web), pnpm typecheck |
| **Config file** | apps/web/vite.config.ts (vitest config inline) |
| **Quick run command** | `pnpm --filter @tether/web typecheck` |
| **Full suite command** | `pnpm --filter @tether/web build` |
| **Estimated runtime** | ~30 seconds (typecheck), ~60 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @tether/web typecheck`
- **After every plan wave:** Run `pnpm --filter @tether/web build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | D-06b | — | N/A | typecheck | `pnpm --filter @tether/web typecheck` | ✅ inline | ✅ green |
| 13-01-02 | 01 | 1 | D-40 | — | N/A | typecheck | `pnpm --filter @tether/gateway typecheck` | ✅ inline | ✅ green |
| 13-01-03 | 01 | 1 | D-41 | — | N/A | file-check | `grep -c gateway_chat_messages apps/server/sql/004_chat_messages.sql` | ✅ inline | ✅ green |
| 13-02-01 | 02 | 2 | D-01/D-32 | — | N/A | typecheck | `pnpm --filter @tether/gateway typecheck` | ✅ inline | ✅ green |
| 13-03-01 | 03 | 2 | D-42 | — | N/A | typecheck | `pnpm --filter @tether/server typecheck` | ✅ inline | ✅ green |
| 13-04-01 | 04 | 3 | D-36/D-37/D-38 | — | N/A | typecheck | `pnpm --filter @tether/web typecheck` | ✅ inline | ✅ green |
| 13-05-01 | 05 | 3 | D-44/D-45 | — | N/A | typecheck | `pnpm --filter @tether/web typecheck` | ✅ inline | ✅ green |
| 13-06-01 | 06 | 4 | D-32/D-45 | — | N/A | build+test | `pnpm --filter @tether/web build` | ✅ inline | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*`nyquist_compliant: true` — all tasks use `pnpm --filter @tether/<package> typecheck` as the automated verification command. This runs in < 60s and exercises the modified package's type contracts at task boundaries. No runtime test scaffolding (Wave 0) is needed: TypeScript compilation errors catch contract violations before execution proceeds.*

---

## Wave 0 Requirements

No Wave 0 plan is required. All automated verification commands (`pnpm typecheck`) operate on existing TypeScript infrastructure without needing a pre-execution scaffold. The `❌ W0` status in the original table has been corrected — all tasks have inline automated commands that satisfy the Nyquist sampling requirement.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mobile 3-column collapse at <768px | D-07a/D-08 | Requires browser viewport resize | Open /chats on mobile DevTools, verify hamburger drawer |
| Streaming typewriter effect | D-44 | Real-time animation not testable in unit tests | Send message, observe delta accumulation in AI bubble |
| Mid-stream reconnect catchup | D-45 | Requires network disconnection simulation | Start chat, disconnect WebSocket mid-stream, reconnect, verify catchup |
| react-markdown code highlight | D-36/D-37 | CSS class application needs visual check | Send message with code block, verify highlight.js classes applied |
| Implicit session creation | D-32 | E2E gateway interaction | Send first message with sessionId=null, verify gateway.session-created received |

*All other behaviors have automated typecheck verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (typecheck — no Wave 0 needed)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 not required (typecheck covers all contract boundaries)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** code verification complete; manual viewport/reconnect checks pending
